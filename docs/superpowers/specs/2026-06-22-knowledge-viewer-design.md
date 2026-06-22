# Knowledge viewer (deck UI) — design

**Date:** 2026-06-22
**Status:** Approved design — ready for implementation plan

## Problem

Deck auto-records learned facts (the cross-project knowledge store), but there's
no way to *see* what it knows except by watching `remember` tool calls scroll by
in a transcript. The user wants a UI section that lists everything deck has
learned, across all projects.

## Decisions (from brainstorming)

- **Scope:** all projects — a global memory browser, grouped by scope. (Not just
  the current project.)
- **Read-only.** No delete/edit from this view; correction stays via the chat
  (`forget`). Matches the other v1 list pages (cron/tickets/goals are display-only).
- **Placement:** a standalone top-level page reachable from a global sidebar
  link, not a per-project automation page (the data is cross-project, so the
  project-scoped `AutomationPage` shell doesn't fit).

## Non-goals (YAGNI)

- Delete buttons / mutation. (`forget` covers correction.)
- Server-side search. A client-side text filter over the already-fetched list is
  enough at this scale.
- Live WebSocket refresh. Facts change slowly; React Query refetch on navigation
  (default) suffices.

## Architecture

### Backend (2 edits, mirrors existing list endpoints)
- `server/src/store.ts`: `listAllKnowledge(): KnowledgeRow[]` →
  `SELECT * FROM knowledge ORDER BY scope, kind, updated_at DESC`. New prepared
  statement `listAllKnowledge`.
- `server/src/routes.ts`: `app.get('/api/knowledge', async () => store.listAllKnowledge())`
  — identical shape to `GET /api/cron|goals|tickets`. Auth is applied by the same
  preHandler the other `/api/*` routes use.

### Frontend (1 type, 1 api method, 1 hook, 1 route, 1 component, 1 nav link)
- `web/src/lib/types.ts`: `Knowledge` interface mirroring the server row:
  `{ id, scope, kind, key, fact, source_session, created_at, updated_at }` with
  `kind: 'binding'|'convention'|'rule'|'preference'|'infra'`.
- `web/src/lib/api.ts`: `knowledge(): Promise<Knowledge[]>` → `GET /api/knowledge`.
- `web/src/hooks/use-automation-data.ts`: `useKnowledge()` →
  `useQuery({ queryKey: ['knowledge'], queryFn: () => api.knowledge() })`.
- `web/src/routes/memory.tsx`: `createFileRoute('/memory')`. Self-contained page
  (its own header `deck / Memory` mirroring `AutomationPage`'s header markup +
  `NotificationsToggle`), renders `<KnowledgeList/>` inside an `AsyncBoundary`.
  Uses `useAuthRedirect` on the query error (401 → login), like the other pages.
- `web/src/components/deck/knowledge-list.tsx`: the view. Props
  `{ facts: Knowledge[] }`. A text `<input>` filters client-side across
  fact/key/scope (case-insensitive). Facts are **grouped by scope**, groups
  ordered Global-first then projects alphabetically. Each group: a header with a
  scope label (`Global`, or the project path's last segment with the full path
  muted beneath) and a count. Each fact row: a `kind` badge, the fact text, and
  the `key` (muted, if present). Loading / empty / error states; empty copy:
  "No learned facts yet — deck records them as it works."
- `web/src/components/deck/sidebar-projects.tsx`: add a **global** nav `Link` to
  `/memory` (labeled "Memory", `Brain`/`BookMarked` lucide icon) in the sidebar's
  top-level region — NOT nested under a project (the view is cross-project).

## Data flow

Navigate to `/memory` → `useKnowledge()` → `GET /api/knowledge` →
`store.listAllKnowledge()` → grouped + filtered client-side → rendered. No
mutations, no sockets.

## Testing

- `server/test/store.knowledge.test.ts`: `listAllKnowledge` returns facts from all
  scopes, ordered (global + multiple projects), and reflects supersede/forget.
- `server/test/routes.knowledge.test.ts` (or fold into an existing routes test):
  `GET /api/knowledge` returns the list and requires auth (401 without cookie),
  mirroring an existing route test.
- Frontend: follow existing convention — the current list components
  (goals-list etc.) ship without component tests, so no web test framework is
  added. Grouping/filter logic is simple enough to leave to the server + manual
  smoke. (If a pure helper is extracted — e.g. `groupByScope` — give it one unit
  test.)

## Components & boundaries

- `listAllKnowledge` — dumb persistence read, no formatting.
- `KnowledgeList` — pure presentation over `Knowledge[]`; grouping/filtering is
  local state, no data fetching (the route owns the query). Testable in isolation
  if a helper is extracted.
- `routes/memory.tsx` — wiring only (query → boundary → list).

## Open upgrade paths (not now)

- Delete-from-UI (needs `deleteKnowledgeById` + `DELETE /api/knowledge/:id`).
- Server-side FTS search box (reuse `recallFacts`).
- Per-fact provenance (`source_session` link) once that column is populated.
