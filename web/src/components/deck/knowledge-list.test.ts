import { describe, it, expect } from "vitest";
import { groupKnowledgeByScope } from "./knowledge-list";
import type { Knowledge } from "@/lib/types";

function fact(scope: string, fact: string): Knowledge {
  return { id: Math.floor(Math.random() * 1e9), scope, kind: "binding", key: null, fact, source_session: null, created_at: 0, updated_at: 0 };
}

describe("groupKnowledgeByScope", () => {
  it("puts Global first, then projects alphabetically by label", () => {
    const groups = groupKnowledgeByScope([
      fact("/home/u/zeta", "z"),
      fact("global", "g"),
      fact("/home/u/alpha", "a"),
    ]);
    expect(groups.map((x) => x.label)).toEqual(["Global", "alpha", "zeta"]);
    expect(groups[0].scope).toBe("global");
    expect(groups[1].sublabel).toBe("/home/u/alpha");
    expect(groups[0].sublabel).toBeUndefined();
  });

  it("groups multiple facts under one scope", () => {
    const groups = groupKnowledgeByScope([fact("global", "a"), fact("global", "b")]);
    expect(groups.length).toBe(1);
    expect(groups[0].facts.length).toBe(2);
  });

  it("orders same-basename projects deterministically by full path", () => {
    const groups = groupKnowledgeByScope([fact("/b/foo", "x"), fact("/a/foo", "y")]);
    expect(groups.map((g) => g.scope)).toEqual(["/a/foo", "/b/foo"]);
    expect(groups.map((g) => g.label)).toEqual(["foo", "foo"]);
  });
});
