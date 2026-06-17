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

/** Returns the list of tool names registered for the given context.
 *  Pure helper — usable in tests without constructing an MCP server. */
export function deckToolNames(ticketId?: string): string[] {
  const names = ['create_ticket', 'list_tickets'];
  if (ticketId) names.push('link_pr');
  return names;
}

/** In-process MCP server ("deck"), tools bound to one project. */
export function buildDeckMcp(store: Store, projectPath: string, ticketId?: string) {
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
  return createSdkMcpServer({
    name: 'deck',
    version: '1.0.0',
    instructions: 'Tools to file and list claude-deck tickets and link a PR for the current ticket.',
    tools,
  });
}
