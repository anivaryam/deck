// server/src/wsHub.ts
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { SessionManager, DeckEvent } from './sessionManager.ts';
import type { Store } from './store.ts';
import type { Config } from './config.ts';
import { isAuthed } from './routes.ts';
import { AuthSessions, originAllowed } from './auth.ts';

interface WsDeps {
  store: Store;
  manager: SessionManager;
  config: Config;
  auth: AuthSessions;
}

// Cap the socket send buffer. A slow client (mobile, throttled) on a fast stream
// would otherwise accumulate unbounded data in process memory. Dropping a live
// STREAM frame is safe: the client re-syncs the gap on reconnect via `?since`.
export const MAX_BUFFERED = 8 * 1024 * 1024; // 8MB

// Session lifecycle / terminal frames. Unlike streaming output (assistant text,
// `user` tool results) these are tiny AND they flip sticky client UI state:
// `result`/`cancelled`/`error` are the only live signals that clear the client's
// `busy` flag — i.e. swap the Stop button back to Send. The authoritative re-sync
// (`ready`, carrying server `busy`) is sent ONLY on (re)connect, so a dropped
// terminal frame on a socket that stays open is NOT recoverable: `busy` stays
// stuck true and the Stop button lingers after the turn ends (most visible on long
// streaming responses, when the buffer is most congested). So these bypass the
// backpressure cap; only large live STREAM frames are dropped.
const CRITICAL_FRAME_TYPES = new Set(['ready', 'result', 'cancelled', 'error', 'deleted']);

// Pure backpressure decision, exported for unit testing. Returns true only for a
// non-critical frame while the buffer is over the cap.
export function shouldDropFrame(type: unknown, bufferedAmount: number, maxBuffered: number = MAX_BUFFERED): boolean {
  if (bufferedAmount <= maxBuffered) return false;
  return !(typeof type === 'string' && CRITICAL_FRAME_TYPES.has(type));
}

export function registerWs(app: FastifyInstance, deps: WsDeps): { closeRoom: (sessionId: string) => void } {
  const { store, manager, config, auth } = deps;
  // sessionId -> set of sockets attached to it
  const rooms = new Map<string, Set<WebSocket>>();

  function send(socket: WebSocket, obj: unknown): void {
    if (socket.readyState !== socket.OPEN) return;
    const type = (obj as { type?: unknown } | null)?.type;
    if (shouldDropFrame(type, socket.bufferedAmount)) return; // backpressure: drop live stream frames; client re-syncs
    socket.send(JSON.stringify(obj));
  }

  // Fan out every manager event to all sockets in that session's room.
  manager.on('event', (ev: DeckEvent) => {
    const room = rooms.get(ev.sessionId);
    if (!room) return;
    for (const s of room) send(s, { type: ev.type, payload: ev.payload, at: Date.now(), seq: ev.seq });
  });

  // Global lifecycle firehose: every task start/finish, lightweight payload only.
  const eventsRoom = new Set<WebSocket>();
  manager.on('task', (frame: { id: string; source_kind: string | null; source_id: string | null; status: string; result: string | null }) => {
    for (const s of eventsRoom) send(s, { type: 'task', payload: frame, at: Date.now() });
  });

  app.get('/ws/events', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    const originOk = origin === undefined || originAllowed(origin, config.publicOrigin);
    if (!isAuthed(req as any, auth) || !originOk) {
      send(socket, { type: 'error', payload: { message: 'unauthorized' } });
      socket.close();
      return;
    }
    eventsRoom.add(socket);
    send(socket, { type: 'ready', payload: {} });
    socket.on('close', () => eventsRoom.delete(socket));
  });

  app.get('/ws/:id', { websocket: true }, (socket, req) => {
    // Auth via the opaque session cookie (httpOnly, SameSite=strict) plus an Origin
    // allowlist. SameSite=strict is the real cross-site WebSocket-hijacking (CSWSH)
    // defense: a cross-site page can't attach the cookie, so it can never authenticate —
    // Origin present or not. The Origin check is defense-in-depth, but reverse proxies /
    // tunnels legitimately strip Origin on the WS upgrade (ours drops it so dev servers
    // like Vite don't reject the public origin), which makes a hard requirement
    // unworkable. So: require the cookie always, and reject only a PRESENT, disallowed
    // Origin; a missing Origin falls back to the cookie + SameSite guarantee.
    const origin = req.headers.origin;
    const originOk = origin === undefined || originAllowed(origin, config.publicOrigin);
    if (!isAuthed(req as any, auth) || !originOk) {
      send(socket, { type: 'error', payload: { message: 'unauthorized' } });
      socket.close();
      return;
    }

    const sessionId = (req.params as { id: string }).id;
    const session = store.get(sessionId);
    if (!session) {
      send(socket, { type: 'error', payload: { message: 'unknown session' } });
      socket.close();
      return;
    }

    // Join room
    let room = rooms.get(sessionId);
    if (!room) {
      room = new Set();
      rooms.set(sessionId, room);
    }
    room.add(socket);

    // Delta replay: the client passes `?since=<lastSeq>`; replay only newer events
    // (or all, if it has none). Each frame carries its seq so the client dedupes.
    const sinceRaw = (req.query as { since?: string } | undefined)?.since;
    const sinceNum = sinceRaw !== undefined ? Number(sinceRaw) : 0;
    const since = Number.isFinite(sinceNum) && sinceNum > 0 ? sinceNum : 0;
    for (const e of store.eventsSince(sessionId, since)) {
      send(socket, { type: e.type, payload: e.payload, at: e.created_at, seq: e.seq });
    }
    send(socket, { type: 'ready', payload: { busy: manager.isActive(sessionId) } });

    socket.on('message', async (raw: Buffer) => {
      let parsed: { type?: string; text?: string; images?: any[] };
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return send(socket, { type: 'error', payload: { message: 'bad json' } });
      }
      if (parsed.type === 'cancel') {
        manager.cancel(sessionId);
        return;
      }
      if (parsed.type === 'prompt' && parsed.text !== undefined) {
        const imgs = Array.isArray(parsed.images)
          ? parsed.images
              .filter(
                (x: any) =>
                  x &&
                  typeof x.media_type === 'string' &&
                  typeof x.data === 'string' &&
                  /^image\/(png|jpe?g|webp|gif)$/.test(x.media_type) &&
                  x.data.length < 7_000_000,
              )
              .slice(0, 4)
          : undefined;
        if (manager.isActive(sessionId))
          return send(socket, { type: 'busy', payload: { message: 'a turn is already running' } });
        manager
          .send(sessionId, parsed.text, imgs)
          .catch((err) =>
            send(socket, { type: 'error', payload: { message: err instanceof Error ? err.message : String(err) } }),
          );
        return;
      }
    });

    socket.on('close', () => {
      room?.delete(socket);
      if (room && room.size === 0) rooms.delete(sessionId);
    });
  });

  // Tell every viewer of a now-deleted session, then drop the room. Called by the
  // DELETE /api/sessions/:id route after the row is removed from the DB.
  function closeRoom(sessionId: string): void {
    const room = rooms.get(sessionId);
    if (!room) return;
    for (const s of room) {
      send(s, { type: 'deleted', payload: { message: 'session deleted' } });
      try {
        s.close();
      } catch {
        /* socket already closing */
      }
    }
    rooms.delete(sessionId);
  }

  return { closeRoom };
}
