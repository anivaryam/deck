# Security model — accepted risks

Deck is a **single-trusted-user** tool. The threat model assumes only the operator
holds the session cookie and reaches the tunnel. The notes below are accepted risks,
not bugs — read before widening exposure (sharing the tunnel, multi-user, public).

## The agent has unsandboxed shell on the host

- `permissionMode` defaults to `bypassPermissions` (`sessionManager.ts`), so the
  SDK's own tool-permission gate is OFF for normal runs.
- No OS sandbox is configured (no container/seccomp/landlock; SDK `sandbox` unset).
- `cwd` is set to the session's project dir but is a **hint, not a jail**. The agent's
  Bash/Read/Write tools can reach anything the server user can: absolute paths, `..`,
  symlinks, `$HOME` (including `~/.bashrc`, where API keys live).
- The `..`/symlink/`realpath` jail in `routes.ts` applies **only** to the read-only
  `GET /api/file/:sessionId/*` artifact route — not to what the agent itself can touch.

**Consequence:** anyone who obtains a valid session cookie gets arbitrary code
execution as the server user. The cookie is the entire security boundary.

If exposure widens, the fix is OS-level isolation (run the agent in a container/
namespace with only the project + `~/.deck/goal-worktrees` mounted, no host creds,
egress controls) — not the app-level path checks, which the agent bypasses.

## WebSocket auth is intentionally Origin-fail-open

- WS upgrade requires a valid session cookie (`isAuthed`) **always**.
- Origin is only rejected when **present and disallowed**; a missing Origin is allowed,
  because the tunnel strips Origin on upgrade (`wsHub.ts`).
- This is sound: the cookie is `httpOnly` + `SameSite=strict`, so a cross-site page
  can't attach it — that, not the Origin check, is the CSWSH defense. Origin is
  defense-in-depth only. **Not a bug.**

## Crash recovery (fixed)

Sessions stranded `active` by a crash are marked `errored` at boot
(`Store.reconcileActiveSessions()` in `store.ts`, called from `server.ts`). Without
this, the scheduler's in-flight guard treated a dead session as still running and that
cron would never fire again.

**Not yet reconciled:** goals left `building`/`verifying` and their `~/.deck/goal-worktrees`
worktrees are not GC'd on boot — orphaned worktrees accumulate after a crash.
