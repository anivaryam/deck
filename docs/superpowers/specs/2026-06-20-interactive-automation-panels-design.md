# Interactive Automation Panels — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm); pending implementation plan
**Scope:** Make the Tasks, Cron, and Tickets panels fully interactive (create / edit / run / cancel / delete) from the UI.

## 1. Summary

Deck's automation surface (tasks, cron, tickets) is partially wired. Cron and Tickets
already support most actions from the UI; the Tasks panel is effectively view-only.
This feature closes the remaining gaps so all three panels offer a consistent,
complete set of actions, reusing the existing component and endpoint patterns rather
than introducing new abstractions.

## 2. Current state (ground truth)

| Domain | Create | Read detail | Edit | Delete | Run / Execute | Cancel |
|--------|--------|-------------|------|--------|---------------|--------|
| **Tasks** | API exists, **no UI** | ✓ | n/a (immutable) | ✗ | ✗ (auto-run on create) | ✗ |
| **Cron** | ✓ | list-based | enabled-only | ✓ | ✗ (timer-driven) | n/a |
| **Tickets** | ✓ | ✓ | status/pr_url only | ✓ | ✓ | n/a |

Key existing building blocks (confirmed):

- `SessionManager.cancel(sessionId): boolean` — `server/src/sessionManager.ts:79`. Aborts the
  per-session `AbortController`; works for headless task sessions (no WebSocket required);
  returns `false` if the session was not active (safe to call idempotently).
- `Store.deleteSession(id)` — `server/src/store.ts:398`, backed by a transaction
  (`server/src/store.ts:246`) that deletes the session's events and the session row. Tasks are
  `session` rows with `kind='task'`, so this is the correct cascade for task deletion — no new
  store method required.
- `Store.updateTicket(id, patch)` — `server/src/store.ts:424` already allow-lists `title` and
  `body` in its dynamic update; only the route and client currently restrict the patch to
  `status`/`pr_url`.
- `taskRunner.run(...)` is the single entry point for starting a task session (manual, cron, and
  ticket runs all funnel through it) and enforces the concurrency cap (max 6 → `queue_full`).
- Existing UI form components to reuse: `web/src/components/deck/cron-form.tsx`,
  `web/src/components/deck/ticket-form.tsx`.
- Tests use **vitest** on both sides. Server: `server/test/*.test.ts` (incl.
  `routes.test.ts`, `routes.phase2.test.ts`, `store.*.test.ts`). Client:
  `web/src/lib/api.tickets-tasks-cron.test.ts` already covers these API methods.

## 3. Conceptual model

Two kinds of objects, which dictate the available actions:

- **Definitions** — `cron` and `ticket`. Editable specifications that spawn runs. They support
  full create / edit / delete plus a way to trigger a run (cron: fire-now; ticket: run).
- **Runs** — `task`. Immutable execution records produced by a definition or created ad-hoc.
  "Editing" a run is meaningless; the equivalent is **re-run** (clone the prompt into a new run).
  Runs can be created, viewed, cancelled (while active), re-run, and deleted (when finished).

This is why Tasks gets *re-run + cancel* instead of *edit*, and why Cron/Tickets get *edit*.

## 4. Scope

**In scope**

- Tasks: ad-hoc create (UI form), re-run, cancel (active only), delete (finished only).
- Cron: edit schedule + prompt, fire-now.
- Tickets: edit title + body.

**Out of scope (YAGNI)**

- Ticket manual status override (lifecycle is already automated by `ticketAutomation`).
- A unified/config-driven CRUD abstraction shared by the three panels.
- Per-project filtering of the panels (they remain global, as today).
- Task editing (immutable; re-run instead).
- A cron "get single" endpoint (list-based detail is sufficient).

## 5. Architecture approach

**Extend in place.** Add buttons and forms to the existing panel components; reuse `CronForm`
and `TicketForm` in an "edit mode" (optional `initial` values + a mode flag; the same form
submits create or update); add one new `TaskForm` mirroring `CronForm`. No new shared
abstractions, smallest blast radius against three already-working panels.

## 6. Server changes

