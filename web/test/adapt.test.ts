import { describe, it, expect } from "vitest";
import { eventsToMessages } from "../src/lib/adapt";
import type { DeckMessage } from "../src/lib/types";

describe("eventsToMessages", () => {
  it("maps an injected user_prompt to a user bubble", () => {
    const ev: DeckMessage[] = [{ type: "user", payload: { type: "user_prompt", text: "hello", images: 0 }, at: 0 }];
    const msgs = eventsToMessages(ev);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("hello");
    expect(msgs[0].attachments).toBeUndefined();
  });

  it("notes image attachments on the user bubble", () => {
    const ev: DeckMessage[] = [{ type: "user", payload: { type: "user_prompt", text: "look", images: 2 } }];
    const [m] = eventsToMessages(ev);
    expect(m.attachments).toEqual([{ name: "2 images", kind: "image" }]);
  });

  it("maps assistant text to a claude message", () => {
    const ev: DeckMessage[] = [
      { type: "assistant", payload: { message: { content: [{ type: "text", text: "hi there" }] } } },
    ];
    const [m] = eventsToMessages(ev);
    expect(m.role).toBe("claude");
    expect(m.content).toBe("hi there");
  });

  it("maps tool_use to a tool block and fills output from the later tool_result", () => {
    const ev: DeckMessage[] = [
      {
        type: "assistant",
        payload: {
          message: {
            content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/app.ts" } }],
          },
        },
      },
      {
        type: "user",
        payload: {
          message: {
            content: [{ type: "tool_result", tool_use_id: "t1", content: "142 lines\nmore" }],
          },
        },
      },
    ];
    const msgs = eventsToMessages(ev);
    expect(msgs).toHaveLength(1); // SDK tool-result user message is not its own bubble
    expect(msgs[0].tool).toBeTruthy();
    expect(msgs[0].tool!.name).toBe("Read");
    expect(msgs[0].tool!.input).toBe("src/app.ts");
    expect(msgs[0].tool!.output).toBe("142 lines");
  });

  it("emits both the text and the tool block from one assistant message", () => {
    const ev: DeckMessage[] = [
      {
        type: "assistant",
        payload: {
          message: {
            content: [
              { type: "text", text: "let me check" },
              { type: "tool_use", id: "t2", name: "Bash", input: { command: "ls" } },
            ],
          },
        },
      },
    ];
    const msgs = eventsToMessages(ev);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("let me check");
    expect(msgs[1].tool!.name).toBe("Bash");
    expect(msgs[1].tool!.input).toBe("ls");
  });

  it("renders error and cancelled as system messages", () => {
    const ev: DeckMessage[] = [
      { type: "error", payload: { message: "boom" } },
      { type: "cancelled", payload: { message: "cancelled by user" } },
    ];
    const msgs = eventsToMessages(ev);
    expect(msgs[0]).toMatchObject({ role: "system", content: "✕ boom" });
    expect(msgs[1]).toMatchObject({ role: "system", content: "■ run cancelled" });
  });

  it("ignores system / result / ready / busy frames", () => {
    const ev: DeckMessage[] = [
      { type: "system", payload: { subtype: "init", session_id: "abc" } },
      { type: "result", payload: { subtype: "success", usage: {} } },
      { type: "ready", payload: { busy: false } },
      { type: "busy", payload: { message: "running" } },
    ];
    expect(eventsToMessages(ev)).toHaveLength(0);
  });
});
