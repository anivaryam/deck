# Delete Session From Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-session delete control to the deck chat sidebar that removes the session and its stored events, cancelling any in-flight agent turn and closing live WebSocket rooms.

**Architecture:** Server gets a `DELETE /api/sessions/:id` route (mirrors the existing cron-delete pattern) backed by a transactional `Store.deleteSession` (cascades events), a `SessionManager.discard` that aborts a running turn and suppresses its trailing event writes, and a `closeRoom` handle returned from the WS hub. Client adds `api.deleteSession`, a hover trash + confirm-popover in the sidebar, and a `deck-view` handler that invalidates the session list, navigates away if the deleted session is open, and toasts.

**Tech Stack:** Fastify + better-sqlite3 + vitest (server); React + TanStack Router + TanStack Query + Radix Popover + sonner + vitest (web).

---

## Spec

Source: `docs/superpowers/specs/2026-06-17-delete-session-design.md`

## Execution corrections (discovered at worktree setup — these OVERRIDE task text below)

The plan was written before inspecting the live test harness. Corrections, applied during execution:

1. **Isolation:** Work happens in a git worktree at
   `~/.config/superpowers/worktrees/deck/feat-delete-session` (branch `feat/delete-session`),
   off clean `master` HEAD `2e32bbd` — a second agent has the main working tree dirty on the
   same files. Baseline verified: server `npm test` = 113 passing; web build + typecheck clean.
2. **Tests already exist** in `server/test/*.test.ts` (vitest `include: ['test/**/*.test.ts']`,
   imports use `../src/...`). New tests go there as suffixed files, NOT in `server/src/`:
   - Task 1 → `server/test/store.deleteSession.test.ts`
   - Task 2 → `server/test/sessionManager.discard.test.ts`
   - Task 4 → `server/test/routes.deleteSession.test.ts`
3. **`RouteDeps.manager` and `RouteDeps.closeRoom` are OPTIONAL** (`manager?`, `closeRoom?`).
   Existing `routes.test.ts` / `routes.phase2.test.ts` call `registerRoutes` without them, so
   required fields would break the build. The route uses optional chaining:
   `if (manager?.isActive(id)) manager.discard(id);` and `closeRoom?.(id);`.
4. **Test `cfg`** is a plain literal `{ token: 'x'.repeat(16), projectsRoot: '/p', port: 1, model: 'claude-opus-4-8' }`.
   Route tests authenticate via `POST /auth` then resend the `set-cookie` value (the existing
   `routes.test.ts` pattern), omitting `auth` from deps so `registerRoutes` makes its own.
5. **Discard test** fake `queryFn` must read `args.options.abortController` and **throw** when the
   signal is aborted (mimics the real SDK) — that's what drives the `catch`-block `cancelled`
   record the `deleting` guard must suppress.
6. Run server tests from the worktree: `cd <worktree>/server && npm test`.

## Pre-flight notes for the implementer

