import { useCallback, useEffect, useRef, useState } from "react";
import type { DeckMessage } from "./types";

const BACKOFF_BASE = 1000; // 1s
const BACKOFF_CAP = 10000; // 10s

// Per-session cache of the full event stream. Reopening a session renders this
// instantly instead of visibly rebuilding from the first message. Lives at module
// scope so it survives component unmounts (navigating between threads).
const eventCache = new Map<string, DeckMessage[]>();

function maxSeqOf(msgs: DeckMessage[]): number {
  let m = 0;
  for (const x of msgs) if (typeof x.seq === "number" && x.seq > m) m = x.seq;
  return m;
}

export function useSocket(sessionId: string | null) {
  const [messages, setMessages] = useState<DeckMessage[]>(() =>
    sessionId ? (eventCache.get(sessionId) ?? []) : [],
  );
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setConnected(false);
      setBusy(false);
      return;
    }
    const sid = sessionId;

    // Switching sessions reuses this hook instance (the router swaps the $threadId
    // param without remounting), so reset transient state for the new session.
    // Without this, a busy session A leaves `busy=true` bleeding onto session B
    // until B's socket connects and its `ready` frame reports authoritative state —
    // showing a stale Cancel button on a session that isn't running.
    setBusy(false);
    setConnected(false);

    // Everything below is scoped to THIS effect run. Under React StrictMode (dev)
    // the effect mounts → cleans up → mounts again; keeping the socket, timer and
    // the disposed flag local guarantees the first run's socket is fully torn down
    // and can never keep appending events (which previously caused duplicates).
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    // Accumulate frames here; seeded from the cache so reopening shows history with
    // no empty flash. `maxSeq` drives delta replay on (re)connect — the server only
    // resends events newer than what we already have, so nothing is lost or
    // duplicated, even on a mid-turn reconnect.
    let buf: DeckMessage[] = eventCache.get(sid) ? [...eventCache.get(sid)!] : [];
    let maxSeq = maxSeqOf(buf);
    setMessages(eventCache.get(sid) ?? []);

    const commit = () => {
      const snapshot = [...buf];
      eventCache.set(sid, snapshot);
      if (!disposed) setMessages(snapshot);
    };

    function connect() {
      if (disposed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/${sid}?since=${maxSeq}`);
      socket = ws;
      wsRef.current = ws;
      ws.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        if (disposed) return; // this run was torn down → do not reconnect
        setConnected(false);
        const delay = Math.min(BACKOFF_CAP, BACKOFF_BASE * 2 ** attempt);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onmessage = (e) => {
        if (disposed) return;
        let msg: DeckMessage;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return; // ignore a malformed/truncated frame rather than crashing the handler
        }
        if (!msg || typeof msg.type !== "string") return;

        // `ready` is a control frame (no seq): it re-establishes the authoritative
        // busy state on every (re)connect, which clears a stuck "agent working…"
        // if a result frame was missed during a disconnect.
        if (msg.type === "ready") {
          setBusy(Boolean(msg.payload?.busy));
          return;
        }

        if (typeof msg.seq === "number") {
          if (msg.seq <= maxSeq) return; // duplicate replay — already have it
          maxSeq = msg.seq;
        }

        if (msg.type === "result" || msg.type === "cancelled" || msg.type === "error") setBusy(false);
        else if (msg.type === "user") setBusy(true);

        buf.push(msg);
        commit();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const s = socket;
      if (s) {
        // Closing a still-CONNECTING socket logs a benign "closed before
        // established" warning (common under StrictMode's mount/cleanup/mount).
        // Defer the close to onopen so the console stays clean.
        if (s.readyState === WebSocket.CONNECTING) s.onopen = () => s.close();
        else s.close();
      }
      if (wsRef.current === socket) wsRef.current = null;
    };
  }, [sessionId]);

  const sendPrompt = useCallback(
    (text: string, images?: Array<{ media_type: string; data: string }>) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const msg: { type: "prompt"; text: string; images?: Array<{ media_type: string; data: string }> } = {
        type: "prompt",
        text,
      };
      if (images && images.length) msg.images = images;
      ws.send(JSON.stringify(msg));
    },
    [],
  );

  const cancel = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "cancel" }));
  }, []);

  return { messages, connected, busy, sendPrompt, cancel };
}
