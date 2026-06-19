import { describe, it, expect } from "vitest";
import { eventsToMessages, createIncrementalFolder } from "./adapt";
import type { DeckMessage } from "./types";

function ev(seq: number, type: string, payload: any): DeckMessage {
  return { seq, type, payload } as DeckMessage;
}

// A small stream: user prompt → assistant text + tool_use → tool_result.
const stream: DeckMessage[] = [
  ev(1, "user", { type: "user_prompt", text: "hi", images: 0 }),
  ev(2, "assistant", {
    message: {
      content: [
        { type: "text", text: "working" },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ],
    },
  }),
  ev(3, "user", { message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "a\nb\nc" }] } }),
  ev(4, "assistant", { message: { content: [{ type: "text", text: "done" }] } }),
];

describe("eventsToMessages", () => {
  it("folds prompt, assistant text, tool block + backfilled result", () => {
    const msgs = eventsToMessages(stream);
    expect(msgs.map((m) => m.role)).toEqual(["user", "claude", "claude", "claude"]);
    const tool = msgs.find((m) => m.tool);
    expect(tool?.tool?.name).toBe("Bash");
    expect(tool?.tool?.input).toBe("ls");
    expect(tool?.tool?.output).toBe("a"); // first line preview
  });
});

describe("createIncrementalFolder", () => {
  it("matches the full fold when fed one event at a time", () => {
    const fold = createIncrementalFolder();
    let last: ReturnType<typeof fold> = [];
    for (let i = 1; i <= stream.length; i++) last = fold(stream.slice(0, i));
    expect(last).toEqual(eventsToMessages(stream));
  });

  it("only re-processes appended events (tool backfill replaces identity)", () => {
    const fold = createIncrementalFolder();
    const beforeResult = fold(stream.slice(0, 2)); // up to tool_use
    const toolBefore = beforeResult.find((m) => m.tool)!;
    expect(toolBefore.tool?.output).toBeUndefined();

    const afterResult = fold(stream.slice(0, 3)); // tool_result arrives
    const toolAfter = afterResult.find((m) => m.tool)!;
    expect(toolAfter.tool?.output).toBe("a");
    // Identity changed so a memoized renderer re-renders the filled output.
    expect(toolAfter).not.toBe(toolBefore);
  });

  it("re-folds from scratch when the input is not an append (session switch)", () => {
    const fold = createIncrementalFolder();
    fold(stream);
    const other: DeckMessage[] = [ev(10, "user", { type: "user_prompt", text: "new session", images: 0 })];
    const res = fold(other);
    expect(res).toHaveLength(1);
    expect(res[0].content).toBe("new session");
  });
});
