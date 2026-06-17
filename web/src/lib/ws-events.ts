import { useEffect, useRef } from "react";
import type { TaskFrame } from "./automation-events";

/** Subscribe to the global /ws/events firehose. Calls onTask for each task frame.
 *  Auto-reconnects with capped backoff. */
export function useTaskEvents(onTask: (frame: TaskFrame) => void): void {
  const cb = useRef(onTask);
  cb.current = onTask;

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/events`);
      ws.onopen = () => { delay = 1000; };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg?.type === "task" && msg.payload) cb.current(msg.payload as TaskFrame);
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        if (closed) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10_000);
      };
    };
    connect();
    return () => { closed = true; if (timer) clearTimeout(timer); ws?.close(); };
  }, []);
}
