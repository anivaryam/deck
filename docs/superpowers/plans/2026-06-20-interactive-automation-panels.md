# Interactive Automation Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tasks, Cron, and Tickets panels fully interactive (create / edit / run / cancel / delete) from the UI by closing the specific gaps in the existing wiring.

**Architecture:** Extend in place. Add a handful of server endpoints + one store method, widen two client API methods, add four React Query hooks, give the existing `CronForm`/`TicketForm` an optional edit mode, add a new `TaskForm` and a task action row. No new abstractions; mirror the patterns already in the codebase.

**Tech Stack:** Fastify v5 + better-sqlite3 + vitest (server); React 19 + TanStack Router/Query + Tailwind + sonner + vitest (web). Tests run with `vitest run`.

**Spec:** `docs/superpowers/specs/2026-06-20-interactive-automation-panels-design.md`

**Conventions confirmed from the codebase (do not deviate):**
- Server route errors: `return reply.code(N).send({ error: 'message' })`. 204 on success-with-no-body: `return reply.code(204).send()`.
- `registerRoutes(app, { store, config, taskRunner, scheduler, manager?, closeRoom? })` — `manager` and `closeRoom` are **optional** (omitted by most tests).
- `taskRunner.run(...)` sets the new task's status to `'active'` **synchronously**, so a task created in a test is `active` until something marks it otherwise.
- Store mutators that touch a subset of columns build a dynamic `SET` from a fixed allowlist (see `updateTicket`).
- Client fetch helper: every method uses `fetch(url, { credentials: "same-origin" })` and pipes through `json<T>(res)`; DELETE methods inline an ok-check (see `deleteTicket`/`deleteCron`).
- Web has **no component-test harness** (all web tests live in `web/src/lib/*.test.ts` and test pure functions / the api client). UI components are therefore verified by typecheck + manual smoke, not unit tests.

---

## File Structure

**Server — modify:**
- `server/src/store.ts` — add `updateCron(id, patch)`.
- `server/src/routes.ts` — add `DELETE /api/tasks/:id`, `POST /api/tasks/:id/cancel`, `POST /api/cron/:id/run`; widen `PATCH /api/cron/:id` and `PATCH /api/tickets/:id`.

**Server — create:**
- `server/test/store.cron.test.ts` — store `updateCron` tests.
- `server/test/routes.interactive.test.ts` — tests for all new/changed routes (harness includes a `manager` stub).

**Client — modify:**
- `web/src/lib/api.ts` — add `deleteTask`, `cancelTask`, `runCron`; widen `updateCron`, `updateTicket`.
- `web/src/lib/api.tickets-tasks-cron.test.ts` — update the `updateCron` test, add tests for new methods.
- `web/src/hooks/use-automation-data.ts` — add `useDeleteTask`, `useCancelTask`, `useRunCron`; widen `useUpdateCron`, `useUpdateTicket`.
- `web/src/components/deck/cron-list.tsx` — update toggle callsite for widened hook; add Edit + Fire-now buttons.
- `web/src/components/deck/cron-form.tsx` — optional edit mode.
- `web/src/components/deck/ticket-form.tsx` — optional edit mode.
- `web/src/components/deck/ticket-detail.tsx` — add Edit button + edit mode.
- `web/src/routes/tasks.tsx` — add "New task" action + task action row.

**Client — create:**
- `web/src/components/deck/task-form.tsx` — ad-hoc task create form.
- `web/src/components/deck/task-actions.tsx` — cancel / re-run / delete row for a selected task.

---

## PHASE 1 — Server

### Task 1: `store.updateCron(id, patch)`

**Files:**
- Modify: `server/src/store.ts` (add method near `setCronEnabled`, ~line 389)
- Test: `server/test/store.cron.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/test/store.cron.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;

beforeEach(() => {
  store = new Store(':memory:');
});

describe('Store.updateCron', () => {
  it('updates schedule and prompt in place', () => {
    const c = store.createCron({ schedule: '0 3 * * *', projectPath: '/p/a', prompt: 'old' });
    store.updateCron(c.id, { schedule: '0 4 * * *', prompt: 'new' });
    const got = store.getCron(c.id)!;
    expect(got.schedule).toBe('0 4 * * *');
    expect(got.prompt).toBe('new');
  });

  it('updates only the provided field', () => {
    const c = store.createCron({ schedule: '0 3 * * *', projectPath: '/p/a', prompt: 'keep' });
    store.updateCron(c.id, { schedule: '*/10 * * * *' });
    const got = store.getCron(c.id)!;
    expect(got.schedule).toBe('*/10 * * * *');
    expect(got.prompt).toBe('keep');
  });

  it('is a no-op when the patch is empty', () => {
    const c = store.createCron({ schedule: '0 3 * * *', projectPath: '/p/a', prompt: 'keep' });
    store.updateCron(c.id, {});
    const got = store.getCron(c.id)!;
    expect(got.schedule).toBe('0 3 * * *');
    expect(got.prompt).toBe('keep');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- store.cron`
Expected: FAIL — `store.updateCron is not a function`.

- [ ] **Step 3: Implement the method**

In `server/src/store.ts`, immediately after the `setCronEnabled` method (the block ending at ~line 391), add:

```typescript
  /** Update a cron's schedule and/or prompt in place (keeps run history). Column
   *  names are a fixed allowlist — safe to interpolate. No-op on an empty patch. */
  updateCron(id: string, p: { schedule?: string; prompt?: string }): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of ['schedule', 'prompt'] as const) {
      if (p[k] !== undefined) {
        sets.push(`${k} = ?`);
        vals.push(p[k]);
      }
    }
    if (!sets.length) return;
    vals.push(id);
    this.db.prepare(`UPDATE cron SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- store.cron`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add server/src/store.ts server/test/store.cron.test.ts
git commit -m "feat(store): add updateCron for in-place schedule/prompt edits"
```

---

