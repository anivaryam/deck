# deck — system architecture

deck is a personal **Claude-agent orchestrator**: a chat UI plus an automation
engine that runs Claude Agent SDK sessions against your local projects, streams
them live, and drives unattended work (cron, tickets, autonomous goals). Single
user, single box, full-power agent — no per-request permission prompts by default.

![deck architecture](../.deck-artifacts/deck-architecture.png)

**Stack:** TypeScript · Fastify · better-sqlite3 (SQLite, WAL + FTS5) ·
`@anthropic-ai/claude-agent-sdk` · React 19 + Vite + TanStack Router/Query +
Tailwind/shadcn. Dev runs behind merge-port; prod is a single Fastify origin.

---

## Layers

### Browser (React SPA)
- **Routes/pages** — `$threadId` (chat), `index`, `tasks`, `cron`, `tickets`, `goals`, `login`; auth-guarded outlet.
- **`useSocket()` (`lib/ws.ts`)** — opens `/ws/:sessionId`, replays missed frames via `?since=<seq>`, LRU-caches streams, reconnects with backoff, exposes `send(prompt)` / `cancel()`.
- **`foldEvent()` (`lib/adapt.ts`)** — pure reducer turning raw frames into the `Message[]` transcript model (bubbles, collapsible tool cards). Memoized.
- **`TaskEventWatcher`** — subscribes to the global `/ws/events` firehose; invalidates React Query caches, raises toasts + native notifications on task lifecycle.
- **REST client** — React Query over `fetch`; `401` bounces to `/login`.

### Edge
- **tunnel relay** — optional public HTTPS; strips `Origin` on WS upgrade (so the cookie + `SameSite=strict` is the CSWSH gate, not Origin).
- **dev:** merge-port `:28080` fronts both processes. **prod:** Fastify serves the built SPA via `@fastify/static` with an SPA fallback.
- Routing: `/api`, `/auth`, `/ws` → server; everything else → Vite (dev) / `index.html` (prod).

### Fastify server (`:28787`)
- **`routes.ts`** — REST for sessions, tasks, cron, tickets, goals, runs, projects, upload.
- **`wsHub.ts`** — `/ws/:id` (per-session firehose, backpressure-drops non-terminal frames over 8 MB buffer) and `/ws/events` (global task lifecycle). Rooms = `Map<sessionId, Set<WebSocket>>`.
- **`auth.ts`** — token→opaque cookie (UUID; master token never sent per-request), sliding TTL, login rate-limit, Origin allowlist.
- **`fileServe`** — `GET /api/file/:sessionId/*`, jailed to the project dir, 50 MB cap, inline images/PDF/text. This is how the chat renders artifacts.
- **`config.ts`** — env-driven (`DECK_TOKEN`, `PROJECTS_ROOTS`, `DECK_MODEL`, `DECK_TASK_MODEL`, turn caps, TTLs). No `.env`; config comes from shell exports.

### Orchestration core
- **`SessionManager.send()`** — the heart. Builds SDK options, runs the `sdkQuery()` loop, records every message to `event` + emits `'event'` (→ WS broadcast), tracks the active set / AbortControllers, persists `sdk_session_id` for resume.
- **`TaskRunner`** — fire-and-forget unattended runs with a global concurrency cap (6).
- **`Scheduler`** — Croner; fires `TaskRunner` on schedule with an in-flight guard (skip if the prior run is still active).
- **`GoalRunner`** — autonomous build→verify→retry loop in an isolated git worktree; agent reports via `goal_report`, an independent skeptical pass returns `goal_verdict`; retries up to N iterations.
- **`ticketAutomation` / `goalAutomation`** — listen to task frames and advance ticket/goal state machines.
- **`deckTools` (in-process MCP)** — registered per session: `remember` / `recall` / `forget` (knowledge), `create_ticket` / `list_tickets` / `link_pr`, `goal_report` / `goal_verdict`.

### Persistence (SQLite, `store.ts`)
| Table | Purpose |
|-------|---------|
| `session` | chat/task runs — status, kind, origin, model, `sdk_session_id` |
| `event` | immutable, monotonically-sequenced stream of SDK messages + injected envelopes |
| `cron` | scheduled prompts — schedule, enabled, last-run |
| `ticket` | work items — status, `pr_url`, linked session |
| `goal` | autonomous builds — branch, worktree, iteration, verdict |
| `knowledge` + `knowledge_fts` | scoped learned facts (supersede by `(scope,key)`) + FTS5 cross-scope recall |

Prepared statements compiled once; WAL + `synchronous=NORMAL`; FTS5 kept in sync by triggers; crash recovery flips stale `active` sessions to `errored` at boot.

### External
- **Claude Agent SDK** — `sdkQuery({prompt, options})` returns an async event stream; options carry model, effort, maxTurns, `resume`, and `mcpServers`.
- **git worktrees** — `~/.deck/goal-worktrees`, isolated build dirs for goals.
- **GitHub (gh CLI)** — agent-driven PRs; tickets capture the URL via `link_pr` or an event-tail scan.

---

## Data flows

**Interactive chat**
1. Composer → `send(prompt)` over `/ws/:id`.
2. `wsHub` → `SessionManager.send()`: marks active, records `user_prompt`.
3. `sdkQuery()` streams messages; each is recorded to `event` and broadcast to the session room.
4. Client `foldEvent()` re-renders the transcript live. On finish: status idle, terminal frame sent.

**Unattended (cron / ticket / task)**
1. REST or Croner → `TaskRunner.run()` (concurrency-gated) → creates a `task` session → `SessionManager.send()` fire-and-forget.
2. Task frames bubble to `/ws/events`: automations advance ticket state, the web client invalidates caches and notifies.
3. Unattended runs use `DECK_TASK_MODEL` and capped turns (40; goals 150); interactive is uncapped unless `DECK_MAX_TURNS` is set.

**Autonomous goal**
1. `GoalRunner` validates the repo, creates a worktree on `goal/<id>`.
2. **build** pass (agent implements, tests, calls `goal_report`) → **verify** pass (independent check, calls `goal_verdict`).
3. `achieved` → cleanup; not achieved with iterations left → increment and rebuild; exhausted → park at `review`.

---

## Notable design decisions
- **Cookie session, not per-request token** — master token gates login once; an opaque UUID cookie (httpOnly, `SameSite=strict`) is the per-request credential. Origin may be absent (tunnel strips it) — the cookie is the gate.
- **Permissions bypassed by default** (`DECK_PERMISSION_MODE`), since it's a single-user personal agent. Set `default` to re-enable SDK gating.
- **Event-sourced transcript** — the `event` table is the source of truth; the UI is a pure fold over it, so reconnect/replay is trivial (`?since=seq`).
- **Backpressure with replay** — non-terminal frames may drop under load; terminal frames never do, and the client re-syncs on reconnect.
- **Memory scoped by `project_path`, not `cwd`** — goal runs in detached worktrees still load their home project's knowledge. See `docs/superpowers/specs/2026-06-22-cross-project-memory-design.md`.
- **Crash recovery at boot** — stale `active` sessions → `errored`, so the cron in-flight guard can't deadlock on a ghost.

---

*Diagram source: `.deck-artifacts/deck-architecture.svg` (rebuild PNG with `rsvg-convert -z 1.4 -b '#0a0e0c' …`).*
