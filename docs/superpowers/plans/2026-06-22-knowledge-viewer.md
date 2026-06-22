# Knowledge viewer (deck UI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only deck UI page at `/memory` that lists every fact in the cross-project knowledge store, grouped by scope, reachable from a global sidebar link.

**Architecture:** New `store.listAllKnowledge()` + `GET /api/knowledge` (mirrors the existing list endpoints). Web: a `Knowledge` type, an `api.knowledge()` client method, a `useKnowledge()` query hook, a pure `groupKnowledgeByScope()` helper, a `KnowledgeList` presentational component, a `routes/memory.tsx` page, and one global sidebar `Link`.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React 19, TanStack Router/Query, Tailwind, vitest.

---

## File structure

| File | Change |
|------|--------|
| `server/src/store.ts` | add `listAllKnowledge` prepared stmt + method |
| `server/src/routes.ts` | add `GET /api/knowledge` |
| `server/test/store.knowledge.test.ts` | cover `listAllKnowledge` |
| `server/test/routes.knowledge.test.ts` (create) | cover `GET /api/knowledge` (auth + payload) |
| `web/src/lib/types.ts` | add `Knowledge` interface |
| `web/src/lib/api.ts` | add `knowledge()` method |
| `web/src/hooks/use-automation-data.ts` | add `useKnowledge()` |
| `web/src/components/deck/knowledge-list.tsx` (create) | `groupKnowledgeByScope` + `KnowledgeList` |
| `web/src/components/deck/knowledge-list.test.tsx` (create) | unit-test the grouping helper |
| `web/src/routes/memory.tsx` (create) | `/memory` page |
| `web/src/components/deck/sidebar-projects.tsx` | global `Memory` link |

**Verify commands:** server — `npm --prefix server test`; server typecheck — `cd server && bunx tsc --noEmit`. Web — `npm --prefix web run typecheck` and `npm --prefix web test`.

---

## Task 1: Server — `listAllKnowledge` + `GET /api/knowledge`

**Files:**
- Modify: `server/src/store.ts` (`stmts!` block; `prepareStatements()`; method near `loadScopedFacts`)
- Modify: `server/src/routes.ts` (near the other `app.get('/api/...')` list routes, e.g. by `/api/goals` ~line 385)
- Test: `server/test/store.knowledge.test.ts` (append), `server/test/routes.knowledge.test.ts` (create)

- [ ] **Step 1: Write the failing store test** — append to `server/test/store.knowledge.test.ts`:

```ts
describe('Store listAllKnowledge', () => {
  it('returns facts from every scope, global first then by scope', () => {
    store.rememberFact({ scope: '/p/beta', kind: 'binding', key: 'b', fact: 'beta fact' });
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'g', fact: 'global fact' });
    store.rememberFact({ scope: '/p/alpha', kind: 'rule', key: 'a', fact: 'alpha fact' });
    const all = store.listAllKnowledge();
    expect(all.length).toBe(3);
    expect(all.map((f) => f.fact).sort()).toEqual(['alpha fact', 'beta fact', 'global fact']);
    // ORDER BY scope: 'global' sorts before '/p/...'? No — '/' (0x2f) < 'g'. Assert grouping is stable, not lexical scope order.
    const scopes = new Set(all.map((f) => f.scope));
    expect(scopes).toEqual(new Set(['global', '/p/alpha', '/p/beta']));
  });

  it('reflects supersede and forget', () => {
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'k', fact: 'v1' });
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'k', fact: 'v2' });
    expect(store.listAllKnowledge().filter((f) => f.key === 'k').map((f) => f.fact)).toEqual(['v2']);
    store.forgetFact('global', 'k');
    expect(store.listAllKnowledge().some((f) => f.key === 'k')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm --prefix server test -- store.knowledge`
Expected: FAIL — `store.listAllKnowledge is not a function`.

- [ ] **Step 3: Add the prepared statement**

In `server/src/store.ts`, add to the `stmts!` type block (next to `loadScopedKnowledge`):

```ts
    listAllKnowledge: Database.Statement;
```

In `prepareStatements()` (next to the other knowledge stmts):

```ts
      listAllKnowledge: db.prepare(
        `SELECT * FROM knowledge ORDER BY scope, kind, updated_at DESC`,
      ),
```

- [ ] **Step 4: Add the method**

In `server/src/store.ts`, after `loadScopedFacts`:

```ts
  /** Every fact across all scopes — for the read-only knowledge viewer. */
  listAllKnowledge(): KnowledgeRow[] {
    return this.stmts.listAllKnowledge.all() as KnowledgeRow[];
  }
```

- [ ] **Step 5: Run — verify store test passes**

