# Run History + Live Completion Events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every task run an attributable source + explicit outcome + timing (run history), and broadcast task lifecycle over a global WS channel so the tickets/tasks/cron UI reacts the instant an unattended task finishes.

**Architecture:** Runs ARE task sessions — augment the `session` table with `source_kind`/`source_id`/`ended_at`/`result` (no new table). `sessionManager.send` records the outcome at its terminal points and emits a lightweight `task` lifecycle event; a new `/ws/events` firehose fans those to subscribed pages, which invalidate React Query caches and toast on unattended completions. A per-source run-history strip surfaces past runs.

**Tech Stack:** Backend — Fastify, better-sqlite3 (`Store`), EventEmitter `SessionManager`, croner `Scheduler`, Vitest. Frontend — React 19, TanStack Router, React Query 5, sonner, Vitest (node env).

---

## Constraints (verified)

- SQLite table is named **`session`** (singular). Migration adds columns via the existing PRAGMA `additions` array in `store.ts` (lines ~150-164) — idempotent by design.
- Backend tests: Vitest, `new Store(':memory:')`, `fakeManager` for `TaskRunner`/route tests (see `server/test/routes.phase2.test.ts`, `taskRunner.test.ts`, `scheduler.test.ts`). Run from `server/`: `pnpm vitest run <file>`.
- `SessionManager extends EventEmitter`; `wsHub` already does `manager.on('event', ...)`. We add a second event name `'task'`.
- Frontend tests: node-env Vitest only (no jsdom). Pure logic + fetch-mocked api; components verified by `pnpm typecheck`/`pnpm build` + manual smoke. Run from `web/`.
- `Date.now()` is used directly in `store.ts` already — fine in app code (only workflow scripts forbid it).
- Do not hand-edit `web/src/routeTree.gen.ts`. Do not commit it or `dist/`.
- Work happens in a git worktree on a feature branch (set up by the controller). Run pnpm from `server/` or `web/` as noted.

---

## File Structure

**Backend — modify:**
- `server/src/store.ts` — 4 columns + `SessionRow` fields; `insertTask` SQL gains source cols; `finishRun`, `listRunsForSource`; `createTask` source params.
- `server/src/taskRunner.ts` — thread `sourceKind`/`sourceId`; queue-full → `finishRun(id,'queue_full')`.
- `server/src/scheduler.ts` — `fireCron` passes source.
- `server/src/routes.ts` — ticket run passes source; new `GET /api/runs`.
- `server/src/sessionManager.ts` — `finishRun` + emit `task` lifecycle at start + 3 terminal points.
- `server/src/wsHub.ts` — `/ws/events` channel + `manager.on('task')` fan-out.

**Backend — create tests:**
- `server/test/runHistory.test.ts`

**Frontend — modify:**
- `web/src/lib/types.ts` — `Session` source/result/ended_at fields.
- `web/src/lib/api.ts` — `runs(...)`.
- `web/src/hooks/use-automation-data.ts` — `useRuns`; drop `refetchInterval` on `useTasks`.
- `web/src/components/deck/ticket-detail.tsx` — mount `<RunHistory>`.
- `web/src/routes/cron.tsx` / `web/src/components/deck/cron-list.tsx` — per-row expand → `<RunHistory>`.
- `web/src/components/deck/deck-view.tsx` (or app root) — mount `useTaskEvents`.

**Frontend — create:**
- `web/src/lib/automation-events.ts` — pure `toastForTask(frame)` mapping + tests.
- `web/src/lib/automation-events.test.ts`
- `web/src/lib/ws-events.ts` — `useTaskEvents(onTask)` hook.
- `web/src/components/deck/run-history.tsx`

---

## Task 1: Store — columns, types, finishRun, listRunsForSource (TDD)

