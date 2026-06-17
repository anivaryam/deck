# Tasks / Cron / Tickets Frontend — Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)
**Scope:** Add web UI for the existing `task`, `cron`, and `ticket` backend features. Frontend-only.

## Problem

Deck's backend fully implements background tasks, cron scheduling, and tickets
(`server/src/taskRunner.ts`, `scheduler.ts`, `deckTools.ts`, routes in `routes.ts`).
The frontend is chat-only — these three subsystems have **zero UI** and are unreachable
to the user. The automation loop (file a ticket → run it as a task → see output → link a PR)
exists in the API but cannot be driven or observed from the app.

This spec adds the frontend to expose all three, using the routes that already exist.

## Goals

- Reachable, project-scoped UI for Tickets, Tasks, Cron.
- Drive the loop: create/run tickets, watch task output live, manage cron schedules.
- Match deck's visual identity exactly (mono, single green accent, red only for failure).

## Non-Goals (explicitly deferred to a later backend slice)

- PR auto-population (`ticket.pr_url` stays manual / whatever backend already sets).
- Task-completion notifications / toasts (no new WS event types).
- Cron run-history (backend stores only `last_run_at` / `last_session_id` today).
- New backend endpoints. This slice uses existing routes as-is.

## Existing integration points (verified)

| Concern | Location | Notes |
|---|---|---|
| Routing | `web/src/routes/` (TanStack file-based, v1.168) | `routeTree.gen.ts` auto-generated — never hand-edit |
| Event renderer | `web/src/components/deck/message-list.tsx` | `MessageList({ messages, sessionId })`; reusable read-only |
| Event adaptation | `web/src/lib/adapt.ts` | `eventsToMessages(DeckMessage[]) → Message[]` |
| WS live events | `web/src/lib/ws.ts` | `useSocket(sessionId) → { messages, connected, busy, sendPrompt, cancel }` |
| Data fetching | `web/src/hooks/use-deck-data.ts` | React Query v5; `useQuery` list + `enabled` detail |
| API client | `web/src/lib/api.ts` | `fetch` wrapper, relative URLs, `credentials: "same-origin"`, `ApiError`, `json<T>()` |
| Sidebar | `web/src/components/deck/sidebar-projects.tsx` | project → sessions tree; `open: Record<path,boolean>` |
| Types | `web/src/lib/types.ts` | add `Ticket`, `Task`, `Cron` |

### Backend routes consumed (already exist, `server/src/routes.ts`)

- Tickets: `GET /api/tickets`, `POST /api/tickets`, `PATCH /api/tickets/:id`, `POST /api/tickets/:id/run`
- Tasks: `GET /api/tasks`, `GET /api/tasks/:id`, `POST /api/tasks`
- Cron: `GET /api/cron`, `POST /api/cron`, `PATCH /api/cron/:id`, `DELETE /api/cron/:id`

Task live output: tasks are sessions (`kind='task'`), so `useSocket(taskId)` streams their
events over the existing `/ws/:id` channel exactly like chat.

## Architecture

### Navigation (option B — nested per project)

The expanded project row in the sidebar gains four collapsible sub-sections:
**Chats / Tickets / Tasks / Cron**, each with a count. Chats retains current behavior
(lists chat sessions, links to `/$threadId`). The other three are `<Link>`s to their page
route carrying the project as a search param. Per-project open/closed sub-section state
extends the existing `open` record keyed by `path:section`.

On phone the sidebar is already a drawer; sub-sections stack.

### Routes (flat files, project via search param)

Project-scoped, deep-linkable, refresh-safe:

- `web/src/routes/tickets.tsx` → `/tickets?project=<path>`
- `web/src/routes/tasks.tsx`   → `/tasks?project=<path>`
- `web/src/routes/cron.tsx`    → `/cron?project=<path>`

Each uses `createFileRoute(...)` with `validateSearch` to read `project`. Missing/invalid
project → empty state prompting selection from the sidebar.

### API client additions (`lib/api.ts`, mirror existing pattern)