All endpoints keep the existing `auth: required` gate. No change to the auth model.

### 6.1 Tasks (`server/src/routes.ts`, `server/src/store.ts`)

- **`DELETE /api/tasks/:id`** — new.
  - Load row via `store.get(id)`; 404 if missing or `kind !== 'task'`.
  - If `status === 'active'` → **409** with a message indicating the task must be cancelled first.
  - Otherwise call `store.deleteSession(id)` (reuses the existing event-cascade transaction).
- **`POST /api/tasks/:id/cancel`** — new.
  - 404 if missing or `kind !== 'task'`.
  - Call `manager.cancel(id)`. Idempotent: returns success even if the task was already finished
    (cancel returns `false`); response indicates whether an active run was actually aborted.
- **Re-run** — *no new endpoint.* The client reads the task row's `prompt`, `model`, `effort`,
  and `project_path` (all present on `SessionRow`) and calls the existing `POST /api/tasks`. The
  clone is an ordinary new run record.
- **Create** — existing `POST /api/tasks`; only the UI is new.
- Store: **no new method** (reuse `deleteSession`).

### 6.2 Cron (`server/src/routes.ts`, `server/src/store.ts`, `server/src/scheduler.ts`)

- **`PATCH /api/cron/:id`** — extend the accepted body from `{ enabled? }` to
  `{ enabled?, schedule?, prompt? }`.
  - If `schedule` is present, validate it with the same check used on create
    (`Scheduler.isValid` + the configured minimum interval); reject invalid expressions with 400.
  - Apply the update, then call `scheduler.reload()` so a changed schedule re-registers.
- **`POST /api/cron/:id/run`** — new, fire-now.
  - Reuse `runner.run(...)` with `origin='cron'`, `sourceKind='cron'`, `sourceId=id`, mirroring the
    scheduled-fire path.
  - **Overlap guard:** if the cron's last run is still `active`, skip and return a clear status
    (e.g. 409 / "already running") rather than stacking a second run.
  - **Bypass** the cron minimum-interval check — this is an explicit user action, not a timer fire.
  - Record the run via `store.recordCronRun(id, sessionId)`.
- Store: add **`updateCron(id, { schedule?, prompt? })`** (today only `setCronEnabled` exists).

### 6.3 Tickets (`server/src/routes.ts`)

- **`PATCH /api/tickets/:id`** — extend the accepted body from `{ status?, pr_url? }` to
  `+{ title?, body? }`. Validate that `title`, when present, is non-empty. `store.updateTicket`
  already supports these fields, so **no store change** is required.

### 6.4 Cross-cutting safety / cost

- Fire-now and ad-hoc task creation start real agent runs (cost, side effects), but they are
  identical in nature to the create paths that already exist. The concurrency cap (max 6 →
  `queue_full`) still applies, and the fire-now overlap guard prevents a single cron from
  stacking runs. **No new unbounded execution surface is introduced.**

## 7. Client changes (`web/src/lib/api.ts` + hooks)

API methods:

- `deleteTask(id)` → `DELETE /api/tasks/:id`
- `cancelTask(id)` → `POST /api/tasks/:id/cancel`
- Re-run: no dedicated method — reuse `createTask` with the cloned fields.
- `updateCron(id, patch)` — widen from `{ enabled }` to `{ enabled?, schedule?, prompt? }`.
- `runCron(id)` → `POST /api/cron/:id/run`
- `updateTicket(id, patch)` — widen from `{ status?, pr_url? }` to `+{ title?, body? }`.

React Query hooks (mirroring existing `useUpdateCron`, `useDeleteCron`, `useRunTicket`,
`useDeleteTicket`, `useUpdateTicket`), with the usual list-invalidation on success:

- New: `useCreateTask`, `useDeleteTask`, `useCancelTask`, `useRunCron`.
- Widened: `useUpdateCron`, `useUpdateTicket`.

## 8. UI changes

### 8.1 Tasks (`web/src/routes/tasks.tsx`, `task-output.tsx`, new `web/src/components/deck/task-form.tsx`)

