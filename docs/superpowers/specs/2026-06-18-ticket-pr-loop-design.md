# Close the Ticket → PR Loop — Design

**Date:** 2026-06-18
**Status:** Approved (pending spec review)
**Scope:** Make a ticket an autonomous unit of work: a ticket state machine driven by run outcomes, and automatic capture of the PR a ticket run opens. Builds on the just-merged run-history + live-events slice.

## Problem

A ticket can be Run (spawns a task with `origin='ticket'`, `source_kind='ticket'`, `source_id=ticket.id`), but the loop never closes:
- The run's outcome doesn't move the ticket's status (status stays `running` forever, or whatever the manual PATCH left).
- `ticket.pr_url` exists but nothing populates it — the agent may open a PR, but deck never learns the URL.

This slice wires run outcome → ticket status and captures the PR URL, so a human only reviews/merges.

## Goals

- Ticket status reflects reality: `open → running → review → merged/closed`, with `failed` on error.
- When a ticket run opens a PR, the PR URL lands on the ticket automatically.
- Transitions are decoupled from `sessionManager` (a dedicated listener), idempotent, and safe.

## Non-Goals

- No auto-merge. `merged`/`closed` are human actions (existing `PATCH /api/tickets/:id`).
- No per-origin tool gating / sandboxing (runs already have full tools in the project cwd). The only execution change is the ticket prompt text.
- No retry/backoff (prior non-goal stands).
- No new git/gh integration in deck — the agent uses `gh` itself; deck only records the result.

## Existing integration points (verified)

| Concern | Location | Note |
|---|---|---|
| Ticket run | `server/src/routes.ts` `POST /api/tickets/:id/run` — builds prompt `"Work on this ticket.\n\nTitle: …\n\n…"`, `runner.run({origin:'ticket', sourceKind:'ticket', sourceId:tk.id})`, sets ticket `running` + `session_id` | augment the prompt |
| Lifecycle events | `sessionManager` emits `'task'` `{id, source_kind, source_id, status, result}` on start + terminal (run-history slice) | the listener subscribes here |
| MCP server | `server/src/deckTools.ts` `buildDeckMcp(store, projectPath)`; built per session in `sessionManager.send` as `mcpServers: { deck: buildDeckMcp(this.store, sess.project_path) }` | add `ticketId` param + `link_pr` tool |
| Ticket store | `server/src/store.ts` `updateTicket(id, {status?, pr_url?, session_id?, title?, body?})`, `getTicket` | reused |
| Events for fallback | `store.eventsSince(sessionId, 0)` returns recorded events with `payload` | scan for PR URL |
| Wiring | `server/src/server.ts` constructs store/manager/runner/scheduler + `registerWs` | wire the new listener like `wsHub` |
| Frontend status | `web/src/lib/automation.ts` `normalizeTicketStatus`, `TICKET_TABS`; `web/src/components/deck/ticket-detail.tsx`, `tickets-list.tsx`, `status-chip.tsx` | add `merged`/`closed` |

## Architecture

### 1. Ticket state machine — `ticketAutomation` listener

New module `server/src/ticketAutomation.ts`: `registerTicketAutomation(manager, store)` subscribes to `manager.on('task', frame)` and applies transitions when `frame.source_kind === 'ticket'`:

| frame | ticket transition |
|---|---|
| `status:'active'` | → `running` |
| terminal `result:'success'` **and** ticket has `pr_url` | → `review` |
| terminal `result:'success'` **and** no `pr_url` | → `done` |
| terminal `result:'error'` or `'queue_full'` | → `failed` |
| terminal `result:'cancelled'` | → `open` |

`merged` / `closed` are never set here (human via PATCH). The listener reads the ticket fresh (`getTicket(source_id)`); no-op if the ticket is missing or already in a terminal human state (`merged`/`closed`). Idempotent: re-applying the same transition is a harmless `updateTicket`.

**Ordering note:** the PR-link fallback (below) must run before the success transition reads `pr_url`. So on a terminal `success` frame the listener first runs the fallback scan, then decides `review` vs `done`.

### 2. PR auto-link

