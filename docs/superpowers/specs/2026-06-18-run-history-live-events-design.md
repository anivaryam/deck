# Run History + Live Completion Events — Design

**Date:** 2026-06-18
**Status:** Approved (pending spec review)
**Scope:** Backend + frontend slice making deck's cron/ticket/task automation trustworthy (full run history with outcomes) and observable (UI reacts the moment an unattended task finishes).

## Problem

Today a task is a session (`kind='task'`); it runs fire-and-forget and ends when
`sessionManager.send` sets status `idle`/`errored`. Two gaps:

1. **No history.** A cron row keeps only `last_session_id`; a ticket keeps one `session_id`.
   You cannot see "this cron ran 12 times, 3 failed", or a ticket's past attempts.
2. **Not observable.** WebSockets are per-session rooms (`/ws/:id`). The tickets/tasks/cron
   pages subscribe to nothing, so an unattended task finishing produces no UI reaction
   (the tasks list merely polls every 5s).

## Goals

- Every task run is attributable to its source (cron/ticket/manual) and carries an explicit outcome + timing.
- Per-cron and per-ticket run history is queryable and shown in the UI.
- When any task finishes, subscribed pages refresh instantly and surface a toast for unattended (cron/ticket) runs.

## Non-Goals

- No separate `run` table — runs are task sessions (DRY; reuses existing list/detail/events).
- No retry/backoff logic (future slice).
- No PR auto-link, no ticket state machine (separate future slice).
- No historical backfill of `source_*`/`result` for pre-migration rows (they stay null).

## Existing integration points (verified)

| Concern | Location | Note |
|---|---|---|
| Task creation | `server/src/taskRunner.ts` `run({projectPath,prompt,origin,title?,model?,effort?})` | calls `store.createTask`; queue-full → `setStatus('errored')` |
| Cron fire | `server/src/scheduler.ts` `fireCron(id)` → `runner.run({origin:'cron'})` + `store.recordCronRun(id, sessionId)` | |
| Ticket run | `server/src/routes.ts` `POST /api/tickets/:id/run` → `runner.run({origin:'ticket'})` | |
| Terminal status | `server/src/sessionManager.ts` `send()` — `setStatus('idle')` (success), `setStatus('idle')`+`cancelled` event (abort), `setStatus('errored')`+`error` event (throw) | the 3 outcome points |
| Event fan-out | `sessionManager.record()` → `store.appendEvent` + push to the session's WS room | the bridge to extend for the global channel |
| WS server | `server/src/wsHub.ts` `registerWs(app, deps)`; per-session `/ws/:id`, bounded send buffer, auth gate | add `/ws/events` here |
| Store schema/migrations | `server/src/store.ts` (`SessionRow`, migration block, `createTask`, `recordCronRun`, `setStatus`) | add columns + methods |
| Frontend WS hook | `web/src/lib/ws.ts` `useSocket(sessionId)` | model for the new `useTaskEvents()` |
| Toasts | sonner (`web/src/components/ui/sonner.tsx`) already mounted | |
| Run status chip | `web/src/components/deck/status-chip.tsx` + `lib/automation.ts` | reuse for run history |

## Architecture

### 1. Data model — augment `sessions`

Add four nullable columns (idempotent `ALTER TABLE` in the migration block; old rows null):

- `source_kind TEXT` — `'cron' | 'ticket' | null`
- `source_id TEXT` — cron id / ticket id that spawned the task
- `ended_at INTEGER` — set at terminal outcome
- `result TEXT` — `'success' | 'error' | 'cancelled' | 'queue_full' | null` (null = still running / legacy)

A **run** is a task session. `SessionRow` (and the `Session` wire type in `web/src/lib/types.ts`)
gains these optional fields.