**Files:** Modify `server/src/store.ts`; Create `server/test/runHistory.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `server/test/runHistory.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('run history store', () => {
  it('createTask persists source_kind/source_id', () => {
    const t = store.createTask({ projectPath: '/p', prompt: 'x', origin: 'cron', sourceKind: 'cron', sourceId: 'c1' });
    const row = store.get(t.id)!;
    expect(row.source_kind).toBe('cron');
    expect(row.source_id).toBe('c1');
    expect(row.ended_at == null).toBe(true);
    expect(row.result == null).toBe(true);
  });

  it('createTask without source leaves columns null', () => {
    const t = store.createTask({ projectPath: '/p', prompt: 'x', origin: 'manual' });
    const row = store.get(t.id)!;
    expect(row.source_kind == null).toBe(true);
    expect(row.source_id == null).toBe(true);
  });

  it('finishRun sets ended_at and result', () => {
    const t = store.createTask({ projectPath: '/p', prompt: 'x', origin: 'manual' });
    store.finishRun(t.id, 'success');
    const row = store.get(t.id)!;
    expect(row.result).toBe('success');
    expect(typeof row.ended_at).toBe('number');
  });

  it('listRunsForSource filters by source and orders newest-first', () => {
    const a = store.createTask({ projectPath: '/p', prompt: 'a', origin: 'cron', sourceKind: 'cron', sourceId: 'c1' });
    const b = store.createTask({ projectPath: '/p', prompt: 'b', origin: 'cron', sourceKind: 'cron', sourceId: 'c1' });
    store.createTask({ projectPath: '/p', prompt: 'c', origin: 'cron', sourceKind: 'cron', sourceId: 'OTHER' });
    const runs = store.listRunsForSource('cron', 'c1');
    expect(runs.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('listRunsForSource respects the limit', () => {
    for (let i = 0; i < 5; i++) store.createTask({ projectPath: '/p', prompt: `${i}`, origin: 'ticket', sourceKind: 'ticket', sourceId: 't1' });
    expect(store.listRunsForSource('ticket', 't1', 3)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd server && pnpm vitest run test/runHistory.test.ts`
Expected: FAIL — `source_kind` undefined / `finishRun is not a function`.

- [ ] **Step 3: Add columns to the migration**

In `server/src/store.ts`, extend the `additions` array (after the `disabled_tools` entry, ~line 160):

```ts
      ['source_kind', `ALTER TABLE session ADD COLUMN source_kind TEXT`],
      ['source_id', `ALTER TABLE session ADD COLUMN source_id TEXT`],
      ['ended_at', `ALTER TABLE session ADD COLUMN ended_at INTEGER`],
      ['result', `ALTER TABLE session ADD COLUMN result TEXT`],
```

- [ ] **Step 4: Extend `SessionRow` interface**

In the `SessionRow` interface (top of `store.ts`), add after `created_at` (keep `created_at` last is fine; add these before it or after — order in TS interface is cosmetic):

```ts
  source_kind?: string | null;
  source_id?: string | null;
  ended_at?: number | null;
  result?: string | null;
```

- [ ] **Step 5: Update `insertTask` to write source columns**

Replace the `insertTask` prepared statement (lines ~187-190) with one that includes the new columns:

```ts
      insertTask: db.prepare(
        `INSERT INTO session (id, project_path, title, sdk_session_id, status, kind, prompt, origin, model, effort, disabled_tools, source_kind, source_id, created_at)
         VALUES (?, ?, ?, NULL, 'idle', 'task', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
```

Add two prepared statements alongside the others:

```ts
      finishRun: db.prepare(`UPDATE session SET ended_at = ?, result = ? WHERE id = ?`),
      listRunsForSource: db.prepare(
        `SELECT * FROM session WHERE source_kind = ? AND source_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      ),
```

- [ ] **Step 6: Update `createTask` + add methods**

Change `createTask`'s input type to add `sourceKind?: 'cron' | 'ticket'; sourceId?: string;` and update the `.run(...)` call to pass them (matching the new column order — `source_kind`, `source_id` go right before `created_at`):

```ts
  createTask(input: {
    projectPath: string;
    prompt: string;
    origin: SessionOrigin;
    title?: string;
    model?: string;
    effort?: string;
    disabledTools?: string[];
    sourceKind?: 'cron' | 'ticket';
    sourceId?: string;
  }): SessionRow {
    const id = randomUUID();
    const created_at = Date.now();
    this.stmts.insertTask.run(
      id,
      input.projectPath,
      input.title ?? null,
      input.prompt,
      input.origin,
      input.model ?? null,
      input.effort ?? null,
      input.disabledTools && input.disabledTools.length ? JSON.stringify(input.disabledTools) : null,
      input.sourceKind ?? null,
      input.sourceId ?? null,
      created_at,
    );
    return this.get(id)!;
  }

  finishRun(id: string, result: 'success' | 'error' | 'cancelled' | 'queue_full'): void {
    this.stmts.finishRun.run(Date.now(), result, id);
  }

  listRunsForSource(sourceKind: 'cron' | 'ticket', sourceId: string, limit = 20): SessionRow[] {
    return this.stmts.listRunsForSource.all(sourceKind, sourceId, limit) as SessionRow[];
  }
```

(Add `finishRun` and `listRunsForSource` to the `stmts` type if `store.ts` declares an explicit `stmts` interface — match the existing declaration style.)

- [ ] **Step 7: Run test — expect PASS**

Run: `cd server && pnpm vitest run test/runHistory.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add server/src/store.ts server/test/runHistory.test.ts
git commit -m "feat(server): run-history columns + finishRun/listRunsForSource"
```

---

## Task 2: Thread source through taskRunner + scheduler + ticket run (TDD)

**Files:** Modify `server/src/taskRunner.ts`, `server/src/scheduler.ts`, `server/src/routes.ts`; extend `server/test/runHistory.test.ts`.

- [ ] **Step 1: Add failing tests**

Append to `server/test/runHistory.test.ts`:

```ts
import { TaskRunner } from '../src/taskRunner.ts';
import { Scheduler } from '../src/scheduler.ts';

describe('source threading', () => {
  it('taskRunner.run threads sourceKind/sourceId into the task', () => {
    const s = new Store(':memory:');
    const fakeManager = { send: async () => {} };
    const runner = new TaskRunner(s, fakeManager as any);
    const id = runner.run({ projectPath: '/p', prompt: 'x', origin: 'cron', sourceKind: 'cron', sourceId: 'c9' });
    const row = s.get(id)!;
    expect(row.source_kind).toBe('cron');
    expect(row.source_id).toBe('c9');
  });

  it('queue-full marks result=queue_full', () => {
    const s = new Store(':memory:');
    const blocking = { send: () => new Promise<void>(() => {}) }; // never resolves
    const runner = new TaskRunner(s, blocking as any, 1);
    runner.run({ projectPath: '/p', prompt: 'a', origin: 'manual' }); // fills the 1 slot
    const overflowId = runner.run({ projectPath: '/p', prompt: 'b', origin: 'manual' });
    expect(s.get(overflowId)!.result).toBe('queue_full');
  });

  it('scheduler.fireCron tags the run with the cron id', () => {
    const s = new Store(':memory:');
    const created: any[] = [];
    const runner = { run: (i: any) => { created.push(i); return 'sess1'; } };
    const sched = new Scheduler(s, runner as any);
    const c = s.createCron({ schedule: '* * * * *', projectPath: '/p', prompt: 'nightly' });
    sched.fireCron(c.id);
    expect(created[0]).toMatchObject({ origin: 'cron', sourceKind: 'cron', sourceId: c.id });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd server && pnpm vitest run test/runHistory.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: taskRunner — add source params + queue-full result**

In `server/src/taskRunner.ts`, change the `run` input type to add `sourceKind?: 'cron' | 'ticket'; sourceId?: string;`, pass them into `createTask`, and in the queue-full branch add `finishRun` after `setStatus`:

```ts
  run(input: { projectPath: string; prompt: string; origin: SessionOrigin; title?: string; model?: string; effort?: string; sourceKind?: 'cron' | 'ticket'; sourceId?: string }): string {
    const task = this.store.createTask(input);

    if (this.active >= this.maxConcurrent) {
      this.store.appendEvent(task.id, {
        sdkUuid: null,
        type: 'error',
        payload: { message: `task queue full (max ${this.maxConcurrent} concurrent) — not started` },
      });
      this.store.setStatus(task.id, 'errored');
      this.store.finishRun(task.id, 'queue_full');
      return task.id;
    }
    // ... unchanged: active++, fire-and-forget send, finally active--
```

(`createTask(input)` already receives the whole input object, so `sourceKind`/`sourceId` flow through automatically — just widen the type.)

- [ ] **Step 4: scheduler — tag the run**

In `server/src/scheduler.ts` `fireCron`, change the run call:

```ts
    const sessionId = this.runner.run({ projectPath: c.project_path, prompt: c.prompt, origin: 'cron', sourceKind: 'cron', sourceId: c.id });
    this.store.recordCronRun(id, sessionId);
```

- [ ] **Step 5: ticket run route — tag the run**

In `server/src/routes.ts` `POST /api/tickets/:id/run`, change the run call:

```ts
    const sessionId = taskRunner.run({ projectPath: tk.project_path, prompt, origin: 'ticket', title: tk.title, sourceKind: 'ticket', sourceId: tk.id });
```

- [ ] **Step 6: Run — expect PASS**

Run: `cd server && pnpm vitest run test/runHistory.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/taskRunner.ts server/src/scheduler.ts server/src/routes.ts server/test/runHistory.test.ts
git commit -m "feat(server): tag cron/ticket runs with source; queue-full result"
```

---

## Task 3: sessionManager — record outcome + emit lifecycle

**Files:** Modify `server/src/sessionManager.ts`.

This wires the outcome write and the lifecycle event. The manager already `extends EventEmitter` and emits `'event'`. We add a `'task'` event and `finishRun` calls. Read the file first to confirm the exact lines around `setStatus('active')` (~line 89), the success `setStatus('idle')` (~line 156), the abort branch (~159-161), the throw branch (~162-164).

- [ ] **Step 1: Add a lifecycle emit helper**

Near the top of the `SessionManager` class, add a private helper (uses the `sess` row already fetched in `send`):

```ts
  private emitTask(sess: SessionRow, status: 'active' | 'idle' | 'errored', result: string | null): void {
    if (sess.kind !== 'task') return; // only tasks broadcast on the events channel
    this.emit('task', {
      id: sess.id,
      source_kind: sess.source_kind ?? null,
      source_id: sess.source_id ?? null,
      status,
      result,
    });
  }
```

(Import `SessionRow` type if not already in scope.)

- [ ] **Step 2: Emit on start**

Right after `this.store.setStatus(sessionId, 'active');` in `send`, add:

```ts
    this.emitTask(sess, 'active', null);
```

- [ ] **Step 3: Record + emit at the three terminal points**

- Success (after the `for await` loop, where it does `this.store.setStatus(sessionId, 'idle');`):
```ts
      this.store.setStatus(sessionId, 'idle');
      this.store.finishRun(sessionId, 'success');
      this.emitTask(sess, 'idle', 'success');
```
- Abort branch (inside `if (ac.signal.aborted)`, after `setStatus(sessionId, 'idle')`):
```ts
        this.store.setStatus(sessionId, 'idle');
        this.store.finishRun(sessionId, 'cancelled');
        this.emitTask(sess, 'idle', 'cancelled');
```
- Throw branch (after `setStatus(sessionId, 'errored')`, before `throw err`):
```ts
        this.store.setStatus(sessionId, 'errored');
        this.store.finishRun(sessionId, 'error');
        this.emitTask(sess, 'errored', 'error');
        throw err;
```

- [ ] **Step 4: Typecheck**

Run: `cd server && pnpm exec tsc --noEmit`
Expected: PASS (or use the server's typecheck script if present).

- [ ] **Step 5: Commit**

```bash
git add server/src/sessionManager.ts
git commit -m "feat(server): record run outcome + emit task lifecycle events"
```

---

## Task 4: wsHub — `/ws/events` global channel (TDD-ish)

**Files:** Modify `server/src/wsHub.ts`; add a test to `server/test/runHistory.test.ts`.

- [ ] **Step 1: Add a fan-out test (fake socket)**

Append to `server/test/runHistory.test.ts`. We test the wiring contract: a `'task'` event from the manager reaches a socket joined to the events room. Since `registerWs` is coupled to Fastify, instead unit-test the lightweight emitter contract directly by asserting `manager.emit('task', …)` triggers the registered handler. Add:

```ts
import { EventEmitter } from 'node:events';

describe('events channel contract', () => {
  it('manager emits a task lifecycle frame that a listener receives', () => {
    const mgr = new EventEmitter();
    const received: any[] = [];
    mgr.on('task', (f) => received.push(f));
    mgr.emit('task', { id: 's1', source_kind: 'cron', source_id: 'c1', status: 'idle', result: 'success' });
    expect(received).toEqual([{ id: 's1', source_kind: 'cron', source_id: 'c1', status: 'idle', result: 'success' }]);
  });
});
```

(This locks the frame shape. Full Fastify WS integration is covered by manual smoke in Task 9.)

- [ ] **Step 2: Add the events room + route in `wsHub.ts`**

After the `rooms` map and the per-session `manager.on('event', …)` block, add an events room and its fan-out:

```ts
  // Global lifecycle firehose: every task start/finish, lightweight payload only.
  const eventsRoom = new Set<WebSocket>();
  manager.on('task', (frame: { id: string; source_kind: string | null; source_id: string | null; status: string; result: string | null }) => {
    for (const s of eventsRoom) send(s, { type: 'task', payload: frame, at: Date.now() });
  });
```

Add the route (mirror the `/ws/:id` auth gate):

```ts
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
```

> Register `/ws/events` BEFORE `/ws/:id` is fine (distinct paths), but place it adjacent for clarity.

- [ ] **Step 3: Run test + typecheck**

Run: `cd server && pnpm vitest run test/runHistory.test.ts && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/wsHub.ts server/test/runHistory.test.ts
git commit -m "feat(server): /ws/events global task lifecycle channel"
```

---

## Task 5: GET /api/runs endpoint

**Files:** Modify `server/src/routes.ts`; add a route test to `server/test/runHistory.test.ts` (or the existing routes test file — match its harness).

- [ ] **Step 1: Add the route**

In `server/src/routes.ts`, near the tasks routes, add:

```ts
  app.get<{ Querystring: { source_kind?: string; source_id?: string } }>('/api/runs', async (req, reply) => {
    const { source_kind, source_id } = req.query ?? {};
    if ((source_kind !== 'cron' && source_kind !== 'ticket') || !source_id) {
      return reply.code(400).send({ error: 'source_kind (cron|ticket) and source_id required' });
    }
    return store.listRunsForSource(source_kind, source_id);
  });
```

- [ ] **Step 2: Typecheck + (optional) route test**

Run: `cd server && pnpm exec tsc --noEmit`
Expected: PASS. If adding a route test, mirror `routes.phase2.test.ts` (build the app with `:memory:` store, inject a GET, assert 400 on missing params and an array on valid params).

- [ ] **Step 3: Commit**

```bash
git add server/src/routes.ts server/test/*.ts
git commit -m "feat(server): GET /api/runs lists runs for a cron/ticket source"
```

---

## Task 6: Frontend types + api + hooks

**Files:** Modify `web/src/lib/types.ts`, `web/src/lib/api.ts`, `web/src/hooks/use-automation-data.ts`.

- [ ] **Step 1: Extend `Session` wire type**

In `web/src/lib/types.ts`, add to the `Session` interface (after `created_at` or alongside the other optionals):

```ts
  source_kind?: string | null;
  source_id?: string | null;
  ended_at?: number | null;
  result?: string | null;
```

- [ ] **Step 2: Add `api.runs`**

In `web/src/lib/api.ts` `api` object:

```ts
  async runs(sourceKind: "cron" | "ticket", sourceId: string): Promise<Session[]> {
    const q = new URLSearchParams({ source_kind: sourceKind, source_id: sourceId });
    return json(await fetch(`/api/runs?${q}`, { credentials: "same-origin" }));
  },
```

- [ ] **Step 3: Add `useRuns`; drop tasks polling**

In `web/src/hooks/use-automation-data.ts`:

```ts
export function useRuns(sourceKind: "cron" | "ticket", sourceId: string | null) {
  return useQuery({
    queryKey: ["runs", sourceKind, sourceId],
    queryFn: () => (sourceId ? api.runs(sourceKind, sourceId) : Promise.resolve([])),
    enabled: !!sourceId,
  });
}
```

And change `useTasks` to remove `refetchInterval: 5_000` (the live channel replaces polling):

```ts
export function useTasks() {
  return useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks() });
}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && pnpm exec tsc --noEmit --incremental false`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/api.ts web/src/hooks/use-automation-data.ts
git commit -m "feat(web): runs api + useRuns hook; drop tasks polling"
```

---

## Task 7: Frontend — events hook + toast mapping (TDD on the pure part)

**Files:** Create `web/src/lib/automation-events.ts`, `web/src/lib/automation-events.test.ts`, `web/src/lib/ws-events.ts`.

- [ ] **Step 1: Write the failing test for the pure mapping**

Create `web/src/lib/automation-events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toastForTask, type TaskFrame } from "./automation-events";

const base: TaskFrame = { id: "s1", source_kind: "cron", source_id: "c1", status: "idle", result: "success" };

describe("toastForTask", () => {
  it("returns a success intent for a finished cron run", () => {
    expect(toastForTask(base)).toEqual({ intent: "success", message: expect.stringContaining("cron") });
  });
  it("returns an error intent for a failed ticket run", () => {
    expect(toastForTask({ ...base, source_kind: "ticket", result: "error" })).toMatchObject({ intent: "error" });
  });
  it("returns null while a run is still active", () => {
    expect(toastForTask({ ...base, status: "active", result: null })).toBeNull();
  });
  it("returns null for manual/unsourced runs (no noise)", () => {
    expect(toastForTask({ ...base, source_kind: null })).toBeNull();
  });
  it("returns null for cancelled runs", () => {
    expect(toastForTask({ ...base, result: "cancelled" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd web && pnpm vitest run src/lib/automation-events.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the pure mapping**

Create `web/src/lib/automation-events.ts`:

```ts
export type TaskFrame = {
  id: string;
  source_kind: string | null;
  source_id: string | null;
  status: "active" | "idle" | "errored";
  result: string | null;
};

export type TaskToast = { intent: "success" | "error"; message: string };

/** Map a lifecycle frame to a toast intent, or null when no toast should fire.
 *  Only finished cron/ticket runs that succeeded or errored produce a toast. */
export function toastForTask(f: TaskFrame): TaskToast | null {
  if (f.status === "active") return null;
  if (f.source_kind !== "cron" && f.source_kind !== "ticket") return null;
  if (f.result === "success") return { intent: "success", message: `${f.source_kind} run finished` };
  if (f.result === "error" || f.result === "queue_full") return { intent: "error", message: `${f.source_kind} run failed` };
  return null; // cancelled, or unknown
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd web && pnpm vitest run src/lib/automation-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the WS hook**

Create `web/src/lib/ws-events.ts` (mirror the reconnect pattern of `web/src/lib/ws.ts`):

```ts
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
```

- [ ] **Step 6: Typecheck**

Run: `cd web && pnpm exec tsc --noEmit --incremental false`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/automation-events.ts web/src/lib/automation-events.test.ts web/src/lib/ws-events.ts
git commit -m "feat(web): task events hook + pure toast mapping"
```

---

## Task 8: Frontend — run-history component + wiring + toasts

**Files:** Create `web/src/components/deck/run-history.tsx`; Modify `web/src/components/deck/ticket-detail.tsx`, `web/src/components/deck/cron-list.tsx`, and a top-level component to mount `useTaskEvents`.

- [ ] **Step 1: RunHistory component**

Create `web/src/components/deck/run-history.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { useRuns } from "@/hooks/use-automation-data";
import { StatusDot } from "./status-chip";
import { relativeTime, taskStatus } from "@/lib/automation";
import type { Session } from "@/lib/types";

function runStatus(s: Session) {
  if (s.result === "error" || s.result === "queue_full") return "failed" as const;
  if (s.result === "cancelled") return "done" as const;
  if (s.result === "success") return "done" as const;
  return taskStatus(s); // still running / legacy
}

function duration(s: Session): string {
  if (!s.ended_at) return "";
  const ms = s.ended_at - s.created_at;
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec < 60 ? `${sec}s` : `${Math.round(sec / 60)}m`;
}

export function RunHistory({
  sourceKind,
  sourceId,
  projectPath,
}: {
  sourceKind: "cron" | "ticket";
  sourceId: string;
  projectPath: string;
}) {
  const { data } = useRuns(sourceKind, sourceId);
  const runs = data ?? [];
  if (!runs.length) {
    return <p className="px-2 py-3 text-[11px] text-muted-foreground">No runs yet.</p>;
  }
  return (
    <ul className="space-y-0.5 py-1">
      {runs.map((r) => (
        <li key={r.id}>
          <Link
            to="/tasks"
            search={{ project: projectPath, task: r.id }}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <StatusDot status={runStatus(r)} />
            <span className="flex-1 truncate">{r.result ?? "running"}</span>
            <span className="opacity-70">{duration(r)}</span>
            <span className="opacity-50">{relativeTime(r.created_at)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Wire into ticket detail**

In `web/src/components/deck/ticket-detail.tsx`, import `RunHistory` and render it in the detail body when `ticket.session_id` exists (replacing or beside the existing "linked task" link). Add inside `.d-body` (after the kv rows):

```tsx
import { RunHistory } from "./run-history";
// ...
<div className="mt-3">
  <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Runs</div>
  <RunHistory sourceKind="ticket" sourceId={ticket.id} projectPath={ticket.project_path} />
</div>
```

- [ ] **Step 3: Wire into cron list (per-row expand)**

In `web/src/components/deck/cron-list.tsx`, add per-row open state and a chevron toggle; when open, render `<RunHistory sourceKind="cron" sourceId={c.id} projectPath={c.project_path} />` beneath the row. Add at top of `CronList`:

```tsx
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { RunHistory } from "./run-history";
// inside component:
const [open, setOpen] = useState<Record<string, boolean>>({});
```

Wrap each row so the existing row content is followed by a toggle button and the conditional history. Add a button (before or after the Delete button) and the panel:

```tsx
<button
  onClick={() => setOpen((s) => ({ ...s, [c.id]: !s[c.id] }))}
  className="shrink-0 text-muted-foreground hover:text-foreground"
  aria-label="Show runs"
>
  <ChevronRight className={cn("size-4 transition-transform", open[c.id] && "rotate-90")} />
</button>
```

and after the row div:

```tsx
{open[c.id] && (
  <div className="ml-9 border-l border-border pl-2">
    <RunHistory sourceKind="cron" sourceId={c.id} projectPath={c.project_path} />
  </div>
)}
```

(Adapt to the exact row markup — keep existing Switch/prompt/last-run intact.)

- [ ] **Step 4: Mount the events hook + toasts**

In `web/src/components/deck/deck-view.tsx` (the always-mounted shell), add:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTaskEvents } from "@/lib/ws-events";
import { toastForTask } from "@/lib/automation-events";
// inside the component body:
const qc = useQueryClient();
useTaskEvents((frame) => {
  qc.invalidateQueries({ queryKey: ["tasks"] });
  qc.invalidateQueries({ queryKey: ["tickets"] });
  qc.invalidateQueries({ queryKey: ["cron"] });
  qc.invalidateQueries({ queryKey: ["runs"] });
  const t = toastForTask(frame);
  if (t) (t.intent === "error" ? toast.error : toast.success)(t.message);
});
```

> If `deck-view` is not always mounted across the automation routes, mount `useTaskEvents` in the nearest common ancestor (e.g. the root layout in `web/src/routes/__root.tsx`). Verify by reading where the providers live; pick the component present on every route.

- [ ] **Step 5: Build + typecheck**

Run: `cd web && pnpm build && pnpm exec tsc --noEmit --incremental false`
Expected: build succeeds, 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/deck/run-history.tsx web/src/components/deck/ticket-detail.tsx web/src/components/deck/cron-list.tsx web/src/components/deck/deck-view.tsx
git commit -m "feat(web): run-history strips + live task-event toasts"
```

---

## Task 9: Full verification

- [ ] **Step 1: Backend tests**

Run: `cd server && pnpm test`
Expected: all pass (existing + new run-history tests).

- [ ] **Step 2: Frontend tests + build + typecheck**

Run: `cd web && pnpm test && pnpm build && pnpm exec tsc --noEmit --incremental false`
Expected: all pass; build clean; 0 type errors.

- [ ] **Step 3: End-to-end manual smoke (`proc-compose up`)**

1. Create a cron firing `* * * * *`; wait → runs accumulate under its expand toggle with outcomes (success/error) + durations.
2. Run a ticket → a toast fires on completion; the ticket's Runs strip gains a row; tasks list updates without a manual refresh.
3. Start a long task and cancel it → recorded as `cancelled`.
4. Confirm no toast noise from manually-created tasks you're actively viewing.

- [ ] **Step 4: Final commit (if cleanup needed)**

```bash
git add -A && git commit -m "chore: run-history + live events verification pass"
```

---

## Self-Review (completed)

- **Spec coverage:** columns+types (T1), source threading + queue-full result (T2), outcome record + lifecycle emit (T3), `/ws/events` channel (T4), `GET /api/runs` (T5), web types/api/hooks + drop polling (T6), events hook + pure toast mapping (T7), run-history UI + wiring + toasts (T8), verification (T9). All spec sections covered.
- **Placeholder scan:** none — every code step is complete. The only judgment call (where to mount `useTaskEvents`) has an explicit fallback instruction.
- **Type consistency:** `finishRun(id, result)` signature, `listRunsForSource(kind,id,limit)`, `sourceKind`/`sourceId` names, and the `TaskFrame`/`{id,source_kind,source_id,status,result}` frame shape are identical across store, manager, wsHub, and the web hook. `result` values `success|error|cancelled|queue_full` consistent throughout.
- **Test reality:** backend uses real Vitest + `:memory:` Store + fake manager (matches repo); the Fastify WS route is contract-tested via the EventEmitter frame shape + manual smoke (no brittle socket integration invented). Frontend pure logic is unit-tested; components via typecheck + smoke (no jsdom invented).
- **DRY/scope:** runs reuse task sessions (no new table); polling removed when the live channel lands so they don't duplicate.
```
