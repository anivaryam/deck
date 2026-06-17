import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Store } from './store.ts';

interface ToolResult { [x: string]: unknown; content: Array<{ type: 'text'; text: string }>; }

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

/** In-process MCP server ("deck"), tools bound to one project. */
export function buildDeckMcp(store: Store, projectPath: string) {
  return createSdkMcpServer({
    name: 'deck',
    version: '1.0.0',
    instructions: 'Tools to file and list claude-deck tickets for the current project.',
    tools: [
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
    ],
  });
}