Run: `npm --prefix server test -- store.knowledge`
Expected: PASS.

- [ ] **Step 6: Add the route**

In `server/src/routes.ts`, beside the other list routes (e.g. after `app.get('/api/goals', ...)`), add:

```ts
  app.get('/api/knowledge', async () => store.listAllKnowledge());
```

(The `/api/*` auth preHandler that guards the sibling routes covers this one too — confirm by reading how `/api/goals` is guarded; do not add a second auth layer.)

- [ ] **Step 7: Write the failing route test** — create `server/test/routes.knowledge.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.ts';
import { TaskRunner } from '../src/taskRunner.ts';
import { Scheduler } from '../src/scheduler.ts';
import { registerRoutes } from '../src/routes.ts';

let root: string;
let app: ReturnType<typeof Fastify>;
let store: Store;
const TOKEN = 'a-long-test-token-value-1234';

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-knowledge-'));
  app = Fastify();
  await app.register(cookie);
  store = new Store(':memory:');
  const fakeManager = { send: async () => {} } as any;
  const taskRunner = new TaskRunner(store, fakeManager);
  const scheduler = new Scheduler(store, taskRunner);
  registerRoutes(app, {
    store,
    config: { token: TOKEN, projectsRoot: root, port: 1, model: 'claude-opus-4-8' },
    taskRunner,
    scheduler,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function authCookie(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
  return res.headers['set-cookie'] as string;
}

describe('GET /api/knowledge', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/knowledge' });
    expect(res.statusCode).toBe(401);
  });

  it('returns all facts across scopes when authed', async () => {
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'g', fact: 'global fact' });
    store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'a', fact: 'alpha fact' });
    const res = await app.inject({ method: 'GET', url: '/api/knowledge', headers: { cookie: await authCookie() } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ scope: string; fact: string }>;
    expect(body.map((f) => f.fact).sort()).toEqual(['alpha fact', 'global fact']);
  });
});
```

- [ ] **Step 8: Run — verify route test passes**

Run: `npm --prefix server test -- routes.knowledge`
Expected: PASS (2 tests). If the auth assertion fails (200 without cookie), the route is outside the `/api/*` guard — register it where the other `/api` routes live so the same preHandler applies; do NOT weaken auth.

- [ ] **Step 9: Full server suite + commit**

Run: `npm --prefix server test 2>&1 | tail -4` → no regressions.

```bash
git add server/src/store.ts server/src/routes.ts server/test/store.knowledge.test.ts server/test/routes.knowledge.test.ts
git commit -m "feat(server): GET /api/knowledge lists all learned facts"
```

---

## Task 2: Web — type, api method, query hook

**Files:**
- Modify: `web/src/lib/types.ts`, `web/src/lib/api.ts`, `web/src/hooks/use-automation-data.ts`

No new tests (trivial wiring; `tsc --noEmit` is the gate).

- [ ] **Step 1: Add the `Knowledge` type**

In `web/src/lib/types.ts`, add (near the other automation interfaces, e.g. after `GoalDetail`):

```ts
export interface Knowledge {
  id: number;
  scope: string; // 'global' | <project_path>
  kind: "binding" | "convention" | "rule" | "preference" | "infra";
  key: string | null;
  fact: string;
  source_session: string | null;
  created_at: number;
  updated_at: number;
}
```

- [ ] **Step 2: Add the api method**

In `web/src/lib/api.ts`: add `Knowledge` to the type import from `./types`, then add this method to the `api` object (after `goals` block, before the closing `}`):

```ts
  async knowledge(): Promise<Knowledge[]> {
    return json(await fetch("/api/knowledge", { credentials: "same-origin" }));
  },
```

- [ ] **Step 3: Add the query hook**

In `web/src/hooks/use-automation-data.ts`, add near the other queries:

