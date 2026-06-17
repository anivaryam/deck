# Delete session from the sidebar — design

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan

## Goal

Let a user delete a chat session directly from the sidebar session list. Deleting
removes the session and its stored conversation events permanently. If the session
is currently running an agent turn, the turn is cancelled first. If the deleted
session is the one being viewed, the UI navigates away.

## Decisions

| Question | Decision |
|----------|----------|
| UI affordance | Trash icon, revealed on row hover, on the right of each session row. |
| Confirmation | Lightweight confirm **Popover** ("Delete session? Cancel / Delete"). Reuses `@radix-ui/react-popover` already used in the sidebar — no new dependency, no `AlertDialog` primitive to add. |
| Active (running) session | Cancel the running agent, then delete. User intent wins. |
| Stored events | **Cascade delete** — remove the session row *and* its `event` rows in one transaction. No orphans. |

## Architecture

Mirrors the existing `DELETE /api/cron/:id` pattern (`routes.ts:183`), with two
additions sessions need that cron does not: cancelling an in-flight agent turn and
closing live WebSocket rooms.

### Data flow

```
sidebar trash → confirm popover → onDeleteSession(session)   [deck-view.tsx]
  → api.deleteSession(id)                                     [api.ts]
    → DELETE /api/sessions/:id                                [routes.ts]
        1. store.get(id) → 404 if missing
        2. if manager.isActive(id): manager.discard(id)   (abort + guard)
        3. store.deleteSession(id)                        (txn: events + session)
        4. closeRoom(id)                                  (WS broadcast + close)
        5. 204
  → qc.invalidateQueries(["sessions"])                       [deck-view.tsx]
  → if id === activeThreadId: navigate({ to: "/" })          [deck-view.tsx]
  → toast.success("Session deleted")                         [deck-view.tsx]
```

## Components

### Server

**`store.ts`**
- Add two prepared statements:
  - `deleteEvents`: `DELETE FROM event WHERE session_id = ?`
  - `deleteSession`: `DELETE FROM session WHERE id = ?`
- Add method `deleteSession(id: string): void` that runs both inside a
  `better-sqlite3` transaction (`this.db.transaction(...)`), events first then the
  session row. Idempotent: deleting a missing id is a no-op (0 changes), no throw.

**`sessionManager.ts`**
- Add a private `deleting = new Set<string>()`.
- Add method `discard(id: string): void` — `this.deleting.add(id); this.cancel(id);`.
  Aborts the in-flight SDK loop (via the existing `AbortController`) and marks the id
  so trailing writes are suppressed.
- In `record(...)`, early-return when `this.deleting.has(sessionId)` — prevents the
  aborted loop's trailing `cancelled` event from re-inserting an event row (and
  re-broadcasting) for an already-deleted session. This is the fix for the
  cancel-then-delete orphan/resurrection race.
- In `send(...)`'s `finally`, also `this.deleting.delete(sessionId)` so the set stays
  bounded. (Only ids that were active get added — an idle delete never calls
  `discard`, so no leak there.)

**`wsHub.ts`**
- `registerWs` returns a handle `{ closeRoom(sessionId: string): void }`.
- `closeRoom`: look up the room; broadcast `{ type: 'deleted', payload: { message: 'session deleted' } }`
  to each socket; `socket.close()` each; `rooms.delete(sessionId)`. No-op if no room.

**`routes.ts`**
- `RouteDeps` gains `closeRoom: (id: string) => void`.
- Add handler:
  ```ts
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const id = req.params.id;
    if (!store.get(id)) return reply.code(404).send({ error: 'not found' });
    if (manager.isActive(id)) manager.discard(id);
    store.deleteSession(id);
    closeRoom(id);
    return reply.code(204).send();
  });
  ```
- Note: `routes.ts` does not currently receive `manager` in `RouteDeps`. Add
  `manager: SessionManager` to `RouteDeps` and destructure it. (`server.ts` already
  constructs `manager`.)

**`server.ts`**
- Register WS first to capture the handle, then pass both `manager` and `closeRoom`
  into routes:
  ```ts
  const ws = registerWs(app, { store, manager, config, auth });
  registerRoutes(app, { store, config, taskRunner, scheduler, auth, manager, closeRoom: ws.closeRoom });
  ```
  Handler-definition order is independent between the two registrars, so moving
  `registerWs` above `registerRoutes` is safe.

