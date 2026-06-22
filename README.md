# deck - Trying out claude:)

A terminal-aesthetic web frontend for the Claude Agent SDK — the design-frozen
"claude-deck" UI (phosphor-green terminal theme, JetBrains Mono, 3-pane layout)
wired to a real Fastify backend that drives live Claude sessions.

- **web/** — Vite SPA (React 19 + TanStack Router + Tailwind v4 + shadcn/ui).
  Pure client; talks to the backend over REST + WebSocket. Visuals are frozen to
  the original design spec — only the data layer is real.
- **server/** — Fastify backend (token auth, SQLite, Claude Agent SDK sessions,
  WebSocket streaming). Carried over verbatim from the `claude-deck` project.

## Architecture

```
browser ──REST /auth /api──┐
        ──WS   /ws/:id   ──┤
                           ▼
            merge-port :8080  ──/api,/auth,/ws──▶ Fastify :8787
                              ──everything else─▶ Vite :3000 (dev)
```

In **production** the SPA is built to `web/dist` and Fastify serves it directly
(single port) — no merge-port needed.

## Setup

```bash
cp .env.example .env        # set DECK_TOKEN (>=16 chars) + model auth
bun install --cwd web       # web deps
npm --prefix server install # backend deps (native better-sqlite3)
```

Model auth: either `ANTHROPIC_API_KEY` in `.env`, or a local Claude Code
subscription login (`~/.claude/.credentials.json`) — `proc-compose.yml` strips
the API key so the subscription is used (no double-spend).

## Run

**Dev (hot reload, one URL):**
```bash
proc-compose up             # server :8787 + vite :3000 + merge-port :8080 (+ tunnel)
# open http://localhost:8080
```

**Production (single port):**
```bash
bun --cwd web run build
npm --prefix server start   # serves web/dist + API on :8787
```

## Verify

```bash
bun --cwd web run test      # adapter unit tests
bun --cwd web run typecheck
npm --prefix server test    # backend suite
```

## Scope (v1)

Interactive **chat only**: projects, sessions, model switch, live streaming with
tool-call blocks, image paste/upload (vision), file upload, slash-command menu,
terminal-style login gate. The backend also exposes background tasks, cron, and
tickets — retained but intentionally without UI to keep the reference design
intact. Settings panel `tools`/`mcp`/`permissions` tabs are display-only (no
backend surface). First message from the empty state opens a session in the
first available project; use a project's **new chat** to choose explicitly.