### Task 2: `DELETE /api/tasks/:id` (+ shared interactive-routes test harness)

**Files:**
- Modify: `server/src/routes.ts` (in the `// tasks` block, after the `POST /api/tasks` handler, ~line 232)
- Test: `server/test/routes.interactive.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/test/routes.interactive.test.ts`. This harness mirrors `routes.phase2.test.ts` but adds a `manager` stub (needed by the cancel route in Task 3) and a `closeRoom` spy:

```typescript
// server/test/routes.interactive.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
let cancelSpy: ReturnType<typeof vi.fn>;
let isActiveSpy: ReturnType<typeof vi.fn>;

const TOKEN = 'interactive-test-token-9012';

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-interactive-'));
  fs.mkdirSync(path.join(root, 'alpha'));

  store = new Store(':memory:');
  const fakeSdkManager = { send: async (_id: string, _p: string): Promise<void> => {}, emit: () => true } as any;
  const taskRunner = new TaskRunner(store, fakeSdkManager);
  const scheduler = new Scheduler(store, taskRunner);

  cancelSpy = vi.fn(() => true);
  isActiveSpy = vi.fn(() => false);
  const manager = { cancel: cancelSpy, isActive: isActiveSpy, discard: vi.fn() } as any;

  app = Fastify();
  await app.register(cookie);
  registerRoutes(app, {
    store,
    config: { token: TOKEN, projectsRoot: root, port: 1, model: 'claude-opus-4-8' },
    taskRunner,
    scheduler,
    manager,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function login(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
  return res.headers['set-cookie'] as string;
}

async function createTask(cookieHeader: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { cookie: cookieHeader },
    payload: { project: 'alpha', prompt: 'do the thing' },
  });
  return res.json().id;
}

describe('DELETE /api/tasks/:id', () => {
  it('404 for a missing id', async () => {
    const c = await login();
    const res = await app.inject({ method: 'DELETE', url: '/api/tasks/nope', headers: { cookie: c } });
    expect(res.statusCode).toBe(404);
  });

  it('404 when the id is a chat session, not a task', async () => {
    const c = await login();
    const sess = await app.inject({
      method: 'POST', url: '/api/sessions', headers: { cookie: c }, payload: { project: 'alpha' },
    });
    const id = sess.json().id;
    const res = await app.inject({ method: 'DELETE', url: `/api/tasks/${id}`, headers: { cookie: c } });
    expect(res.statusCode).toBe(404);
  });

  it('409 while the task is active', async () => {
    const c = await login();
    const id = await createTask(c); // taskRunner marks it active synchronously
    const res = await app.inject({ method: 'DELETE', url: `/api/tasks/${id}`, headers: { cookie: c } });
    expect(res.statusCode).toBe(409);
  });

  it('204 and removes a finished task', async () => {
    const c = await login();
    const id = await createTask(c);
    store.setStatus(id, 'idle'); // simulate completion
    const res = await app.inject({ method: 'DELETE', url: `/api/tasks/${id}`, headers: { cookie: c } });
    expect(res.statusCode).toBe(204);
    expect(store.get(id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- routes.interactive`
Expected: FAIL — the 409 and 204 cases return 404 (route not defined yet); or all delete cases fail.

- [ ] **Step 3: Implement the route**

In `server/src/routes.ts`, in the `// tasks` section, immediately after the `POST /api/tasks` handler (~line 232), add:

