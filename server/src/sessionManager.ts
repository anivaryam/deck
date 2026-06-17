// server/src/sessionManager.ts
import { EventEmitter } from 'node:events';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Config } from './config.ts';
import type { Store } from './store.ts';
import { buildDeckMcp } from './deckTools.ts';

/** Derive a short session title from the first prompt: one line, ~60 chars. */
function deriveTitle(text: string): string {
  const oneLine = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  return oneLine.length > 60 ? oneLine.slice(0, 57).trimEnd() + '…' : oneLine;
}

export class BusyError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} is busy`);
    this.name = 'BusyError';
  }
}

export interface DeckEvent {
  sessionId: string;
  type: string;
  payload: unknown;
  seq: number;
}

/** Injectable shape so tests can pass a fake async iterable. */
export type QueryFn = (args: { prompt: string | AsyncIterable<any>; options: Record<string, unknown> }) => AsyncIterable<any>;

export class SessionManager extends EventEmitter {
  private active = new Set<string>();
  private controllers = new Map<string, AbortController>();

  constructor(
    private store: Store,
    private cfg: Config,
    private queryFn: QueryFn = (args) => sdkQuery(args as any),
  ) {
    super();
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  cancel(sessionId: string): boolean {
    const ac = this.controllers.get(sessionId);
    if (!ac) return false;
    ac.abort();
    return true;
  }

  async send(sessionId: string, promptText: string, images?: Array<{ media_type: string; data: string }>): Promise<void> {
    if (this.active.has(sessionId)) throw new BusyError(sessionId);
    const sess = this.store.get(sessionId);
    if (!sess) throw new Error(`unknown session: ${sessionId}`);

    this.active.add(sessionId);
    this.store.setStatus(sessionId, 'active');

    // Auto-title from the first user prompt (only-if-null, so it sticks).
    if (!sess.title) {
      const title = deriveTitle(promptText);
      if (title) this.store.setTitle(sessionId, title);
    }

    const hasImages = Array.isArray(images) && images.length > 0;
    this.record(sessionId, 'user', { type: 'user_prompt', text: promptText, images: hasImages ? images!.length : 0 });

    const promptInput: string | AsyncIterable<any> = hasImages
      ? (async function* () {
          yield {
            type: 'user' as const,
            parent_tool_use_id: null,
            message: {
              role: 'user' as const,
              content: [
                ...(promptText ? [{ type: 'text' as const, text: promptText }] : []),
                ...images!.map((im) => ({
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: im.media_type, data: im.data },
                })),
              ],
            },
          };
        })()
      : promptText;

    const ac = new AbortController();
    this.controllers.set(sessionId, ac);

    try {
      const mode = this.cfg.permissionMode || 'bypassPermissions';
      const options: Record<string, unknown> = {
        cwd: sess.project_path,
        model: sess.model || this.cfg.model,
        permissionMode: mode,
        abortController: ac,
        mcpServers: { deck: buildDeckMcp(this.store, sess.project_path) },
      };
      // Only skip permission checks when explicitly in bypass mode. Set
      // DECK_PERMISSION_MODE=default to re-enable the SDK's own gating.
      if (mode === 'bypassPermissions') options.allowDangerouslySkipPermissions = true;
      if (sess.sdk_session_id) options.resume = sess.sdk_session_id;

      for await (const msg of this.queryFn({ prompt: promptInput, options })) {
        if (msg?.type === 'system' && msg?.subtype === 'init' && msg?.session_id) {
          this.store.setResume(sessionId, msg.session_id);
        }
        this.record(sessionId, String(msg?.type ?? 'unknown'), msg);
      }
      this.store.setStatus(sessionId, 'idle');
    } catch (err) {
      if (ac.signal.aborted) {
        this.record(sessionId, 'cancelled', { message: 'cancelled by user' });
        this.store.setStatus(sessionId, 'idle');
      } else {
        this.record(sessionId, 'error', { message: err instanceof Error ? err.message : String(err) });
        this.store.setStatus(sessionId, 'errored');
        throw err;
      }
    } finally {
      this.controllers.delete(sessionId);
      this.active.delete(sessionId);
    }
  }

  private record(sessionId: string, type: string, payload: any): void {
    const sdkUuid = typeof payload?.uuid === 'string' ? payload.uuid : null;
    const row = this.store.appendEvent(sessionId, { sdkUuid, type, payload });
    const ev: DeckEvent = { sessionId, type, payload, seq: row.seq };
    this.emit('event', ev);
  }
}
