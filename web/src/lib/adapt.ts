import type { Attachment, DeckMessage, Message } from "./types";

// Backend streams raw events ({type,payload,at}). This pure function folds that
// stream into the spec's UI Message[] model. Logic mirrors the proven mapping in
// the original web client (Transcript.tsx); kept side-effect free so it can be
// unit-tested over recorded event sequences.

export function clock(at?: number): string {
  if (!at) return "";
  return new Date(at).toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toolTarget(input: any): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  return (
    input.file_path ||
    input.command ||
    input.pattern ||
    input.path ||
    input.url ||
    input.query ||
    input.prompt ||
    ""
  );
}

function compactInput(input: any): string {
  const t = toolTarget(input);
  if (t) return String(t);
  try {
    const s = JSON.stringify(input ?? "");
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  } catch {
    return "";
  }
}

// Normalize an SDK message `content` into a block array. The SDK normally sends
// an array, but a string is valid for simple turns — without this, `.filter`/`for…of`
// downstream would throw inside the fold (a render crash caught only by the route
// ErrorComponent). A bare string becomes a single text block.
function asBlocks(content: any): any[] {
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  return [];
}

function resultText(content: any): string {
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((b: any) =>
        typeof b === "string" ? b : b?.type === "image" ? "[image]" : (b?.text ?? ""),
      )
      .join("");
  }
  return text.trim();
}

function resultPreview(content: any): string {
  const text = resultText(content);
  if (!text) return "✓";
  const firstLine = text.split("\n")[0];
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine;
}

// Full output for the expanded tool block — capped so a huge result can't bloat
// the DOM / cache. The collapsed header still shows only the one-line preview.
function resultFull(content: any): string {
  const text = resultText(content);
  const CAP = 20_000;
  return text.length > CAP ? text.slice(0, CAP) + "\n…(truncated)" : text;
}

interface FoldState {
  out: Message[];
  toolIndex: Map<string, number>; // tool_use_id -> index in `out`
}

// Fold a single event into the running state. Extracted so the full fold and the
// incremental folder share identical logic. Mutates `state.out` by appending, and
// (for tool results) by REPLACING the target message with a fresh object so a
// memoized renderer sees a new identity and re-renders the filled-in output.
function foldEvent(state: FoldState, ev: DeckMessage, i: number): void {
  const { out, toolIndex } = state;
  const time = clock(ev.at);
  // Prefer the stable server seq for keys so collapsed/expanded tool state and
  // memoization survive stream growth; fall back to the array index.
  const k = ev.seq ?? i;

  if (ev.type === "user") {
    const p = ev.payload;
    // Our own injected prompt event renders as a user bubble.
    if (p?.type === "user_prompt") {
      const imgs = Number(p.images ?? 0);
      const attachments: Attachment[] | undefined =
        imgs > 0 ? [{ name: `${imgs} image${imgs > 1 ? "s" : ""}`, kind: "image" }] : undefined;
      out.push({ id: `m${k}-u`, role: "user", content: String(p.text ?? ""), attachments, time });
      return;
    }
    // SDK `user` messages are tool results — fill the matching tool block's output.
    const content = asBlocks(p?.message?.content);
    for (const b of content) {
      if (b?.type === "tool_result" && b.tool_use_id && toolIndex.has(b.tool_use_id)) {
        const idx = toolIndex.get(b.tool_use_id)!;
        const msg = out[idx];
        if (msg?.tool)
          out[idx] = { ...msg, tool: { ...msg.tool, output: resultPreview(b.content), outputFull: resultFull(b.content) } };
      }
    }
    return;
  }

  if (ev.type === "assistant") {
    const content = asBlocks(ev.payload?.message?.content);
    const text = content
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("");
    if (text.trim()) {
      out.push({ id: `m${k}-t`, role: "claude", content: text, time });
    }
    const tools = content.filter((b: any) => b?.type === "tool_use");
    tools.forEach((t: any, j: number) => {
      out.push({
        id: t.id ? `tool-${t.id}` : `m${k}-k${j}`,
        role: "claude",
        content: "",
        tool: { name: String(t.name ?? "tool"), input: compactInput(t.input) },
        time,
      });
      if (t.id) toolIndex.set(t.id, out.length - 1);
    });
    return;
  }

  if (ev.type === "error") {
    out.push({ id: `m${k}-e`, role: "system", content: `✕ ${ev.payload?.message ?? "error"}`, time });
    return;
  }

  if (ev.type === "cancelled") {
    out.push({ id: `m${k}-c`, role: "system", content: "■ run cancelled", time });
    return;
  }
  // system / result / ready / busy: not rendered in the transcript.
}

/** Pure full fold over an event stream. Used for one-shot renders and tests. */
export function eventsToMessages(events: DeckMessage[]): Message[] {
  const state: FoldState = { out: [], toolIndex: new Map() };
  events.forEach((ev, i) => foldEvent(state, ev, i));
  return state.out;
}

/**
 * Stateful folder for the live streaming path. On each call it processes ONLY the
 * events appended since the previous call (the WS buffer is append-only and shares
 * element identity across snapshots), so the O(n) fold work doesn't re-run every
 * frame. If the input isn't an append of the last input (session switch, replay
 * shrink), it transparently re-folds from scratch. Returns a fresh array each call
 * so React memoization downstream observes the change.
 */
export function createIncrementalFolder(): (events: DeckMessage[]) => Message[] {
  const state: FoldState = { out: [], toolIndex: new Map() };
  let consumed = 0;
  let anchor: DeckMessage | null = null; // identity of the last consumed event

  return (events: DeckMessage[]): Message[] => {
    const isAppend = events.length >= consumed && (consumed === 0 || events[consumed - 1] === anchor);
    if (!isAppend) {
      state.out = [];
      state.toolIndex.clear();
      consumed = 0;
      anchor = null;
    }
    for (let i = consumed; i < events.length; i++) foldEvent(state, events[i], i);
    consumed = events.length;
    anchor = events.length ? events[events.length - 1] : null;
    return state.out.slice();
  };
}
