import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Store, KnowledgeKind } from './store.ts';

interface ToolResult { [x: string]: unknown; content: Array<{ type: 'text'; text: string }>; }

const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#].*)?$/;

/** Heuristic reject for credential-shaped text. The knowledge store must hold
 *  references ("uses GH account acme-bot"), never secrets. False positives are
 *  acceptable — the model is told to store a reference instead. */
const SECRET_PATTERNS: RegExp[] = [
  /\bghp_[A-Za-z0-9]{35,}\b/,                    // GitHub classic PAT
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,           // GitHub fine-grained PAT
  /\bsk-[A-Za-z0-9_-]{20,}\b/,                   // OpenAI / Anthropic style key (sk-, sk-ant-, sk-proj-)
  /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/,              // Slack token
  /\bAKIA[0-9A-Z]{16}\b/,                        // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*[^\s=:]{6,100}/i,   // assignment
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,         // PEM private key block
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text ?? ''));
}

const KNOWLEDGE_KINDS = ['binding', 'convention', 'rule', 'preference', 'infra'] as const;

/** Map the tool's 'global' | 'project' choice to an actual scope string. */
function resolveScope(scope: 'global' | 'project', projectPath: string): string {
  return scope === 'global' ? 'global' : projectPath;
}

export async function rememberHandler(
  store: Store, projectPath: string,
  args: { fact: string; kind: KnowledgeKind; scope: 'global' | 'project'; key?: string },
): Promise<ToolResult> {
  if (looksLikeSecret(args.fact)) {
    return { content: [{ type: 'text', text: 'Not stored: that looks like a credential. Record the reference, not the secret (e.g. "uses GH account acme-bot", never the token).' }] };
  }
  const row = store.rememberFact({
    scope: resolveScope(args.scope, projectPath),
    kind: args.kind,
    key: args.key ?? null,
    fact: args.fact,
  });
  return { content: [{ type: 'text', text: `Remembered (${row.kind}, ${row.scope === 'global' ? 'global' : 'this project'}): ${row.fact}` }] };
}