- Repo currently on `master`. The user's standing preference is **commit only when asked, and branch before committing on the default branch** — Task 0 creates the branch. Do not push.
- **No test files exist yet** in this repo, but `vitest` is already a devDependency and `npm test` is wired in both `server/package.json` and `web/package.json`. The server tasks below add the first tests under `server/src/*.test.ts` (vitest's default glob picks these up).
- There is **no client test harness** (no React Testing Library / jsdom). Client tasks (5–7) are verified by `npm run typecheck` + `npm run build` + the manual smoke test in Task 8, not by unit tests. Do not add a client test framework — that is out of scope (YAGNI).
- Run server commands from `server/`, web commands from `web/`.

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `server/src/store.ts` | SQLite access | Add `deleteSession` (txn: events + session) |
| `server/src/sessionManager.ts` | Agent turn lifecycle | Add `discard` + `deleting` guard in `record`/`finally` |
| `server/src/wsHub.ts` | WS rooms | Return `{ closeRoom }` handle |
| `server/src/routes.ts` | REST API | Add `DELETE /api/sessions/:id`; `RouteDeps` gains `manager` + `closeRoom` |
| `server/src/server.ts` | Wiring | Register WS first, pass `manager` + `closeRoom` into routes |
| `server/src/store.test.ts` | Test | New — `deleteSession` |
| `server/src/sessionManager.test.ts` | Test | New — `discard` guard |
| `server/src/routes.delete-session.test.ts` | Test | New — endpoint behavior |
| `web/src/lib/api.ts` | Client API | Add `deleteSession` |
| `web/src/components/deck/sidebar-projects.tsx` | Sidebar UI | Trash + confirm popover, `onDeleteSession` prop |
| `web/src/components/deck/deck-view.tsx` | Page state | `handleDeleteSession`, pass prop to sidebar |

---

### Task 0: Create the feature branch

**Files:** none (git only)

- [ ] **Step 1: Branch off master**

Run:
```bash
git checkout -b feat/delete-session
```
Expected: `Switched to a new branch 'feat/delete-session'`

---

### Task 1: `Store.deleteSession` — cascade delete events + session

**Files:**
- Modify: `server/src/store.ts`
- Test: `server/src/store.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/src/store.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Store } from './store.ts';

function freshStore(): Store {
  return new Store(':memory:');
}

describe('Store.deleteSession', () => {
  it('removes the session row and all its events in one call', () => {
    const store = freshStore();
    const s = store.create({ projectPath: '/tmp/proj' });
    store.appendEvent(s.id, { sdkUuid: null, type: 'user', payload: { text: 'hi' } });
    store.appendEvent(s.id, { sdkUuid: null, type: 'assistant', payload: { text: 'yo' } });

    expect(store.get(s.id)).toBeDefined();
    expect(store.eventsSince(s.id, 0)).toHaveLength(2);

    store.deleteSession(s.id);

    expect(store.get(s.id)).toBeUndefined();
    expect(store.eventsSince(s.id, 0)).toHaveLength(0);
    store.close();
  });

  it('does not touch other sessions', () => {
    const store = freshStore();
    const keep = store.create({ projectPath: '/tmp/keep' });
    const drop = store.create({ projectPath: '/tmp/drop' });
    store.appendEvent(keep.id, { sdkUuid: null, type: 'user', payload: {} });
    store.appendEvent(drop.id, { sdkUuid: null, type: 'user', payload: {} });

    store.deleteSession(drop.id);

    expect(store.get(keep.id)).toBeDefined();
    expect(store.eventsSince(keep.id, 0)).toHaveLength(1);
    store.close();
  });

  it('is a no-op on an unknown id', () => {
    const store = freshStore();
    expect(() => store.deleteSession('does-not-exist')).not.toThrow();
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- store`
Expected: FAIL — `store.deleteSession is not a function`.

- [ ] **Step 3: Add prepared statements**

In `server/src/store.ts`, add to the `stmts` type declaration (the `private stmts!: {...}` block, alongside `deleteCron`):
```ts
    deleteSession: Database.Statement;
    deleteEventsForSession: Database.Statement;
```

Then in `prepareStatements()`, add (next to `deleteCron`):
```ts
      deleteSession: db.prepare(`DELETE FROM session WHERE id = ?`),
      deleteEventsForSession: db.prepare(`DELETE FROM event WHERE session_id = ?`),
```

- [ ] **Step 4: Add the method**

In `server/src/store.ts`, add this method to the `Store` class (place it right after the existing `deleteCron(id)` method):
```ts
  /** Delete a session and all of its events atomically. No-op if the id is unknown. */
  deleteSession(id: string): void {
    const txn = this.db.transaction((sid: string) => {
      this.stmts.deleteEventsForSession.run(sid);
      this.stmts.deleteSession.run(sid);
    });
    txn(id);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npm test -- store`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/store.ts server/src/store.test.ts
git commit -m "feat(server): Store.deleteSession cascades events + session"
```

---

### Task 2: `SessionManager.discard` — abort an in-flight turn and suppress its trailing writes

**Files:**
- Modify: `server/src/sessionManager.ts`
- Test: `server/src/sessionManager.test.ts` (create)

This is the fix for the cancel-then-delete race: an aborted turn's `catch` block records a `cancelled` event. Without a guard, that event row would be re-created (and re-broadcast) for a session the delete route is about to remove. `discard` marks the id so `record` becomes a no-op for it.

- [ ] **Step 1: Write the failing test**

Create `server/src/sessionManager.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Store } from './store.ts';
import { SessionManager, type QueryFn } from './sessionManager.ts';
import type { Config } from './config.ts';

