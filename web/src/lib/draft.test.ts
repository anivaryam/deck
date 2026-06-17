import { beforeEach, describe, it, expect, vi } from "vitest";
import { loadDraft, saveDraft, clearDraft } from "./draft";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe("draft helpers", () => {
  it("save then load returns the saved text", () => {
    saveDraft("sess-1", "hello world");
    expect(loadDraft("sess-1")).toBe("hello world");
  });

  it("saving empty string removes the key (load returns empty string)", () => {
    saveDraft("sess-2", "some text");
    saveDraft("sess-2", "");
    expect(loadDraft("sess-2")).toBe("");
  });

  it("clearDraft removes the key", () => {
    saveDraft("sess-3", "draft content");
    clearDraft("sess-3");
    expect(loadDraft("sess-3")).toBe("");
  });

  it("distinct sessionIds are independent", () => {
    saveDraft("sess-a", "alpha");
    saveDraft("sess-b", "beta");
    expect(loadDraft("sess-a")).toBe("alpha");
    expect(loadDraft("sess-b")).toBe("beta");
    clearDraft("sess-a");
    expect(loadDraft("sess-a")).toBe("");
    expect(loadDraft("sess-b")).toBe("beta");
  });

  it("null sessionId uses the 'new' bucket", () => {
    saveDraft(null, "new draft");
    expect(loadDraft(null)).toBe("new draft");
    expect(loadDraft(undefined)).toBe("new draft");
  });
});