export async function recallHandler(
  store: Store, args: { query: string },
): Promise<ToolResult> {
  const hits = store.recallFacts(args.query);
  if (!hits.length) return { content: [{ type: 'text', text: '(no matching facts)' }] };
  const text = hits
    .map((h) => `- [${h.kind}/${h.scope === 'global' ? 'global' : h.scope}] ${h.fact}`)
    .join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function forgetHandler(
  store: Store, projectPath: string,
  args: { scope: 'global' | 'project'; key: string },
): Promise<ToolResult> {
  const hit = store.forgetFact(resolveScope(args.scope, projectPath), args.key);
  return { content: [{ type: 'text', text: hit ? `Forgotten: ${args.key}` : `No fact found for key "${args.key}" in that scope.` }] };
}

export async function createTicketHandler(
  store: Store, projectPath: string, args: { title: string; body?: string },
): Promise<ToolResult> {
  const t = store.createTicket({ title: args.title, body: args.body, projectPath });
  return { content: [{ type: 'text', text: `Created ticket ${t.id}: ${t.title}` }] };
}

export async function listTicketsHandler(store: Store, projectPath: string): Promise<ToolResult> {
  const mine = store.listTicketsByProject(projectPath);
  const text = mine.length ? mine.map((t) => `- [${t.status}] ${t.title}`).join('\n') : '(none)';
  return { content: [{ type: 'text', text }] };
}

export async function linkPrHandler(
  store: Store, ticketId: string, args: { url: string },
): Promise<ToolResult> {
  if (!PR_URL.test(args.url)) {
    return { content: [{ type: 'text', text: `Not a GitHub PR URL: ${args.url}` }] };
  }
  store.updateTicket(ticketId, { pr_url: args.url });
  return { content: [{ type: 'text', text: `PR linked to ticket ${ticketId}: ${args.url}` }] };
}

export interface GoalReportArgs {
  summary: string;
  goal_met: boolean;
  files_changed: string[];
  commands_run: { cmd: string; exit_code: number; output_tail: string }[];
  incomplete: string[];
  notes?: string;
}

export async function goalReportHandler(
  store: Store, goalId: string, args: GoalReportArgs,
): Promise<ToolResult> {
  store.updateGoal(goalId, { report: JSON.stringify(args) });
  return { content: [{ type: 'text', text: `Report recorded for goal ${goalId}.` }] };
}

export interface GoalVerdictArgs {
  achieved: boolean;
  reasons: string;
  unmet_criteria: string[];
  tests_summary: string;
  dimensions?: { name: string; passed: boolean; notes: string }[];
}

export async function goalVerdictHandler(
  store: Store, goalId: string, args: GoalVerdictArgs,
): Promise<ToolResult> {
  store.updateGoal(goalId, { verdict: JSON.stringify(args) });
  return { content: [{ type: 'text', text: `Verdict recorded for goal ${goalId} (achieved=${args.achieved}).` }] };
}

/** Returns the list of tool names registered for the given context.
 *  Pure helper — usable in tests without constructing an MCP server. */
export function deckToolNames(ticketId?: string, goalId?: string, verifyGoalId?: string): string[] {
  const names = ['create_ticket', 'list_tickets', 'remember', 'recall', 'forget'];
  if (ticketId) names.push('link_pr');
  if (goalId) names.push('goal_report');
  if (verifyGoalId) names.push('goal_verdict');
  return names;
}

/** In-process MCP server ("deck"), tools bound to one project. */
export function buildDeckMcp(store: Store, projectPath: string, ticketId?: string, goalId?: string, verifyGoalId?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: SdkMcpToolDefinition<any>[] = [
    tool(
      'create_ticket',
      'File a claude-deck ticket for the CURRENT project. Use one ticket per distinct gap/issue/follow-up you find.',
      { title: z.string().describe('Short imperative title'), body: z.string().optional().describe('Details: what, why, where (file:line)') },
      async (args) => createTicketHandler(store, projectPath, args),
    ),
    tool(
      'list_tickets',
      'List existing claude-deck tickets for the current project (check before creating to avoid duplicates).',
      {},
      async () => listTicketsHandler(store, projectPath),
    ),
    tool(
      'remember',
      'Record a durable fact for future sessions. Use PROACTIVELY (no user request needed) when you learn something that (1) is true beyond this session, (2) is NOT derivable from the repo/git/CLAUDE.md, and (3) would change how a future session acts. Examples: which GitHub/MCP/cloud account a project uses (binding), a build/PR/commit convention, a do/don\'t rule, or a standing user preference (clear error messages, show loading/empty/error states, terse output). Use scope=project for facts about THIS project only; scope=global for cross-project user preferences. NEVER store secrets/tokens/keys — store the reference (account NAME, not the credential). Capture only at stated/confirmed/observed confidence.',
      {
        fact: z.string().describe('One fact, plain language, no secrets'),
        kind: z.enum(KNOWLEDGE_KINDS).describe('binding | convention | rule | preference | infra'),
        scope: z.enum(['global', 'project']).describe('project = this project only; global = every project'),
        key: z.string().optional().describe('Stable natural key so re-recording supersedes instead of duplicating, e.g. "github-account". Omit for free-form facts.'),
      },
      async (args) => rememberHandler(store, projectPath, args as { fact: string; kind: KnowledgeKind; scope: 'global' | 'project'; key?: string }),
    ),
    tool(
      'recall',
      'Search facts learned in ANY project (including other projects) by keyword. Use when you suspect you handled something similar before — e.g. "have I set up Stripe webhooks elsewhere?".',
      { query: z.string().describe('Keywords to search learned facts') },
      async (args) => recallHandler(store, args),
    ),
    tool(
      'forget',
      'Delete a previously remembered fact by its scope and key (use when a fact is wrong or stale).',
      {
        scope: z.enum(['global', 'project']).describe('Where the fact lives'),
        key: z.string().describe('The key the fact was stored under. Only keyed facts can be forgotten — a fact remembered without a key cannot be removed this way.'),
      },
      async (args) => forgetHandler(store, projectPath, args as { scope: 'global' | 'project'; key: string }),
    ),
  ];
  if (ticketId) {
    tools.push(
      tool(
        'link_pr',
        'Record the GitHub Pull Request URL you opened for the CURRENT ticket. Call this once the PR exists.',
        { url: z.string().describe('Full GitHub PR URL, e.g. https://github.com/o/r/pull/123') },
        async (args) => linkPrHandler(store, ticketId, args),
      ),
    );
  }
  if (goalId) {
    tools.push(
      tool(
        'goal_report',
        'Record the FINAL structured outcome for the current goal. Call this exactly once when finished or blocked.',
        {
          summary: z.string().describe('What you built / attempted'),
          goal_met: z.boolean().describe('Your honest claim: does the result meet the goal?'),
          files_changed: z.array(z.string()).describe('Paths changed'),
          commands_run: z
            .array(z.object({ cmd: z.string(), exit_code: z.number(), output_tail: z.string() }))
            .describe('Commands/tests run with their results'),
          incomplete: z.array(z.string()).describe('Anything still not done'),
          notes: z.string().optional(),
        },
        async (args) => goalReportHandler(store, goalId, args as GoalReportArgs),
      ),
    );
  }
  if (verifyGoalId) {
    tools.push(
      tool(
        'goal_verdict',
        'Record the FINAL verification verdict for the current goal. Call this exactly once after verifying.',
        {
          achieved: z.boolean().describe('Does the result genuinely meet the goal (tests pass + acceptance met)?'),
          reasons: z.string().describe('Why achieved / why not'),
          unmet_criteria: z.array(z.string()).describe('Acceptance criteria not satisfied (empty if achieved)'),
          tests_summary: z.string().describe('What tests you ran and their result'),
          dimensions: z
            .array(z.object({ name: z.string(), passed: z.boolean(), notes: z.string() }))
            .optional()
            .describe('Per-dimension results (correctness + any requested QA dimensions)'),
        },
        async (args) => goalVerdictHandler(store, verifyGoalId, args as GoalVerdictArgs),
      ),
    );
  }
  return createSdkMcpServer({
    name: 'deck',
    version: '1.0.0',
    instructions: 'Tools to file and list claude-deck tickets and link a PR for the current ticket.',
    tools,
  });
}
