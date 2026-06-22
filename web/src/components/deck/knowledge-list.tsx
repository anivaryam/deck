import { useMemo, useState } from "react";
import type { Knowledge } from "@/lib/types";

export interface ScopeGroup {
  scope: string;
  label: string;
  sublabel?: string;
  facts: Knowledge[];
}

/** Group facts by scope: Global first, then projects alphabetically by basename. */
export function groupKnowledgeByScope(facts: Knowledge[]): ScopeGroup[] {
  const byScope = new Map<string, Knowledge[]>();
  for (const f of facts) {
    const arr = byScope.get(f.scope) ?? [];
    arr.push(f);
    byScope.set(f.scope, arr);
  }
  const groups: ScopeGroup[] = [];
  for (const [scope, items] of byScope) {
    if (scope === "global") {
      groups.push({ scope, label: "Global", facts: items });
    } else {
      const seg = scope.replace(/\/+$/, "").split("/").pop() || scope;
      groups.push({ scope, label: seg, sublabel: scope, facts: items });
    }
  }
  return groups.sort((a, b) => {
    if (a.scope === "global") return -1;
    if (b.scope === "global") return 1;
    // Tiebreak same-basename projects (e.g. /a/foo vs /b/foo) by full path so order is stable.
    return a.label.localeCompare(b.label) || a.scope.localeCompare(b.scope);
  });
}

const KIND_CLASS: Record<Knowledge["kind"], string> = {
  binding: "border-sky-500/40 text-sky-300",
  convention: "border-emerald-500/40 text-emerald-300",
  rule: "border-amber-500/40 text-amber-300",
  preference: "border-violet-500/40 text-violet-300",
  infra: "border-slate-500/40 text-slate-300",
};

export function KnowledgeList({ facts }: { facts: Knowledge[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return facts;
    return facts.filter(
      (f) =>
        f.fact.toLowerCase().includes(needle) ||
        (f.key ?? "").toLowerCase().includes(needle) ||
        f.scope.toLowerCase().includes(needle),
    );
  }, [facts, q]);
  const groups = useMemo(() => groupKnowledgeByScope(filtered), [filtered]);

  if (facts.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No learned facts yet — deck records them as it works.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-3">
        <input
          aria-label="Filter facts"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter facts…"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No facts match "{q}".</p>
        ) : (
          groups.map((g) => (
            <section key={g.scope} className="mb-4">
              <header className="flex items-baseline gap-2 px-2 py-1.5">
                <span className="text-sm font-semibold text-foreground">{g.label}</span>
                {g.sublabel && <span className="truncate text-[11px] text-muted-foreground">{g.sublabel}</span>}
                <span className="ml-auto text-[11px] text-muted-foreground">{g.facts.length}</span>
              </header>
              <ul className="space-y-1">
                {g.facts.map((f) => (
                  <li key={f.id} className="flex items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2 hover:border-border hover:bg-card">
                    <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${KIND_CLASS[f.kind]}`}>{f.kind}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-foreground">{f.fact}</span>
                      {f.key && <span className="mt-0.5 block text-[11px] text-muted-foreground">key: {f.key}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