```typescript
  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const s = store.get(req.params.id);
    if (!s || s.kind !== 'task') return reply.code(404).send({ error: 'not found' });
    // A run record is immutable history; deleting a live run would orphan its
    // in-flight turn. Make the caller cancel first.
    if (s.status === 'active' || manager?.isActive(req.params.id)) {
      return reply.code(409).send({ error: 'cancel the task before deleting it' });
    }
    store.deleteSession(req.params.id); // reuses the event-cascade transaction
    closeRoom?.(req.params.id);
    return reply.code(204).send();
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- routes.interactive`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes.ts server/test/routes.interactive.test.ts
git commit -m "feat(api): DELETE /api/tasks/:id with active-run guard"
```

---

### Task 3: `POST /api/tasks/:id/cancel`

**Files:**
- Modify: `server/src/routes.ts` (after the new `DELETE /api/tasks/:id`)
- Test: `server/test/routes.interactive.test.ts` (append a `describe`)

- [ ] **Step 1: Write the failing test**

Append to `server/test/routes.interactive.test.ts` (after the `DELETE` describe):

```typescript
describe('POST /api/tasks/:id/cancel', () => {
  it('404 for a non-task id', async () => {
    const c = await login();
    const res = await app.inject({ method: 'POST', url: '/api/tasks/nope/cancel', headers: { cookie: c } });
    expect(res.statusCode).toBe(404);
  });

  it('aborts an active task via the manager and reports aborted:true', async () => {
    const c = await login();
    const id = await createTask(c);
    const res = await app.inject({ method: 'POST', url: `/api/tasks/${id}/cancel`, headers: { cookie: c } });
    expect(res.statusCode).toBe(200);
    expect(res.json().aborted).toBe(true);
    expect(cancelSpy).toHaveBeenCalledWith(id);
  });

  it('is idempotent: aborted:false when nothing was running', async () => {
    const c = await login();
    const id = await createTask(c);
    cancelSpy.mockReturnValueOnce(false);
    const res = await app.inject({ method: 'POST', url: `/api/tasks/${id}/cancel`, headers: { cookie: c } });
    expect(res.statusCode).toBe(200);
    expect(res.json().aborted).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- routes.interactive`
Expected: FAIL — cancel route returns 404 (not defined).

- [ ] **Step 3: Implement the route**

In `server/src/routes.ts`, immediately after the new `DELETE /api/tasks/:id` handler, add:

```typescript
  app.post<{ Params: { id: string } }>('/api/tasks/:id/cancel', async (req, reply) => {
    const s = store.get(req.params.id);
    if (!s || s.kind !== 'task') return reply.code(404).send({ error: 'not found' });
    // Reuse the same abort path the chat WS + session-delete use. Idempotent:
    // cancel() returns false when no turn is in flight.
    const aborted = manager?.cancel(req.params.id) ?? false;
    return { aborted };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- routes.interactive`
Expected: PASS (delete + cancel describes green).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes.ts server/test/routes.interactive.test.ts
git commit -m "feat(api): POST /api/tasks/:id/cancel reusing SessionManager abort"
```

---

### Task 4: `POST /api/cron/:id/run` (fire-now)

**Files:**
- Modify: `server/src/routes.ts` (in the `// cron` block, after `DELETE /api/cron/:id`, ~line 274)
- Test: `server/test/routes.interactive.test.ts` (append a `describe`)

- [ ] **Step 1: Write the failing test**

Append to `server/test/routes.interactive.test.ts`:

```typescript
describe('POST /api/cron/:id/run', () => {
  async function createCron(c: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/cron', headers: { cookie: c },
      payload: { schedule: '0 3 * * *', project: 'alpha', prompt: 'tick' },
    });
    return res.json().id;
  }

  it('404 for a missing cron', async () => {
    const c = await login();
    const res = await app.inject({ method: 'POST', url: '/api/cron/nope/run', headers: { cookie: c } });
    expect(res.statusCode).toBe(404);
  });

  it('fires immediately and returns a session_id, recording it on the cron', async () => {
    const c = await login();
    const id = await createCron(c);
    const res = await app.inject({ method: 'POST', url: `/api/cron/${id}/run`, headers: { cookie: c } });
    expect(res.statusCode).toBe(200);
    const { session_id } = res.json();
    expect(typeof session_id).toBe('string');
    const session = store.get(session_id)!;
    expect(session.kind).toBe('task');
    expect(session.origin).toBe('cron');
    expect(store.getCron(id)!.last_session_id).toBe(session_id);
  });

  it('409 when the previous run is still active (overlap guard)', async () => {
    const c = await login();
    const id = await createCron(c);
    await app.inject({ method: 'POST', url: `/api/cron/${id}/run`, headers: { cookie: c } }); // run 1 stays active
    const res = await app.inject({ method: 'POST', url: `/api/cron/${id}/run`, headers: { cookie: c } });
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- routes.interactive`
Expected: FAIL — fire-now route returns 404.

- [ ] **Step 3: Implement the route**

In `server/src/routes.ts`, in the `// cron` block, immediately after the `DELETE /api/cron/:id` handler (~line 274), add:

```typescript
  app.post<{ Params: { id: string } }>('/api/cron/:id/run', async (req, reply) => {
    const c = store.getCron(req.params.id);
    if (!c) return reply.code(404).send({ error: 'not found' });
    // Same overlap guard the scheduler applies — don't stack a second run (and its
    // spend) on top of one already in flight. Min-interval is intentionally NOT
    // checked here: a manual fire is an explicit user action.
    if (c.last_session_id) {
      const prev = store.get(c.last_session_id);
      if (prev && prev.status === 'active') return reply.code(409).send({ error: 'a run is already in progress' });
    }
    const sessionId = taskRunner.run({
      projectPath: c.project_path,
      prompt: c.prompt,
      origin: 'cron',
      sourceKind: 'cron',
      sourceId: c.id,
    });
    store.recordCronRun(c.id, sessionId);
    return { session_id: sessionId };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- routes.interactive`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes.ts server/test/routes.interactive.test.ts
git commit -m "feat(api): POST /api/cron/:id/run fire-now with overlap guard"
```

---

### Task 5: Widen `PATCH /api/cron/:id` to edit schedule + prompt

**Files:**
- Modify: `server/src/routes.ts` (replace the existing `PATCH /api/cron/:id` handler, ~lines 264-269)
- Test: `server/test/routes.interactive.test.ts` (append a `describe`)

- [ ] **Step 1: Write the failing test**

Append to `server/test/routes.interactive.test.ts`:

```typescript
describe('PATCH /api/cron/:id (edit schedule/prompt)', () => {
  async function createCron(c: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/cron', headers: { cookie: c },
      payload: { schedule: '0 3 * * *', project: 'alpha', prompt: 'old' },
    });
    return res.json().id;
  }

  it('updates schedule and prompt', async () => {
    const c = await login();
    const id = await createCron(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/cron/${id}`, headers: { cookie: c },
      payload: { schedule: '0 4 * * *', prompt: 'new' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().schedule).toBe('0 4 * * *');
    expect(res.json().prompt).toBe('new');
  });

  it('rejects an invalid schedule with 400', async () => {
    const c = await login();
    const id = await createCron(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/cron/${id}`, headers: { cookie: c },
      payload: { schedule: 'not a cron' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/invalid cron/i);
  });

  it('rejects a too-frequent schedule with 400', async () => {
    const c = await login();
    const id = await createCron(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/cron/${id}`, headers: { cookie: c },
      payload: { schedule: '*/30 * * * * *' }, // 30s gap < 60s min
    });
    expect(res.statusCode).toBe(400);
  });

  it('still toggles enabled', async () => {
    const c = await login();
    const id = await createCron(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/cron/${id}`, headers: { cookie: c },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- routes.interactive`
Expected: FAIL — schedule/prompt are ignored (the "updates schedule and prompt" + invalid-schedule cases fail); the enabled case still passes.

- [ ] **Step 3: Implement the route**

In `server/src/routes.ts`, replace the existing `PATCH /api/cron/:id` handler (~lines 264-269):

```typescript
  app.patch<{ Params: { id: string }; Body: { enabled?: boolean } }>('/api/cron/:id', async (req, reply) => {
    if (!store.getCron(req.params.id)) return reply.code(404).send({ error: 'not found' });
    if (typeof req.body?.enabled === 'boolean') store.setCronEnabled(req.params.id, req.body.enabled);
    scheduler.reload();
    return store.getCron(req.params.id);
  });
```

with:

```typescript
  app.patch<{ Params: { id: string }; Body: { enabled?: boolean; schedule?: string; prompt?: string } }>(
    '/api/cron/:id',
    async (req, reply) => {
      if (!store.getCron(req.params.id)) return reply.code(404).send({ error: 'not found' });
      const { enabled, schedule, prompt } = req.body ?? {};
      if (schedule !== undefined) {
        if (!Scheduler.isValid(schedule)) return reply.code(400).send({ error: 'invalid cron expression' });
        const minGap = config.cronMinIntervalSec ?? 60;
        const gap = Scheduler.minIntervalSec(schedule);
        if (gap !== null && gap < minGap) {
          return reply.code(400).send({ error: `cron fires too frequently — minimum ${minGap}s between runs` });
        }
      }
      if (typeof enabled === 'boolean') store.setCronEnabled(req.params.id, enabled);
      if (schedule !== undefined || prompt !== undefined) store.updateCron(req.params.id, { schedule, prompt });
      scheduler.reload();
      return store.getCron(req.params.id);
    },
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- routes.interactive`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes.ts server/test/routes.interactive.test.ts
git commit -m "feat(api): PATCH /api/cron/:id can edit schedule + prompt (validated)"
```

---

### Task 6: Widen `PATCH /api/tickets/:id` to edit title + body

**Files:**
- Modify: `server/src/routes.ts` (replace the existing `PATCH /api/tickets/:id` handler, ~lines 289-296)
- Test: `server/test/routes.interactive.test.ts` (append a `describe`)

- [ ] **Step 1: Write the failing test**

Append to `server/test/routes.interactive.test.ts`:

```typescript
describe('PATCH /api/tickets/:id (edit title/body)', () => {
  async function createTicket(c: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/tickets', headers: { cookie: c },
      payload: { title: 'old title', project: 'alpha', body: 'old body' },
    });
    return res.json().id;
  }

  it('updates title and body', async () => {
    const c = await login();
    const id = await createTicket(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/tickets/${id}`, headers: { cookie: c },
      payload: { title: 'new title', body: 'new body' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('new title');
    expect(res.json().body).toBe('new body');
  });

  it('rejects an empty title with 400', async () => {
    const c = await login();
    const id = await createTicket(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/tickets/${id}`, headers: { cookie: c },
      payload: { title: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('still updates status', async () => {
    const c = await login();
    const id = await createTicket(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/tickets/${id}`, headers: { cookie: c },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- routes.interactive`
Expected: FAIL — title/body are dropped (the update-title case fails; empty-title returns 200 instead of 400).

- [ ] **Step 3: Implement the route**

In `server/src/routes.ts`, replace the existing `PATCH /api/tickets/:id` handler (~lines 289-296):

```typescript
  app.patch<{ Params: { id: string }; Body: { status?: string; pr_url?: string } }>(
    '/api/tickets/:id',
    async (req, reply) => {
      if (!store.getTicket(req.params.id)) return reply.code(404).send({ error: 'not found' });
      store.updateTicket(req.params.id, { status: req.body?.status, pr_url: req.body?.pr_url });
      return store.getTicket(req.params.id);
    },
  );
```

with:

```typescript
  app.patch<{ Params: { id: string }; Body: { status?: string; pr_url?: string; title?: string; body?: string } }>(
    '/api/tickets/:id',
    async (req, reply) => {
      if (!store.getTicket(req.params.id)) return reply.code(404).send({ error: 'not found' });
      const { status, pr_url, title, body } = req.body ?? {};
      if (title !== undefined && !title.trim()) return reply.code(400).send({ error: 'title cannot be empty' });
      store.updateTicket(req.params.id, { status, pr_url, title, body });
      return store.getTicket(req.params.id);
    },
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- routes.interactive`
Expected: PASS — full file green.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes.ts server/test/routes.interactive.test.ts
git commit -m "feat(api): PATCH /api/tickets/:id can edit title + body"
```

---

## PHASE 2 — Client API + hooks

### Task 7: API methods (`deleteTask`, `cancelTask`, `runCron`; widen `updateCron`, `updateTicket`)

**Files:**
- Modify: `web/src/lib/api.ts`
- Test: `web/src/lib/api.tickets-tasks-cron.test.ts`

- [ ] **Step 1: Update + add the failing tests**

In `web/src/lib/api.tickets-tasks-cron.test.ts`, **replace** the existing `updateCron` test:

```typescript
  it("updateCron() PATCHes enabled", async () => {
    const f = mockFetch(200, { id: "c1", enabled: 0 });
    vi.stubGlobal("fetch", f);
    await api.updateCron("c1", false);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/cron/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ enabled: false });
  });
```

with:

```typescript
  it("updateCron() PATCHes the given patch object", async () => {
    const f = mockFetch(200, { id: "c1", enabled: 0 });
    vi.stubGlobal("fetch", f);
    await api.updateCron("c1", { enabled: false });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/cron/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ enabled: false });
  });

  it("updateCron() can PATCH schedule + prompt", async () => {
    const f = mockFetch(200, { id: "c1" });
    vi.stubGlobal("fetch", f);
    await api.updateCron("c1", { schedule: "0 4 * * *", prompt: "p" });
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ schedule: "0 4 * * *", prompt: "p" });
  });

  it("deleteTask() DELETEs and tolerates 204", async () => {
    const f = mockFetch(204, undefined);
    vi.stubGlobal("fetch", f);
    await api.deleteTask("task1");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/tasks/task1");
    expect(init.method).toBe("DELETE");
  });

  it("deleteTask() surfaces a 409 as ApiError", async () => {
    const f = mockFetch(409, { error: "cancel the task before deleting it" });
    vi.stubGlobal("fetch", f);
    await expect(api.deleteTask("task1")).rejects.toMatchObject({ status: 409 });
  });

  it("cancelTask() POSTs to the cancel subroute and returns {aborted}", async () => {
    const f = mockFetch(200, { aborted: true });
    vi.stubGlobal("fetch", f);
    const out = await api.cancelTask("task1");
    expect(f.mock.calls[0][0]).toBe("/api/tasks/task1/cancel");
    expect(f.mock.calls[0][1].method).toBe("POST");
    expect(out).toEqual({ aborted: true });
  });

  it("runCron() POSTs to the run subroute and returns {session_id}", async () => {
    const f = mockFetch(200, { session_id: "s1" });
    vi.stubGlobal("fetch", f);
    const out = await api.runCron("c1");
    expect(f.mock.calls[0][0]).toBe("/api/cron/c1/run");
    expect(f.mock.calls[0][1].method).toBe("POST");
    expect(out).toEqual({ session_id: "s1" });
  });

  it("updateTicket() can PATCH title + body", async () => {
    const f = mockFetch(200, { id: "t1" });
    vi.stubGlobal("fetch", f);
    await api.updateTicket("t1", { title: "T", body: "B" });
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ title: "T", body: "B" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun run test -- api.tickets-tasks-cron`
Expected: FAIL — `api.deleteTask`/`cancelTask`/`runCron` are not functions; `updateCron("c1", { enabled: false })` sends the object as the `enabled` value.

- [ ] **Step 3: Implement the API changes**

In `web/src/lib/api.ts`, **replace** the `updateCron` method:

```typescript
  async updateCron(id: string, enabled: boolean): Promise<Cron> {
    return json(
      await fetch(`/api/cron/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
        credentials: "same-origin",
      }),
    );
  },
```

with:

```typescript
  async updateCron(
    id: string,
    patch: { enabled?: boolean; schedule?: string; prompt?: string },
  ): Promise<Cron> {
    return json(
      await fetch(`/api/cron/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        credentials: "same-origin",
      }),
    );
  },
  async runCron(id: string): Promise<{ session_id: string }> {
    return json(
      await fetch(`/api/cron/${id}/run`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },
```

In the `// ---- tasks ----` section, after `createTask`, add:

```typescript
  async cancelTask(id: string): Promise<{ aborted: boolean }> {
    return json(
      await fetch(`/api/tasks/${id}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },
  async deleteTask(id: string): Promise<void> {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        const b = await res.json();
        if (b?.error) msg = b.error;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, msg);
    }
  },
```

**Replace** the `updateTicket` method signature to widen the patch type:

```typescript
  async updateTicket(
    id: string,
    patch: { status?: string; pr_url?: string },
  ): Promise<Ticket> {
```

with:

```typescript
  async updateTicket(
    id: string,
    patch: { status?: string; pr_url?: string; title?: string; body?: string },
  ): Promise<Ticket> {
```

(the method body is unchanged).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- api.tickets-tasks-cron`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/api.tickets-tasks-cron.test.ts
git commit -m "feat(web/api): add deleteTask/cancelTask/runCron; widen updateCron/updateTicket"
```

---

### Task 8: React Query hooks + cron toggle callsite

**Files:**
- Modify: `web/src/hooks/use-automation-data.ts`
- Modify: `web/src/components/deck/cron-list.tsx` (toggle callsite only, line 21-22)

- [ ] **Step 1: Widen and add hooks**

In `web/src/hooks/use-automation-data.ts`, **replace** `useUpdateCron`:

```typescript
export function useUpdateCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; enabled: boolean }) => api.updateCron(args.id, args.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}
```

with:

```typescript
export function useUpdateCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: { enabled?: boolean; schedule?: string; prompt?: string } }) =>
      api.updateCron(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}

export function useRunCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.runCron(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cron"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
```

**Replace** `useUpdateTicket`:

```typescript
export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: { status?: string; pr_url?: string } }) =>
      api.updateTicket(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}
```

with:

```typescript
export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: { status?: string; pr_url?: string; title?: string; body?: string } }) =>
      api.updateTicket(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}
```

At the end of the `// ---- mutations ----` section, add:

```typescript
export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}
```

- [ ] **Step 2: Fix the cron toggle callsite for the widened hook**

In `web/src/components/deck/cron-list.tsx`, **replace** the `onToggle` handler (lines 21-22):

```typescript
  const onToggle = (id: string, enabled: boolean) =>
    toggle.mutate({ id, enabled }, { onError: (e) => toast.error(`Couldn’t update schedule: ${e instanceof Error ? e.message : "error"}`) });
```

with:

```typescript
  const onToggle = (id: string, enabled: boolean) =>
    toggle.mutate({ id, patch: { enabled } }, { onError: (e) => toast.error(`Couldn’t update schedule: ${e instanceof Error ? e.message : "error"}`) });
```

- [ ] **Step 3: Typecheck**

Run: `cd web && bun run build`
Expected: PASS — no type errors. (If `bun run build` is unavailable, use the project's typecheck script from `web/package.json`.)

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/use-automation-data.ts web/src/components/deck/cron-list.tsx
git commit -m "feat(web/hooks): add useRunCron/useDeleteTask/useCancelTask; widen update hooks"
```

---

## PHASE 3 — Client UI

### Task 9: `CronForm` edit mode + `CronList` Edit button

**Files:**
- Modify: `web/src/components/deck/cron-form.tsx`
- Modify: `web/src/components/deck/cron-list.tsx`

- [ ] **Step 1: Add edit mode to `CronForm`**

Replace the whole of `web/src/components/deck/cron-form.tsx` with:

```typescript
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateCron, useUpdateCron } from "@/hooks/use-automation-data";
import { ApiError } from "@/lib/api";

export function CronForm({
  projectName,
  onDone,
  initial,
}: {
  projectName?: string;
  onDone: () => void;
  initial?: { id: string; schedule: string; prompt: string };
}) {
  const [schedule, setSchedule] = useState(initial?.schedule ?? "0 3 * * *");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateCron();
  const update = useUpdateCron();
  const editing = !!initial;
  const pending = create.isPending || update.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      if (editing) {
        await update.mutateAsync({ id: initial!.id, patch: { schedule, prompt } });
      } else {
        await create.mutateAsync({ schedule, project: projectName!, prompt });
      }
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : `failed to ${editing ? "update" : "create"} cron`);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <input
        autoFocus
        className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm"
        placeholder="cron expression e.g. 0 3 * * *"
        value={schedule}
        onChange={(e) => setSchedule(e.target.value)}
        required
      />
      <textarea
        className="min-h-24 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Prompt to run on schedule"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        required
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!schedule || !prompt || pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create cron"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Add an Edit button + inline edit form to `CronList`**

In `web/src/components/deck/cron-list.tsx`:

Add the import at the top (alongside the existing imports):

```typescript
import { CronForm } from "./cron-form";
```

Add an editing-id state inside the component, next to the existing `open` state (~line 15):

```typescript
  const [editingId, setEditingId] = useState<string | null>(null);
```

**Replace** the per-cron row markup (the `<div key={c.id}>` block, lines 33-65) with a version that swaps in the edit form when that row is being edited and adds an Edit button:

```typescript
      {crons.map((c) =>
        editingId === c.id ? (
          <div key={c.id} className="rounded-md border border-border bg-card">
            <CronForm
              initial={{ id: c.id, schedule: c.schedule, prompt: c.prompt }}
              onDone={() => setEditingId(null)}
            />
          </div>
        ) : (
          <div key={c.id}>
            <div className="flex items-center gap-3 rounded-md border border-transparent px-3.5 py-3 hover:border-border hover:bg-card">
              <Switch
                checked={c.enabled === 1}
                onCheckedChange={(v) => onToggle(c.id, v)}
                disabled={toggle.isPending}
                aria-label={c.enabled === 1 ? "Disable schedule" : "Enable schedule"}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-sm text-foreground">{c.schedule}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{c.prompt}</span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                last: {relativeTime(c.last_run_at)}
              </span>
              <button
                onClick={() => setOpen((s) => ({ ...s, [c.id]: !s[c.id] }))}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Show runs"
              >
                <ChevronRight className={cn("size-4 transition-transform", open[c.id] && "rotate-90")} />
              </button>
              <Button variant="ghost" size="sm" onClick={() => setEditingId(c.id)}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onDelete(c)} disabled={del.isPending}>
                Delete
              </Button>
            </div>
            {open[c.id] && (
              <div className="ml-9 border-l border-border pl-2">
                <RunHistory sourceKind="cron" sourceId={c.id} projectPath={c.project_path} />
              </div>
            )}
          </div>
        ),
      )}
```

- [ ] **Step 3: Typecheck + manual smoke**

Run: `cd web && bun run build`
Expected: PASS.

Manual smoke (after `proc-compose up`): open the Cron panel, click **Edit** on a schedule, change the prompt, **Save changes**, confirm the row updates. Enter an invalid expression and confirm the inline error shows.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/deck/cron-form.tsx web/src/components/deck/cron-list.tsx
git commit -m "feat(web/cron): edit schedule + prompt in place"
```

---

### Task 10: `CronList` Fire-now button

**Files:**
- Modify: `web/src/components/deck/cron-list.tsx`

- [ ] **Step 1: Wire fire-now**

In `web/src/components/deck/cron-list.tsx`:

Extend the hooks import to include `useRunCron`:

```typescript
import { useDeleteCron, useRunCron, useUpdateCron } from "@/hooks/use-automation-data";
```

Inside the component, next to `const del = useDeleteCron();`, add:

```typescript
  const fire = useRunCron();
  const onFire = (c: Cron) =>
    fire.mutate(c.id, {
      onSuccess: () => toast.success("Run started"),
      onError: (e) => toast.error(`Couldn’t start run: ${e instanceof Error ? e.message : "error"}`),
    });
```

In the row markup (the non-editing branch from Task 9), add a Fire-now button immediately before the **Edit** button:

```typescript
              <Button variant="ghost" size="sm" onClick={() => onFire(c)} disabled={fire.isPending} aria-label="Run now">
                ▶ Run
              </Button>
```

- [ ] **Step 2: Typecheck + manual smoke**

Run: `cd web && bun run build`
Expected: PASS.

Manual smoke: click **▶ Run** on a schedule, confirm a "Run started" toast and a new task appears in the Tasks panel for that project. Click it again immediately while the first run is active and confirm the overlap error toast.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/deck/cron-list.tsx
git commit -m "feat(web/cron): fire-now button to trigger a run on demand"
```

---

### Task 11: `TicketForm` edit mode + `TicketDetail` Edit button

**Files:**
- Modify: `web/src/components/deck/ticket-form.tsx`
- Modify: `web/src/components/deck/ticket-detail.tsx`

- [ ] **Step 1: Add edit mode to `TicketForm`**

Replace the whole of `web/src/components/deck/ticket-form.tsx` with:

```typescript
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateTicket, useUpdateTicket } from "@/hooks/use-automation-data";
import { ApiError } from "@/lib/api";

export function TicketForm({
  projectName,
  onDone,
  initial,
}: {
  projectName?: string;
  onDone: () => void;
  initial?: { id: string; title: string; body: string };
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateTicket();
  const update = useUpdateTicket();
  const editing = !!initial;
  const pending = create.isPending || update.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      if (editing) {
        await update.mutateAsync({ id: initial!.id, patch: { title, body } });
      } else {
        await create.mutateAsync({ project: projectName!, title, body: body || undefined });
      }
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : `failed to ${editing ? "update" : "create"} ticket`);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <input
        autoFocus
        className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Ticket title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        className="min-h-24 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Details (markdown)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title || pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create ticket"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Add Edit button + edit mode to `TicketDetail`**

In `web/src/components/deck/ticket-detail.tsx`:

Add imports — `useState` and the `Pencil` icon and the form:

```typescript
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { TicketForm } from "./ticket-form";
```

(Replace the existing `import { Trash2 } from "lucide-react";` line with the `Pencil, Trash2` version above.)

Inside the component, after `const del = useDeleteTicket();`, add:

```typescript
  const [editing, setEditing] = useState(false);
```

Immediately after the opening `<div className="flex h-full flex-col">` (line 22), short-circuit to the edit form when editing:

```typescript
  if (editing) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border p-4 text-sm font-bold">Edit ticket</div>
        <TicketForm
          initial={{ id: ticket.id, title: ticket.title, body: ticket.body ?? "" }}
          onDone={() => setEditing(false)}
        />
      </div>
    );
  }
```

(Place this block at the very top of the component body, before the `return (` for the normal view.)

In the action row (the `<div className="flex gap-2 border-t border-border p-4">` block), add an Edit button immediately after the **Run** button and before the Delete button:

```typescript
        <Button
          variant="ghost"
          size="icon"
          aria-label="Edit ticket"
          title="Edit ticket"
          onClick={() => setEditing(true)}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-4" />
        </Button>
```

- [ ] **Step 3: Typecheck + manual smoke**

Run: `cd web && bun run build`
Expected: PASS.

Manual smoke: open a ticket, click the **Edit** (pencil) button, change title + body, **Save changes**, confirm the detail reflects the edit. Try clearing the title and confirm the Save button disables (and the server rejects an all-whitespace title).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/deck/ticket-form.tsx web/src/components/deck/ticket-detail.tsx
git commit -m "feat(web/tickets): edit title + body from the detail pane"
```

---

### Task 12: `TaskForm` + "New task" action on the Tasks panel

**Files:**
- Create: `web/src/components/deck/task-form.tsx`
- Modify: `web/src/routes/tasks.tsx`

- [ ] **Step 1: Create `TaskForm`**

Create `web/src/components/deck/task-form.tsx`:

```typescript
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateTask } from "@/hooks/use-automation-data";
import { ApiError } from "@/lib/api";

const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"] as const;

export function TaskForm({ projectName, onDone }: { projectName: string; onDone: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<(typeof EFFORTS)[number]>("");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateTask();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({
        project: projectName,
        prompt,
        model: model || undefined,
        effort: effort || undefined,
      });
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "failed to create task");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <textarea
        autoFocus
        className="min-h-24 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Prompt to run as a one-off task"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        required
      />
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs"
          placeholder="model (optional, e.g. claude-opus-4-8)"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <select
          className="rounded-md border border-input bg-input/40 px-3 py-2 text-xs"
          value={effort}
          onChange={(e) => setEffort(e.target.value as (typeof EFFORTS)[number])}
          aria-label="effort"
        >
          {EFFORTS.map((e) => (
            <option key={e || "default"} value={e}>
              {e || "default effort"}
            </option>
          ))}
        </select>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!prompt || create.isPending}>
          {create.isPending ? "Starting…" : "Run task"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Add the "New task" action + create form to the Tasks route**

In `web/src/routes/tasks.tsx`:

Add imports:

```typescript
import { Button } from "@/components/ui/button";
import { TaskForm } from "@/components/deck/task-form";
```

Add a `creating` state next to the existing `selId` state:

```typescript
  const [creating, setCreating] = useState(false);
```

**Replace** the `return (<AutomationPage ... />)` block with one that adds the `actions` prop and swaps the list for the create form when creating:

```typescript
  return (
    <AutomationPage
      projectName={name ?? project}
      projectThreadId={projectThreadId}
      section="Tasks"
      actions={
        <Button disabled={!name} onClick={() => setCreating(true)}>
          + New task
        </Button>
      }
      list={
        creating && name ? (
          <TaskForm projectName={name} onDone={() => setCreating(false)} />
        ) : (
          <AsyncBoundary query={tasksQ} label="tasks">
            <TasksList tasks={rows} selectedId={selId} onSelect={(t) => setSelId(t.id)} />
          </AsyncBoundary>
        )
      }
      detail={selId ? <TaskOutput taskId={selId} /> : undefined}
      onCloseDetail={() => setSelId(null)}
    />
  );
```

- [ ] **Step 3: Typecheck + manual smoke**

Run: `cd web && bun run build`
Expected: PASS.

Manual smoke: open the Tasks panel, click **+ New task**, enter a prompt, **Run task**, confirm a new task appears and streams output.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/deck/task-form.tsx web/src/routes/tasks.tsx
git commit -m "feat(web/tasks): ad-hoc task create form + New task action"
```

---

### Task 13: `TaskActions` (cancel / re-run / delete) wired into the Tasks detail

**Files:**
- Create: `web/src/components/deck/task-actions.tsx`
- Modify: `web/src/routes/tasks.tsx`

- [ ] **Step 1: Create `TaskActions`**

Create `web/src/components/deck/task-actions.tsx`:

```typescript
import { toast } from "sonner";
import { RotateCcw, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCancelTask, useCreateTask, useDeleteTask } from "@/hooks/use-automation-data";
import { taskStatus } from "@/lib/automation";
import { ApiError } from "@/lib/api";
import type { Session } from "@/lib/types";

/** Action row for a selected task. Mutually exclusive by state:
 *  active → Cancel; finished → Re-run + Delete. */
export function TaskActions({
  task,
  projectName,
  onDeleted,
}: {
  task: Session;
  projectName: string;
  onDeleted: () => void;
}) {
  const cancel = useCancelTask();
  const rerun = useCreateTask();
  const del = useDeleteTask();
  const active = taskStatus(task) === "running";

  const onCancel = () =>
    cancel.mutate(task.id, {
      onSuccess: (r) => toast.success(r.aborted ? "Task cancelled" : "Task already finished"),
      onError: (e) => toast.error(`Couldn’t cancel: ${e instanceof Error ? e.message : "error"}`),
    });

  const onRerun = () =>
    rerun.mutate(
      { project: projectName, prompt: task.prompt ?? "", model: task.model ?? undefined, effort: task.effort ?? undefined },
      {
        onSuccess: () => toast.success("Re-run started"),
        onError: (e) => toast.error(`Couldn’t re-run: ${e instanceof Error ? e.message : "error"}`),
      },
    );

  const onDelete = () => {
    if (!window.confirm("Delete this task and its output? This cannot be undone.")) return;
    del.mutate(task.id, {
      onSuccess: () => onDeleted(),
      onError: (e) =>
        toast.error(e instanceof ApiError && e.status === 409 ? "Cancel the task before deleting it" : `Couldn’t delete: ${e instanceof Error ? e.message : "error"}`),
    });
  };

  return (
    <div className="flex gap-2 border-b border-border p-3">
      {active ? (
        <Button variant="ghost" size="sm" disabled={cancel.isPending} onClick={onCancel} className="text-muted-foreground hover:text-destructive">
          <XCircle className="mr-1 size-4" /> Cancel
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="sm" disabled={rerun.isPending || !task.prompt} onClick={onRerun}>
            <RotateCcw className="mr-1 size-4" /> Re-run
          </Button>
          <Button variant="ghost" size="sm" disabled={del.isPending} onClick={onDelete} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="mr-1 size-4" /> Delete
          </Button>
        </>
      )}
    </div>
  );
}
```

> Note on `taskStatus`: the existing helper in `web/src/lib/automation.ts:13` (already used by `TasksList`). Confirmed: it returns `"running"` when `session.status === "active"`, `"failed"` for `"errored"`, else `"done"`. The `=== "running"` check above is correct — reuse it, don't invent a new status.

- [ ] **Step 2: Wire `TaskActions` into the detail pane**

In `web/src/routes/tasks.tsx`:

Add the import:

```typescript
import { TaskActions } from "@/components/deck/task-actions";
```

Compute the selected task row next to the other memo/derived values (after `rows`):

```typescript
  const selected = useMemo(() => (data ?? []).find((t) => t.id === selId) ?? null, [data, selId]);
```

**Replace** the `detail={...}` prop in the `AutomationPage` (from Task 12's version):

```typescript
      detail={selId ? <TaskOutput taskId={selId} /> : undefined}
```

with:

```typescript
      detail={
        selected ? (
          <div className="flex h-full flex-col">
            <TaskActions task={selected} projectName={name ?? project} onDeleted={() => setSelId(null)} />
            <TaskOutput taskId={selected.id} />
          </div>
        ) : selId ? (
          <TaskOutput taskId={selId} />
        ) : undefined
      }
```

- [ ] **Step 3: Typecheck + manual smoke**

Run: `cd web && bun run build`
Expected: PASS.

Manual smoke (after `proc-compose up`):
- Select a finished task → see **Re-run** + **Delete**. Re-run starts a new task; Delete (after confirm) removes it and clears the detail.
- Start a long task, select it while active → see **Cancel**. Cancel stops it; the stream shows the cancelled terminal frame.
- Confirm Delete is not offered while active, and that a direct delete of an active task would 409 (guard already covered by server tests).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/deck/task-actions.tsx web/src/routes/tasks.tsx
git commit -m "feat(web/tasks): cancel / re-run / delete actions on a selected task"
```

---

## PHASE 4 — Verification

### Task 14: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full server test suite**

Run: `npm --prefix server test`
Expected: PASS — all suites including `store.cron` and `routes.interactive`.

- [ ] **Step 2: Run the full web test suite**

Run: `cd web && bun run test`
Expected: PASS — including the updated `api.tickets-tasks-cron` tests.

- [ ] **Step 3: Web typecheck/build**

Run: `cd web && bun run build`
Expected: PASS.

- [ ] **Step 4: Live smoke of every action**

Start the stack: `proc-compose up`. Walk each panel for the active project:
- **Tasks:** create (New task → Run task) · re-run a finished task · cancel an active task · delete a finished task.
- **Cron:** create · edit schedule+prompt (Save changes) · fire-now (▶ Run) · overlap rejection on a second immediate fire · toggle enable/disable · delete.
- **Tickets:** create · edit title+body (pencil → Save changes) · run · close/mark-merged (when in review) · delete.

Confirm toasts and list refreshes for each, and that an invalid cron expression / empty ticket title is rejected with a visible error.

- [ ] **Step 5: Final commit (if any smoke fixes were needed)**

```bash
git add -A
git commit -m "test: verification fixes for interactive automation panels"
```

(Skip if Steps 1-4 needed no changes.)

---

## Self-Review (completed by plan author)

**Spec coverage** — every spec item maps to a task:
- Tasks create → Task 12. Tasks re-run → Task 13. Tasks cancel → Tasks 3 (server) + 13 (UI). Tasks delete → Tasks 2 (server) + 13 (UI).
- Cron edit schedule/prompt → Tasks 1 (store) + 5 (route) + 9 (UI). Cron fire-now → Tasks 4 (route) + 10 (UI).
- Tickets edit title/body → Task 6 (route) + 11 (UI).
- Out-of-scope items (ticket manual status, unified CRUD, per-project filtering, cron get-single) are not implemented — correct.

**Type/name consistency** — verified across tasks: `updateCron(id, patch)` and `useUpdateCron({ id, patch })` agree (Tasks 7/8, callsite fixed in Task 8/9); `useUpdateTicket({ id, patch })` widened in Task 8 and used by Task 11; `store.deleteSession` reused (Task 2); `manager.cancel` (Task 3) matches `SessionManager.cancel`; `taskStatus` reused (flagged to confirm the active label in Task 13).

**All code pinned to verified source.** `taskStatus(task) === "running"` (Task 13) confirmed against `web/src/lib/automation.ts:13` (`active → running`). No open placeholders.