- Add a **"+ New task"** action on the page header opening a new **`TaskForm`** that mirrors
  `CronForm`: project picker + prompt textarea + model + effort → `useCreateTask`.
- In the task detail / output pane, add an action row:
  - **Cancel** — shown only while the task status is `active` → `useCancelTask`.
  - **Re-run** — shown only when the task is finished; clones the row → `createTask`.
  - **Delete** — shown only when finished; confirm before deleting. (The server still enforces
    409-on-active as a guard; the UI simply does not offer Delete while active.) → `useDeleteTask`.

  So the row is mutually exclusive by state: **active → Cancel**; **finished → Re-run + Delete**.

### 8.2 Cron (`web/src/routes/cron.tsx`, `cron-list.tsx`, `cron-form.tsx`)

- `CronForm` gains optional `initial` values + a mode flag; reused for **edit** (prefilled),
  submitting via `useUpdateCron` instead of create.
- Per cron item: **Edit** (pencil) opens the prefilled form; **Fire-now** (▶) calls `useRunCron`
  with a toast on success, disabled while a run for that cron is active.

### 8.3 Tickets (`web/src/routes/tickets.tsx`, `ticket-detail.tsx`, `ticket-form.tsx`)

- `TicketForm` gains optional `initial` values; reused for **edit** (title + body).
- `TicketDetail` gains an **Edit** button opening the prefilled form → `updateTicket`.

Pattern throughout: forms accept optional `initial`/`mode` props and serve both create and edit.
The only new form file is `TaskForm`.

## 9. Behavior & guards (consolidated)

- **Delete active task** → 409; UI surfaces "cancel first".
- **Cancel** → idempotent; no-op (success) if the task already finished.
- **Cron fire-now** → respects the overlap guard (skips if a run is active); bypasses the
  minimum-interval check.
- **Cron edit** → validates the schedule expression before saving; `scheduler.reload()` after.
- **Ticket edit** → non-empty title required.
- All actions confirm destructive operations (delete) consistently with the existing cron/ticket
  delete flows.

## 10. Testing

Both sides use vitest; extend the existing suites rather than adding new harnesses.

**Server (priority — the logic lives here):** extend `server/test/routes.*.test.ts` and
`server/test/store.*.test.ts` to cover:

- `DELETE /api/tasks/:id`: 404 for non-task / missing, 409 for active, success + event cascade for
  finished.
- `POST /api/tasks/:id/cancel`: aborts an active task; idempotent no-op when finished.
- `PATCH /api/cron/:id`: rejects an invalid schedule; persists schedule/prompt; reload is invoked.
- `POST /api/cron/:id/run`: fires a run; skips when a run is already active (overlap).
- `PATCH /api/tickets/:id`: updates title/body; rejects empty title.
- `Store.updateCron`: persists schedule/prompt.

**Client:** extend `web/src/lib/api.tickets-tasks-cron.test.ts` for the new/widened methods
(`deleteTask`, `cancelTask`, `updateCron` widened, `runCron`, `updateTicket` widened). Component
behavior verified by manual smoke through a running stack (`proc-compose up`): exercise create /
edit / run / cancel / delete for each domain.

## 11. Suggested build sequence

1. **Server store + endpoints** (tasks delete/cancel, cron update/run, ticket title/body) with
   their vitest coverage. Self-contained and testable without UI.
2. **Client api.ts methods + hooks** with `api.tickets-tasks-cron.test.ts` coverage.
3. **UI wiring**: `TaskForm` + tasks action row; cron edit + fire-now; ticket edit.
4. **Manual smoke** of every action across the three panels.

## 12. Risks & mitigations

- **Cancel/abort path for headless tasks** — relies on `SessionManager.cancel` aborting cleanly
  with no WebSocket attached. Mitigation: explicit server test that cancels an active task and
  asserts the `cancelled` terminal event + status transition.
- **Cron `reload()` churn on edit** — re-registering jobs on every edit is acceptable at current
  scale (the same reload runs on create/delete/toggle today). No change needed.
- **Form-reuse regressions** — adding edit mode to `CronForm`/`TicketForm` could disturb the
  create path. Mitigation: keep create the default (no `initial`), and smoke both paths.
