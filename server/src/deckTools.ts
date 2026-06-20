import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Store } from './store.ts';

interface ToolResult { [x: string]: unknown; content: Array<{ type: 'text'; text: string }>; }

const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#].*)?$/;

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
  const names = ['create_ticket', 'list_tickets'];
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