### Client

**`lib/api.ts`**
- Add `deleteSession(id)` mirroring the existing error-handling style:
  ```ts
  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`/api/sessions/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
      throw new ApiError(res.status, msg);
    }
  }
  ```
  (Returns no body; 204. Cannot reuse `json()` since there's nothing to parse.)

**`components/deck/sidebar-projects.tsx`**
- New prop: `onDeleteSession: (session: Session) => void | Promise<void>`.
- Each session row becomes a `group` so a trash button can appear on hover. The row
  is currently a single `<Link>` filling the grid; restructure to a relative
  container holding the `<Link>` plus an absolutely-positioned trash control on the
  right, so the trash click is not nested inside the navigating link.
- Trash control = `Popover`:
  - Trigger: ghost icon button (`Trash2` from lucide-react), `opacity-0
    group-hover:opacity-100`, `aria-label="Delete session"`. `e.stopPropagation()` /
    `e.preventDefault()` so opening it never navigates.
  - Content: "Delete this session?" + `Cancel` and `Delete` buttons. `Delete` calls
    `onDeleteSession(t)` then closes the popover. Keep it always reachable on touch
    (hover-only reveal is a desktop nicety; the button stays in the DOM, just
    visually faded until hover/focus — `focus-visible:opacity-100` for keyboard).

**`components/deck/deck-view.tsx`**
- Add `handleDeleteSession(session)`:
  ```ts
  async function handleDeleteSession(session: Session) {
    try {
      await api.deleteSession(session.id);
    } catch (err) {
      if ((err as { status?: number })?.status === 401) { navigate({ to: "/login" }); return; }
      toast.error(`Couldn't delete session: ${err instanceof Error ? err.message : "unknown error"}`);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["sessions"] });
    if (session.id === activeThreadId) navigate({ to: "/" });
    toast.success("Session deleted");
  }
  ```
- Pass `onDeleteSession={handleDeleteSession}` into both `renderSidebar` instances
  (desktop + mobile sheet) via the existing `<SidebarProjects .../>`.

## Error handling

- **Missing session** → 404 (already deleted elsewhere / stale list). Client surfaces
  a toast; `invalidateQueries` refreshes the now-correct list.
- **401** → redirect to `/login`, consistent with other mutations in `deck-view`.
- **Active session** → cancelled via `discard` before delete; the `deleting` guard
  prevents trailing event writes. `setStatus('idle')` from the aborted loop is a
  harmless no-op against the deleted row.
- **Live viewers in other tabs** → receive a `{ type: 'deleted' }` WS frame and their
  socket closes; the existing reconnect path will 404 on `/ws/:id` for a gone session
  and stop. (Client handling of the `deleted` frame can be minimal: the room close +
  list invalidation on their next focus is enough; a dedicated client handler for the
  `deleted` type is optional polish, not required for correctness.)

## Testing

Server (existing test style — see `server/` tests):
- `store.deleteSession` removes both the session row and all its event rows;
  no-op on unknown id.
- `DELETE /api/sessions/:id` → 204 and the row is gone; `GET` afterwards → 404.
- `DELETE` on unknown id → 404.
- Deleting an **active** session: with a fake `queryFn` mid-stream, `discard` aborts,
  the row + events are removed, and no new event rows appear after deletion (guard
  works).
- `closeRoom` removes the room and closes attached sockets (can assert via the rooms
  map / a fake socket).

Client (if component tests exist; otherwise manual):
- Trash appears on hover, confirm popover gates the destructive action.
- Deleting the active session navigates to `/`; deleting a background session leaves
  the view intact. Toast on success/failure.

## Out of scope (YAGNI)

- Rename session (the kebab-menu option that was considered — not now).
- Undo / soft-delete (chose hard delete with explicit confirm instead).
- Bulk delete / multi-select.
- Deleting task-kind sessions from a tasks view (this is the chat sidebar only;
  the same server endpoint would work, but no UI is added for it here).

## Files touched

- `server/src/store.ts`
- `server/src/sessionManager.ts`
- `server/src/wsHub.ts`
- `server/src/routes.ts`
- `server/src/server.ts`
- `web/src/lib/api.ts`
- `web/src/components/deck/sidebar-projects.tsx`
- `web/src/components/deck/deck-view.tsx`