const cfg = {
  token: 'x'.repeat(16),
  projectsRoot: '/tmp',
  projectsRoots: ['/tmp'],
  port: 0,
  model: 'claude-test-model',
  permissionMode: 'bypassPermissions',
} as Config;

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('SessionManager.discard', () => {
  it('aborts a running turn and suppresses the trailing cancelled event', async () => {
    const store = new Store(':memory:');
    const s = store.create({ projectPath: '/tmp/proj' });

    const gate = deferred();
    // Fake SDK stream: emit one assistant message, pause, then honor the abort.
    const queryFn: QueryFn = async function* ({ options }) {
      yield { type: 'assistant', uuid: 'a1' };
      await gate.promise;
      const ac = options.abortController as AbortController;
      if (ac.signal.aborted) return; // ends the loop -> manager finally{}
      yield { type: 'assistant', uuid: 'a2' };
    };

    const manager = new SessionManager(store, cfg, queryFn);
    const turn = manager.send(s.id, 'hello'); // do NOT await yet

    // Let the first yield be recorded: user_prompt + assistant a1 = 2 events.
    await new Promise((r) => setTimeout(r, 10));
    expect(store.eventsSince(s.id, 0).length).toBe(2);
    expect(manager.isActive(s.id)).toBe(true);

    manager.discard(s.id); // marks deleting + aborts
    gate.resolve();        // unblock the generator so it sees the abort and ends
    await turn;

    const events = store.eventsSince(s.id, 0);
    expect(events).toHaveLength(2); // no 'cancelled', no a2
    expect(events.some((e) => e.type === 'cancelled')).toBe(false);
    expect(manager.isActive(s.id)).toBe(false);
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- sessionManager`
Expected: FAIL — `manager.discard is not a function`.

- [ ] **Step 3: Add the `deleting` set and `discard` method**

In `server/src/sessionManager.ts`, add the field next to the existing private fields:
```ts
  private deleting = new Set<string>();
```

Add the method right after `cancel(...)`:
```ts
  /** Abort an in-flight turn (if any) and suppress its trailing event writes so a
   *  caller can safely delete the session immediately afterward. */
  discard(id: string): void {
    this.deleting.add(id);
    this.cancel(id);
  }
```

- [ ] **Step 4: Guard `record` and clean up in `finally`**

In `record(...)`, add the guard as the first line of the method body:
```ts
  private record(sessionId: string, type: string, payload: any): void {
    if (this.deleting.has(sessionId)) return;
    const sdkUuid = typeof payload?.uuid === 'string' ? payload.uuid : null;
    const row = this.store.appendEvent(sessionId, { sdkUuid, type, payload });
    const ev: DeckEvent = { sessionId, type, payload, seq: row.seq };
    this.emit('event', ev);
  }
```

In `send(...)`'s `finally` block, add the cleanup line so the set never leaks:
```ts
    } finally {
      this.controllers.delete(sessionId);
      this.active.delete(sessionId);
      this.deleting.delete(sessionId);
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npm test -- sessionManager`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/sessionManager.ts server/src/sessionManager.test.ts
git commit -m "feat(server): SessionManager.discard aborts turn and guards event writes"
```

---

### Task 3: WS hub returns a `closeRoom` handle

**Files:**
- Modify: `server/src/wsHub.ts`

No isolated unit test: the `rooms` map is private to the closure and a full WebSocket integration test is disproportionate for this change. Correctness is verified by typecheck here, the route spy in Task 4, and the manual smoke test in Task 8.

- [ ] **Step 1: Change the return type and add `closeRoom`**

In `server/src/wsHub.ts`, change the function signature:
```ts
export function registerWs(app: FastifyInstance, deps: WsDeps): { closeRoom: (sessionId: string) => void } {
```

At the end of `registerWs`, just before the closing brace, add the helper and return it:
```ts
  // Tell every viewer of a now-deleted session, then drop the room. Called by the
  // DELETE /api/sessions/:id route after the row is gone from the DB.
  function closeRoom(sessionId: string): void {
    const room = rooms.get(sessionId);
    if (!room) return;
    for (const s of room) {
      send(s, { type: 'deleted', payload: { message: 'session deleted' } });
      try {
        s.close();
      } catch {
        /* socket already closing */
      }
    }
    rooms.delete(sessionId);
  }

  return { closeRoom };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd server && npx tsc --noEmit`
Expected: errors only at the `registerWs(...)` call site in `server.ts` (return value now used / signature change) — those are fixed in Task 4. No errors inside `wsHub.ts` itself.

> If `tsc --noEmit` is noisy because the project has no standalone tsconfig build, instead confirm `wsHub.ts` has no red squiggles and proceed; the call-site wiring is corrected in Task 4 and the whole server is re-typechecked there.

- [ ] **Step 3: Commit**

```bash
git add server/src/wsHub.ts
git commit -m "feat(server): registerWs returns closeRoom handle"
```

---

### Task 4: `DELETE /api/sessions/:id` route + wiring

**Files:**
- Modify: `server/src/routes.ts`
- Modify: `server/src/server.ts`
- Test: `server/src/routes.delete-session.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/src/routes.delete-session.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from './store.ts';
import { SessionManager } from './sessionManager.ts';
import { AuthSessions, COOKIE_NAME } from './auth.ts';
import { registerRoutes } from './routes.ts';
import type { Config } from './config.ts';

const cfg = {
  token: 'x'.repeat(16),
  projectsRoot: '/tmp',
  projectsRoots: ['/tmp'],
  port: 0,
  model: 'claude-test-model',
  permissionMode: 'bypassPermissions',
} as Config;

async function buildApp() {
  const store = new Store(':memory:');
  const auth = new AuthSessions();
  const sid = auth.issue();
  const manager = new SessionManager(store, cfg);
  const closed: string[] = [];

  const app: FastifyInstance = Fastify();
  await app.register(cookie);
  registerRoutes(app, {
    store,
    config: cfg,
    taskRunner: {} as any,
    scheduler: {} as any,
    auth,
    manager,
    closeRoom: (id: string) => closed.push(id),
  });
  await app.ready();
  return { app, store, manager, sid, closed };
}

describe('DELETE /api/sessions/:id', () => {
  it('deletes the session and closes its room, returns 204', async () => {
    const { app, store, sid, closed } = await buildApp();
    const s = store.create({ projectPath: '/tmp/proj' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${s.id}`,
      cookies: { [COOKIE_NAME]: sid },
    });

    expect(res.statusCode).toBe(204);
    expect(store.get(s.id)).toBeUndefined();
    expect(closed).toEqual([s.id]);
    await app.close();
  });

  it('returns 404 for an unknown id', async () => {
    const { app, sid } = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/nope`,
      cookies: { [COOKIE_NAME]: sid },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('requires auth', async () => {
    const { app, store } = await buildApp();
    const s = store.create({ projectPath: '/tmp/proj' });
    const res = await app.inject({ method: 'DELETE', url: `/api/sessions/${s.id}` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- delete-session`
Expected: FAIL — `RouteDeps` has no `manager`/`closeRoom` (TS error) or 404 on the route (route not defined).

- [ ] **Step 3: Extend `RouteDeps` and imports in `routes.ts`**

In `server/src/routes.ts`, add the import near the other type imports at the top:
```ts
import type { SessionManager } from './sessionManager.ts';
```

Extend the `RouteDeps` interface:
```ts
export interface RouteDeps {
  store: Store;
  config: Config;
  taskRunner: TaskRunner;
  scheduler: Scheduler;
  manager: SessionManager;
  /** Close + drop the WS room for a session (from the WS hub). */
  closeRoom: (id: string) => void;
  /** Shared with the WS hub. Created per-app if omitted (tests). */
  auth?: AuthSessions;
}
```

Destructure them at the top of `registerRoutes`:
```ts
  const { store, config, taskRunner, scheduler, manager, closeRoom } = deps;
```

- [ ] **Step 4: Add the route handler**

In `server/src/routes.ts`, add this handler immediately after the `POST /api/sessions` handler (right after its closing `});`, before the `// tasks` comment):
```ts
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const id = req.params.id;
    if (!store.get(id)) return reply.code(404).send({ error: 'not found' });
    // Cancel an in-flight turn first; discard() also suppresses its trailing
    // event writes so they can't resurrect rows we're about to delete.
    if (manager.isActive(id)) manager.discard(id);
    store.deleteSession(id);
    closeRoom(id); // tell live viewers, drop the room
    return reply.code(204).send();
  });
```

- [ ] **Step 5: Wire `server.ts`**

In `server/src/server.ts`, replace the two registration lines:
```ts
  registerRoutes(app, { store, config, taskRunner, scheduler, auth });
  registerWs(app, { store, manager, config, auth });
```
with (register WS first to capture the handle, then pass `manager` + `closeRoom` into routes):
```ts
  const ws = registerWs(app, { store, manager, config, auth });
  registerRoutes(app, { store, config, taskRunner, scheduler, auth, manager, closeRoom: ws.closeRoom });
```

- [ ] **Step 6: Run test to verify it passes, and typecheck the server**

Run: `cd server && npm test -- delete-session`
Expected: PASS (3 tests).

Run: `cd server && npm test`
Expected: PASS (all server tests: store + sessionManager + delete-session).

Run: `cd server && npx tsc --noEmit`
Expected: no errors (the Task 3 call-site issue is now resolved).

- [ ] **Step 7: Commit**

```bash
git add server/src/routes.ts server/src/server.ts server/src/routes.delete-session.test.ts
git commit -m "feat(server): DELETE /api/sessions/:id route + wiring"
```

---

### Task 5: Client `api.deleteSession`

**Files:**
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Add the method**

In `web/src/lib/api.ts`, add this method to the `api` object (place it right after the `session(id)` method, before `createSession`):
```ts
  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`/api/sessions/${id}`, {
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
(Note: cannot reuse the `json()` helper — a 204 has no body to parse.)

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(web): api.deleteSession"
```

---

### Task 6: Sidebar trash control + confirm popover

**Files:**
- Modify: `web/src/components/deck/sidebar-projects.tsx`

- [ ] **Step 1: Add `Trash2` to the lucide import**

In `web/src/components/deck/sidebar-projects.tsx`, update the icon import line to include `Trash2`:
```ts
import { ChevronRight, FolderGit2, FolderPlus, MessageSquarePlus, Plus, Search, TerminalSquare, Trash2, X } from "lucide-react";
```

- [ ] **Step 2: Add the `onDeleteSession` prop**

In the `Props` type, add:
```ts
  onDeleteSession: (session: Session) => void | Promise<void>;
```

Add it to the destructured params of `SidebarProjects`:
```ts
export function SidebarProjects({
  projects,
  sessions,
  activeId,
  activeProjectPath,
  onNavigate,
  onNewChat,
  onCreateProject,
  onDeleteSession,
  reserveCloseButton,
}: Props) {
```

- [ ] **Step 3: Replace the session `<li>` body with a row that has a hover trash + confirm popover**

Find the session list item (the `threads.map((t) => { ... return ( <li key={t.id}> <Link ...>...</Link> </li> ); })` block) and replace the entire `<li>...</li>` return with:
```tsx
                      <li key={t.id} className="group/row relative">
                        <Link
                          to="/$threadId"
                          params={{ threadId: t.id }}
                          onClick={onNavigate}
                          className={cn(
                            "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-1.5 pr-8 text-sm transition-colors",
                            active
                              ? "bg-sidebar-accent text-primary"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              active ? "bg-primary" : "bg-muted-foreground/30",
                            )}
                          />
                          <span className="truncate">{t.title || "untitled session"}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground/60">
                            {relTime(t.created_at)}
                          </span>
                        </Link>
                        <DeleteSessionButton session={t} onDelete={onDeleteSession} />
                      </li>
```

- [ ] **Step 4: Add the `DeleteSessionButton` component**

At the bottom of `web/src/components/deck/sidebar-projects.tsx`, after the `IconBtn` function, add:
```tsx
function DeleteSessionButton({
  session,
  onDelete,
}: {
  session: Session;
  onDelete: (session: Session) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Delete session"
          onClick={(e) => {
            // Don't let the click bubble to the row's <Link> (would navigate).
            e.preventDefault();
            e.stopPropagation();
          }}
          className={cn(
            "absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground/60",
            "opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-destructive",
            "group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
          )}
        >
          <Trash2 className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" portal={false} className="w-48 p-2 font-mono">
        <p className="mb-2 px-1 text-xs text-foreground">Delete this session?</p>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              void onDelete(session);
            }}
          >
            Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd web && npm run typecheck`
Expected: FAIL — `onDeleteSession` is now required on `<SidebarProjects>` but `deck-view.tsx` doesn't pass it yet. That is fixed in Task 7. Confirm the only errors are about the missing `onDeleteSession` prop at the `deck-view.tsx` call sites, then proceed.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/deck/sidebar-projects.tsx
git commit -m "feat(web): sidebar per-session delete control with confirm popover"
```

---

### Task 7: `deck-view` delete handler + prop wiring

**Files:**
- Modify: `web/src/components/deck/deck-view.tsx`

- [ ] **Step 1: Add the handler**

In `web/src/components/deck/deck-view.tsx`, add this function next to the other handlers (e.g. right after `handleNewChat`). It assumes `api`, `qc`, `navigate`, `toast`, and `activeThreadId` are already in scope (they are — used by sibling handlers):
```tsx
  async function handleDeleteSession(session: Session) {
    try {
      await api.deleteSession(session.id);
    } catch (err) {
      if ((err as { status?: number })?.status === 401) {
        navigate({ to: "/login" });
        return;
      }
      toast.error(`Couldn't delete session: ${err instanceof Error ? err.message : "unknown error"}`);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["sessions"] });
    if (session.id === activeThreadId) navigate({ to: "/" });
    toast.success("Session deleted");
  }
```

> If `Session` is not already imported in `deck-view.tsx`, add it to the existing type import from `@/lib/types` (check the top of the file; `Session` is the type used across the deck components).

- [ ] **Step 2: Pass the prop to the sidebar**

In the `renderSidebar` function, add the prop to `<SidebarProjects ... />`:
```tsx
      onDeleteSession={handleDeleteSession}
```
(Place it alongside `onNewChat={handleNewChat}` / `onCreateProject={handleCreateProject}`. This single `renderSidebar` is used for both the desktop and mobile-sheet instances, so one edit covers both.)

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Build**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/deck/deck-view.tsx
git commit -m "feat(web): wire session delete handler into deck-view"
```

---

### Task 8: Manual smoke test (full flow)

**Files:** none

- [ ] **Step 1: Start the stack**

Run: `proc-compose up` (per project setup), then open the deck UI in a browser and log in.

- [ ] **Step 2: Delete an idle background session**

- Hover a session row in the sidebar → trash icon fades in on the right.
- Click trash → confirm popover appears.
- Click **Cancel** → nothing happens, session stays.
- Click trash → **Delete** → session disappears from the list, success toast shows. The view you're in is unchanged.

- [ ] **Step 3: Delete the currently-open session**

- Open a session, then delete it via its trash control.
- Expected: list updates, and the app navigates to `/` (new-session view). Toast shows.

- [ ] **Step 4: Delete a running session**

- Start a turn (send a prompt so the agent is streaming/busy).
- While it's running, delete that session.
- Expected: 204; the turn is cancelled; the session and its events are gone; no stray `cancelled` row resurrects the session (it does not reappear in the list after refresh). If you had it open, you navigate to `/`.

- [ ] **Step 5: Confirm no regressions**

- Create a new chat, switch sessions, search/filter — all still work.

- [ ] **Step 6: Final commit (if any manual fixups were needed)**

Only if Steps 2–5 required code changes:
```bash
git add -A
git commit -m "fix(delete-session): smoke-test fixups"
```

---

## Self-review notes

- **Spec coverage:** trash affordance (Task 6), confirm popover (Task 6), cancel-then-delete (Tasks 2+4), cascade event delete (Task 1), WS room close (Tasks 3+4), navigate-away + invalidate + toast (Task 7), 404/401 handling (Task 4 tests + Task 7 handler). All spec sections mapped.
- **Type consistency:** `deleteSession` (store + api), `discard` (manager), `closeRoom` (wsHub return + RouteDeps), `onDeleteSession` (sidebar prop + deck-view) — names consistent across tasks.
- **No client test framework added** — intentional (none exists; out of scope). Client verified by typecheck + build + manual smoke.