`taskRunner.run()` gains optional `sourceKind?: 'cron'|'ticket'` and `sourceId?: string`,
threaded into `store.createTask`. `scheduler.fireCron` passes `{sourceKind:'cron', sourceId:c.id}`;
`POST /tickets/:id/run` passes `{sourceKind:'ticket', sourceId:tk.id}`. `recordCronRun` stays
(keeps `last_session_id` for the cron's "latest" pointer); history is derived from runs.

New store methods:
- `finishRun(id, result)` — sets `ended_at = now`, `result`.
- `listRunsForSource(sourceKind, sourceId, limit=20)` — task sessions for a source, newest first.

### 2. Completion recording

At each terminal point in `sessionManager.send`, call `store.finishRun(id, result)`:
success → `'success'`; abort branch → `'cancelled'`; throw branch → `'error'`. `taskRunner`'s
queue-full path → `finishRun(id,'queue_full')` (after `setStatus('errored')`). One write per outcome.

### 3. Live events — global firehose channel

New WS endpoint `/ws/events` in `wsHub.ts`, same auth + bounded-buffer policy as `/ws/:id`,
with its own subscriber set (an "events room"). The manager emits a lightweight lifecycle frame
on run **start** (status active) and **finish** (terminal):

```
{ type: 'task', payload: { id, source_kind, source_id, status, result }, at }
```

No transcript/event payloads — lifecycle only. Wiring: extend the existing manager→hub bridge with
an `onTaskLifecycle` emitter the events room subscribes to; reuse the `send()` helper + buffer cap.
Only `kind='task'` sessions emit (chat sessions don't broadcast to the events channel).

### 4. Read endpoint

`GET /api/runs?source_kind=<>&source_id=<>` → `store.listRunsForSource(...)` (task Session rows).
Validates params; returns `[]` when none.

### 5. Frontend

- `web/src/lib/ws-events.ts` — `useTaskEvents(onTask)`: subscribes to `/ws/events`, auto-reconnect
  with backoff (mirror `ws.ts`), calls `onTask(payload)` per frame.
- Mount once (e.g. in the deck shell / a top-level provider): on a `task` finish frame →
  `queryClient.invalidateQueries` for `['tasks']`, `['tickets']`, `['cron']`; and for finished
  `cron`/`ticket` runs, `toast(...)` success/error ("cron run failed", etc.). Pure mapping
  (frame → toast intent) lives in a testable helper.
- `web/src/components/deck/run-history.tsx` — given `sourceKind`+`sourceId`, fetch
  `GET /api/runs`, render recent runs as a strip (status dot via `StatusChip`, relative time,
  duration `ended_at - created_at`); click a run → `/tasks?project=<path>&task=<id>` (deep-link
  already supported). Wire into `ticket-detail.tsx` (in the detail pane). The cron page is a
  list with no detail pane, so add a per-row expand toggle (chevron) that reveals `<RunHistory
  sourceKind="cron" sourceId={c.id} />` inline beneath the row.
- Remove the `refetchInterval: 5_000` on `useTasks` (the live channel supersedes polling).

### 6. API client + hooks (web)

- `api.runs(sourceKind, sourceId)` in `lib/api.ts` (relative URL, `credentials:"same-origin"`).
- `useRuns(sourceKind, sourceId)` React Query hook (`enabled` on both params).

## Error handling

- Migration: guard each `ALTER TABLE ADD COLUMN` (catch "duplicate column") so re-run is safe.
- All new columns null-safe; outcome mapping defaults unknown → leave null.
- `/ws/events`: unauthorized → close like `/ws/:id`; slow client → bounded buffer drop (existing policy).
- Toasts only for `source_kind` in {cron,ticket} to avoid noise from manual tasks the user is watching.

## Testing

Backend (vitest, server):
- `finishRun` sets `ended_at` + `result`; idempotent migration adds columns once.
- `listRunsForSource` filters by source and orders newest-first, respects limit.
- Outcome mapping: success→`success`, abort→`cancelled`, throw→`error`, queue-full→`queue_full`.
- Events channel: a fake socket joined to the events room receives a `task` frame on start + finish; chat sessions do not emit.
- `taskRunner.run` threads `sourceKind`/`sourceId` into `createTask`.

Frontend (vitest, node env — no jsdom):
- `api.runs` fetch-mocked.
- Pure frame→toast-intent mapping (cron/ticket finish → intent; manual → none).
- Run-outcome → chip status mapping.

Manual smoke: create a cron firing every minute → watch runs accumulate with outcomes; run a ticket → toast on completion + history strip updates; kill a run mid-flight → `cancelled` recorded.

## Build sequence

1. Store: columns + migration + `finishRun` + `listRunsForSource` + `createTask` source params (TDD).
2. `taskRunner`/`scheduler`/ticket-run route thread `sourceKind`/`sourceId`; queue-full result.
3. `sessionManager` finishRun at the 3 terminal points.
4. `/ws/events` channel + manager lifecycle emit (TDD with fake socket).
5. `GET /api/runs` endpoint.
6. web: `Session` type fields, `api.runs`, `useRuns`, `useTaskEvents` + toast mapping.
7. web: `run-history.tsx`, wire into ticket detail + cron; remove tasks polling.
8. Tests + manual smoke.