```
tickets(project): Ticket[]
ticket(id): Ticket
createTicket({ project, title, body? }): Ticket
updateTicket(id, { status?, pr_url?, title?, body? }): Ticket
runTicket(id): { session_id }
tasks(project): Task[]
task(id): { task: Task, events: DeckEvent[] }
createTask({ project, prompt, model?, effort? }): { id }
listCron(): Cron[]
createCron({ schedule, project, prompt }): Cron
updateCron(id, { enabled }): Cron
deleteCron(id): void
```

All relative URLs, `credentials: "same-origin"`, `json<T>()` for parsing, `ApiError` on !ok.
List endpoints filter client-side by `project` where the backend returns global lists.

### Data hooks (`hooks/use-deck-data.ts`, React Query)

List hook per entity (`useTickets(project)`, `useTasks(project)`, `useCron()`) and detail
hook with `enabled: !!id` (`useTicket(id)`, `useTask(id)`). Mutations
(`useRunTicket`, `useCreateTicket`, `useUpdateTicket`, `useCreateTask`, `useCreateCron`,
`useUpdateCron`, `useDeleteCron`) call the api method then `invalidateQueries` the relevant key.

### Components

Shared:
- `status-chip.tsx` — mono status chip + dot. Encodes status by **shape + green intensity**,
  red (`--destructive`) only for `failed`. States: open (hollow gray), running (solid green,
  pulse), review (green ring), done (dim green), failed (red).

Tickets:
- `tickets-list.tsx` — filter tabs (All/Open/Running/Review/Done/Failed) + rows
  (status dot, title, origin tag, status chip). Selecting a row opens detail.
- `ticket-detail.tsx` — title, body, kv (project/origin/PR/created), link to linked task's
  output, **Run** button, **Edit**.
- `ticket-form.tsx` — new-ticket dialog (title, body, project).

Tasks:
- `tasks-list.tsx` — rows w/ origin badge (manual/cron/ticket) + status.
- `task-output.tsx` — wraps `MessageList`, fed by `useSocket(taskId)` → `eventsToMessages`.
  Read-only: no prompt composer, no `sendPrompt`. Falls back to `task(id).events` for
  finished/replayed tasks.

Cron:
- `cron-list.tsx` — rows: schedule (mono), prompt preview, enabled `Switch` (shadcn),
  last-run relative time.
- `cron-form.tsx` — schedule + project + prompt; on submit, surface backend validation
  error (invalid cron expression) inline from the `ApiError` message.

Page shells (`tickets.tsx` / `tasks.tsx` / `cron.tsx` route components) compose
list + detail using the existing two-pane deck layout; collapse to single column < 820px.

### Data flow

1. Page reads `?project` search param.
2. React Query list hook fetches → renders list.
3. Select item → detail hook (`enabled` on id) renders detail pane.
4. Run/Create/Toggle → mutation → `invalidateQueries`.
5. Task output → `useSocket(taskId)` (module-cached + WS resume by `seq`), render-only.

### Error & empty states

- No project selected → empty state with pointer to sidebar.
- Empty list → per-entity empty copy + primary action (New ticket / New cron).
- Mutation error → inline message from `ApiError.message` (e.g. invalid cron expr, queue full).
- Task queue full (backend `errored`) → surfaced as failed status in task list/detail.

## Visual reference

Locked mockup (real deck tokens, mono palette): `.deck-artifacts/tickets-mono.png`.

## Testing

- API client: unit-test new methods against mocked `fetch` (status/ok/error → `ApiError`).
- Hooks: React Query hooks with a mocked api — list, detail `enabled` gating, invalidate on mutate.
- Components: `status-chip` renders correct class per status; `tickets-list` filter tabs;
  `task-output` renders `MessageList` from a fixture event stream (read-only, no composer).
- Routing: each route parses `?project`, renders empty state when absent.
- Manual smoke: create ticket → run → watch task output stream → cron toggle persists.

## Build sequence

1. Types + API client methods.
2. React Query hooks.
3. `status-chip` shared component.
4. Tickets page (list + detail + form) + route.
5. Tasks page (list + `task-output` via MessageList/useSocket) + route.
6. Cron page (list + form) + route.
7. Sidebar nested sub-sections + counts.
8. Tests + manual smoke.
