import type { Store } from './store.ts';
import type { SessionManager } from './sessionManager.ts';

interface TaskFrame {
  id: string;
  source_kind: string | null;
  source_id: string | null;
  status: 'active' | 'idle' | 'errored';
  result: string | null;
}

const PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;
const HUMAN_TERMINAL = new Set(['merged', 'closed']);

/** Drive ticket status from task lifecycle frames. Decoupled from SessionManager. */
export function registerTicketAutomation(manager: SessionManager, store: Store): void {
  manager.on('task', (frame: TaskFrame) => {
    try {
      if (frame.source_kind !== 'ticket' || !frame.source_id) return;
      const tk = store.getTicket(frame.source_id);
      if (!tk || HUMAN_TERMINAL.has(tk.status)) return;

      if (frame.status === 'active') {
        store.updateTicket(tk.id, { status: 'running' });
        return;
      }

      // terminal frame
      if (frame.result === 'success') {
        // PR fallback: if the agent opened a PR but didn't call link_pr, scan its events.
        // eventsSince returns parsed objects (store JSON-parses before returning).
        let prUrl = tk.pr_url;
        if (!prUrl) {
          for (const e of store.eventsSince(frame.id, 0)) {
            // payload is always a parsed object; stringify it to run the regex over the text
            const text = typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload ?? '');
            const m = PR_URL.exec(text);
            if (m) { prUrl = m[0]; store.updateTicket(tk.id, { pr_url: prUrl }); break; }
          }
        }
        store.updateTicket(tk.id, { status: prUrl ? 'review' : 'done' });
      } else if (frame.result === 'error' || frame.result === 'queue_full') {
        store.updateTicket(tk.id, { status: 'failed' });
      } else if (frame.result === 'cancelled') {
        store.updateTicket(tk.id, { status: 'open' });
      }
    } catch (err) {
      console.error('[ticketAutomation] frame handling failed:', err instanceof Error ? err.message : err);
    }
  });
}