**Primary — `link_pr` MCP tool.** `buildDeckMcp(store, projectPath, ticketId?)` gains an optional `ticketId`. When present, it registers:

```
link_pr(url: string) — "Record the GitHub Pull Request URL you opened for the current ticket."
```

Handler validates `url` against `^https://github\.com/[^/]+/[^/]+/pull/\d+` ; on match, `store.updateTicket(ticketId, { pr_url: url })` and returns confirmation; on mismatch, returns an error message (no write). When `ticketId` is absent (chat/cron/manual tasks), the tool is **not registered** — only ticket runs see it.

`sessionManager.send` passes the ticket id: `buildDeckMcp(this.store, sess.project_path, sess.source_kind === 'ticket' ? sess.source_id : undefined)`.

**Fallback — event scan.** In the listener, on a terminal frame for a ticket whose `pr_url` is still null, scan `store.eventsSince(frame.id, 0)` for the first `github.com/<o>/<r>/pull/<n>` URL in any event payload (stringify + regex). If found, `updateTicket(source_id, {pr_url})`. Covers the agent opening a PR but forgetting `link_pr`.

### 3. Origin-aware prompt

In `POST /api/tickets/:id/run`, extend the prompt:

```
Work on this ticket.

Title: <title>

<body>

Work on a new git branch. When the change is complete, open a Pull Request with the `gh` CLI and then call the `link_pr` tool with the PR URL. If you cannot complete it, stop and explain why.
```

Cron/manual prompts unchanged.

### 4. Frontend

- `automation.ts`: add `merged` and `closed` to the `AutomationStatus` union, `normalizeTicketStatus`, and `TICKET_TABS`. Map their chip/dot styles (both neutral/green-done family; `merged` = green done, `closed` = muted/open).
- `ticket-detail.tsx`: when status is `review` (PR present), show **Mark merged** and **Close** buttons → `useUpdateTicket({status})`. Keep the PR chip.
- `tickets-list.tsx`: filter tabs include the new statuses (driven by `TICKET_TABS`).
- Live updates already flow: the `task` frame → `invalidateQueries(['tickets'])` (run-history slice). Add a ticket-aware toast (review = success, failed = error) — extend `toastForTask` or the watcher.

### 5. Error handling

- `link_pr`: invalid URL → error result, no write; missing ticketId → tool absent.
- Listener: wrapped per-frame try/catch so one bad frame can't crash the manager's emit loop; missing/terminal ticket → no-op.
- Fallback scan bounded (first match; events already capped per the store's event handling).

## Testing

Backend (vitest):
- Transition table: each (`source_kind:'ticket'`, result) → expected ticket status; non-ticket frames ignored; `merged`/`closed` not overwritten.
- `link_pr`: valid URL writes `pr_url` + scoped to the passed ticketId; invalid URL no write; tool absent when ticketId undefined (assert `buildDeckMcp` tool list).
- Fallback: a recorded event containing a PR URL sets `pr_url` when the agent didn't call `link_pr`; success→`review` after fallback populates the URL, `done` when none.
- Prompt augmentation present for ticket runs (route test asserts the run prompt contains the PR instruction).

Frontend (vitest, node env):
- `normalizeTicketStatus` maps `merged`/`closed`; `TICKET_TABS` includes them.
- Status→chip mapping for new statuses.
- Pure toast mapping for ticket review/failed (extend `automation-events` test).

Manual smoke (`proc-compose up`): create a ticket → Run → agent branches + opens a PR → ticket flips to `review` with the PR chip + toast → Mark merged → status `merged`. Run a ticket that errors → `failed`.

## Build sequence

1. `link_pr` tool + `buildDeckMcp` ticketId param (TDD on the handler + tool-list scoping).
2. `sessionManager` passes ticketId to `buildDeckMcp`.
3. `ticketAutomation` listener: transitions + fallback scan (TDD on a fake EventEmitter + `:memory:` store).
4. `server.ts` wires `registerTicketAutomation`.
5. Ticket run prompt augmentation (route test).
6. Frontend: status enum/tabs/chips; merged/close buttons; toast.
7. Tests + manual smoke.