```ts
export function useKnowledge() {
  return useQuery({ queryKey: ["knowledge"], queryFn: () => api.knowledge() });
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `npm --prefix web run typecheck`
Expected: no errors.

```bash
git add web/src/lib/types.ts web/src/lib/api.ts web/src/hooks/use-automation-data.ts
git commit -m "feat(web): knowledge type, api client, query hook"
```

---

## Task 3: Web — grouping helper, KnowledgeList, /memory page, sidebar link

**Files:**
- Create: `web/src/components/deck/knowledge-list.tsx`, `web/src/components/deck/knowledge-list.test.tsx`, `web/src/routes/memory.tsx`
- Modify: `web/src/components/deck/sidebar-projects.tsx`

- [ ] **Step 1: Write the failing helper test** — create `web/src/components/deck/knowledge-list.test.tsx`:

```tsx
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
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm --prefix web test -- knowledge-list`
Expected: FAIL — cannot import `groupKnowledgeByScope`.

- [ ] **Step 3: Create the component + helper** — `web/src/components/deck/knowledge-list.tsx`:

```tsx
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
  for (const [scope, fs] of byScope) {
    if (scope === "global") {
      groups.push({ scope, label: "Global", facts: fs });
    } else {
      const seg = scope.replace(/\/+$/, "").split("/").pop() || scope;
      groups.push({ scope, label: seg, sublabel: scope, facts: fs });
    }
  }
  return groups.sort((a, b) => {
    if (a.scope === "global") return -1;
    if (b.scope === "global") return 1;
    return a.label.localeCompare(b.label);
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
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter facts…"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No facts match “{q}”.</p>
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
```

- [ ] **Step 4: Run — verify helper test passes**

Run: `npm --prefix web test -- knowledge-list`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the route** — `web/src/routes/memory.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { NotificationsToggle } from "@/components/deck/notifications-toggle";
import { KnowledgeList } from "@/components/deck/knowledge-list";
import { AsyncBoundary, useAuthRedirect } from "@/components/deck/async-boundary";
import { useKnowledge } from "@/hooks/use-automation-data";

export const Route = createFileRoute("/memory")({
  component: MemoryRoute,
});

function MemoryRoute() {
  const q = useKnowledge();
  useAuthRedirect(q.error);
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h1 className="font-mono text-xs font-medium tracking-tight text-muted-foreground">
          deck
          <span className="mx-1.5 select-none opacity-50">/</span>
          <span className="font-bold text-foreground">Memory</span>
        </h1>
        <NotificationsToggle />
      </div>
      <AsyncBoundary query={q} label="memory">
        <KnowledgeList facts={q.data ?? []} />
      </AsyncBoundary>
    </div>
  );
}
```

Note: confirm `useAuthRedirect`'s signature accepts a single error (it is called with up to three in other pages). If it requires a fixed arity, pass `q.error` plus `undefined` to match — read `web/src/components/deck/async-boundary.tsx` before writing this line.

- [ ] **Step 6: Add the global sidebar link**

In `web/src/components/deck/sidebar-projects.tsx`: import a `Brain` icon from `lucide-react` (add to the existing icon import list). Add a top-level link in the sidebar chrome — NOT inside the per-project `search={{ project: p.path }}` block. Place it in the sidebar's header/global region (read the file to find where global controls render; e.g. near the top action row). Use:

```tsx
<Link
  to="/memory"
  onClick={onNavigate}
  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&.active]:bg-sidebar-accent [&.active]:text-primary"
>
  <Brain className="size-3.5" /> Memory
</Link>
```

(No `search` prop — `/memory` is global, not project-scoped.)

- [ ] **Step 7: Typecheck + full web test + commit**

Run: `npm --prefix web run typecheck` → no errors.
Run: `npm --prefix web test 2>&1 | tail -4` → no regressions.

```bash
git add web/src/components/deck/knowledge-list.tsx web/src/components/deck/knowledge-list.test.tsx web/src/routes/memory.tsx web/src/components/deck/sidebar-projects.tsx
git commit -m "feat(web): /memory knowledge viewer page + sidebar link"
```

---

## Task 4: Verify end-to-end (build gate)

- [ ] **Step 1:** `npm --prefix server test 2>&1 | tail -4` → all pass.
- [ ] **Step 2:** `npm --prefix web test 2>&1 | tail -4` → all pass.
- [ ] **Step 3:** `npm --prefix web run typecheck` and `cd server && bunx tsc --noEmit` → clean.
- [ ] **Step 4:** `npm --prefix web run build` → succeeds (the route compiles into the SPA). Commit only if a fix was needed.

---

## Self-review

**Spec coverage:** all-projects list (Task 1 `listAllKnowledge`) ✓; read-only (no mutation anywhere) ✓; standalone `/memory` page + global sidebar link (Task 3) ✓; grouped-by-scope, Global-first (helper) ✓; kind badges + key + filter (component) ✓; loading/empty/error (AsyncBoundary + empty copy) ✓; tests (store + route + helper) ✓. Skipped per spec: delete, server search, WS refresh. ✓

**Placeholder scan:** no TBD/TODO; every code step is complete. Two "read the file first" notes (auth preHandler location in `routes.ts`; `useAuthRedirect` arity) are verification instructions, not placeholders — the code to write is fully given.

**Type consistency:** `Knowledge` (web) mirrors `KnowledgeRow` (server) field-for-field. `groupKnowledgeByScope` / `ScopeGroup` / `KnowledgeList` names consistent across component, test, and route. `useKnowledge` / `api.knowledge` / `GET /api/knowledge` aligned end to end.
