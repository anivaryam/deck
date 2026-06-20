# Goal-Driven (Slice 1 — Foundation) — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm); pending implementation plan
**Scope:** Slice 1 of the Goal-Driven program — a new per-project "Goals" section where a user states an expected output and deck runs **one** orchestrated agent pass in an isolated git worktree, producing a structured report.

## 1. Summary

Goal-Driven lets a user describe a desired outcome ("expected output") and have deck autonomously work toward it. This is a multi-slice program; **this spec covers only Slice 1 (Foundation)**: the goal data model, the "Goals" UI section, a single isolated agent pass (plan → implement → test → report), and a structured report. The autonomous retry loop, machine verification, budget caps, and multi-dimensional QA are explicitly deferred to later slices (§3).

## 2. Conceptual model and an honest reframe

A **goal** is a definition (like a ticket) that, when run, spawns one orchestrated agent **pass** on an isolated git branch and captures a structured **report**.

The original ask was "loop until 100% achieved, fully tested." An unbounded "loop until perfect" is not buildable — it is runaway agent spend and may never terminate, and "perfect" is not machine-decidable. The program instead delivers a **bounded autonomous loop against explicit gates** (later slices). Slice 1 deliberately does **not** verify success: after a clean pass a goal lands in **`review`**, carrying the agent's *self-assessed* `goal_met` claim — clearly labeled as an unverified claim. Verification (the gate that earns an "achieved" state) is Slice 2. This keeps Slice 1 honest by construction: deck never asserts a goal is met when it only has the agent's word.

## 3. Scope

**In scope (Slice 1)**

- `goal` data model + CRUD.
- "Goals" section (4th per-project panel) with create / list / detail / run / cancel / delete.
- `SinglePassExecutor`: one agent pass in a per-goal git worktree on branch `goal/<id>`.
- `goal_report` MCP tool for structured outcome capture.
- Live progress (reuse the existing task event stream) + rendered report.

**Out of scope (later slices, named so the boundaries are explicit)**

- **Slice 2 — Verification gate:** explicit/checkable acceptance criteria + a judge/test gate that decides "goal achieved" (vs the unverified `review` of Slice 1).
- **Slice 3 — Autonomous loop:** wrap pass+verify in a bounded retry loop with **budget ($/token) and iteration caps**, isolation, kill switch.
- **Slice 4 — Multi-dimensional QA:** UI/UX (browser-driven), security, performance, and architecture gates. Likely splits further.
- **Auto-merge** of the goal branch (Slice 1 leaves merging to a human).

The executor is built behind an interface (§6) precisely so Slice 3 can replace the single-pass implementation without touching the goal model, API, or UI.

## 4. Architecture

A goal reuses deck's existing single-agent execution machinery (`taskRunner` → `sessionManager` → Claude Agent SDK) rather than introducing a server-side phase state machine. The "orchestration" lives in (a) a structured **goal prompt** that directs the agent through plan → implement → test → report using its own skills/subagents (the agent runs the `claude_code` preset, `server/src/sessionManager.ts:158`), and (b) deck-side scaffolding around that single session: **git-worktree isolation**, a **structured report tool**, and the **Goals UI**.

```
create goal ──▶ POST /api/goals/:id/run ──▶ goalRunner.start(goal)
   │                                              │
   │                          1. assert git repo  │
   │                          2. git worktree add (branch goal/<id>)
   │                          3. launch task session (cwd = worktree, origin = 'goal', goal prompt)
   │                          4. watch lifecycle (like ticketAutomation)
   ▼                                              ▼
goal row (status)        agent works, commits on branch, calls goal_report(...)
                                                  │
                          terminal: report present → 'review' ; else → 'failed'
                          cleanup: keep branch, remove worktree dir
```

This mirrors the existing ticket→run→watch→update flow (`server/src/ticketAutomation.ts`), extended with worktree isolation and structured reporting.

## 5. Data model

New `goal` table (`server/src/store.ts`), mirroring `TicketRow`:

```
GoalRow:
  id            string
  project_path  string        -- the REAL project (not the worktree)
  title         string
  expected_output text        -- what "done" looks like (the goal)
  acceptance    text | null    -- free-text criteria (Slice 1: human-readable only, not machine-gated)
  status        'queued' | 'building' | 'review' | 'failed' | 'cancelled'
  branch        string | null  -- 'goal/<id>' once a run starts
  worktree_path string | null  -- set during a run; null after cleanup
  session_id    string | null  -- the task session executing the pass
  report        text | null    -- JSON: the goal_report payload
  created_at    number
```

**Status lifecycle:** `queued` →(run)→ `building` →(session terminal **with** a `goal_report`)→ `review`; → `failed` (session error / `maxTurns` exhausted / terminal **without** a report / not a git repo); → `cancelled` (user cancel).

**Union widenings** (small, backward-compatible):
- `SessionOrigin` (`server/src/store.ts:7`) gains `'goal'`. The `origin` column is `TEXT` (store.ts:165), so no value migration is needed.
- `sourceKind` on `createTask` / `listRunsForSource` (store.ts:298, :323) gains `'goal'` so goal runs are attributable like cron/ticket runs.

**Store methods** (mirror the ticket methods): `createGoal`, `getGoal`, `listGoals` (and by-project), `updateGoal(id, patch)`, `deleteGoal`.

## 6. Executor — `goalRunner.ts`

A `GoalExecutor` interface so Slice 3 can swap the implementation:

```
interface GoalExecutor { start(goalId: string): void }   // fire-and-forget; updates the goal row as it progresses
```

Slice-1 implementation `SinglePassExecutor.start(goalId)`:

1. Load the goal; assert `project_path` is a git repo (`git -C <project> rev-parse --is-inside-work-tree`). If not → `updateGoal(status='failed', report={error:'not a git repository'})`, stop.
2. Compute a worktree path under **deck's data dir** (alongside the SQLite database, not inside the project tree) — e.g. `<deck-data>/worktrees/<goalId>`. Run `git -C <project> worktree add <worktreePath> -b goal/<goalId>`. Persist `branch`, `worktree_path`, `status='building'`.
3. Launch a task run through the existing `taskRunner`, with: `origin='goal'`, `sourceKind='goal'`, `sourceId=goalId`, a raised turn cap (`config.goalMaxTurns ?? 150`), and **`cwd` = the worktree path** (§9). Persist `session_id`.
4. Watch the session lifecycle via the same `manager.on('task', …)` channel `ticketAutomation` uses: on a terminal frame, set `review` if a `goal_report` was recorded, else `failed`.
5. Cleanup (terminal or cancel): **keep the branch** (the work lives there), remove the worktree dir (`git -C <project> worktree remove --force <worktreePath>`), null out `worktree_path`.

Concurrency is bounded by the existing `taskRunner` cap (`maxConcurrent`, default 6) — goal passes share it.

## 7. `goal_report` MCP tool

Added to the per-session deck MCP server (`server/src/deckTools.ts`), which already exposes tools **conditionally** by context (`link_pr` is included only when a `ticketId` is present, deckTools.ts:36). By the same pattern, `goal_report` is included only when the session has a `goalId`. Schema:

```
goal_report({
  summary: string,
  goal_met: boolean,                 // the agent's CLAIM (unverified in Slice 1)
  files_changed: string[],
  commands_run: { cmd: string, exit_code: number, output_tail: string }[],
  incomplete: string[],
  notes?: string,
})
```

On call, deck validates the payload and persists it to `goal.report`, and records that a report arrived (this drives `review` vs `failed` at lifecycle terminal). The tool is a no-op/error outside a goal session.

## 8. Goal prompt template

A structured prompt built by `goalRunner` and passed as the task's prompt:

> You are running a production-grade build to achieve the goal below. You are already on an isolated `goal/<id>` git worktree — work here and commit your changes on this branch. Do **not** merge.
> **Goal (expected output):** `<expected_output>`
> **Acceptance criteria:** `<acceptance or "none stated">`
> Plan first, then implement in focused changes, then run the project's tests and confirm they pass. Use your available skills and subagents as appropriate. When finished — or if blocked — call the **`goal_report`** tool with an honest structured outcome: summarize what you built, list files changed and the commands/tests you ran with their results, and list anything still incomplete. Report incomplete items truthfully rather than claiming false success.

(The agent inherits the `claude_code` preset system prompt, so the Skill tool and subagents are available.)

## 9. `sessionManager` cwd override

`sessionManager` currently hardcodes `cwd: sess.project_path` (`server/src/sessionManager.ts:153`). A goal session must run in its worktree. Add an optional working-directory override threaded from `goalRunner` → `taskRunner.run` → the session, with `cwd` falling back to `project_path` when absent. The goal's **real** `project_path` stays on the goal row (used for git operations and project grouping); only the agent's `cwd` points at the worktree. Exact threading (a `worktree_path`/`cwd` field on the session row vs a run parameter) is finalized in the plan.

## 10. API (`server/src/routes.ts`, all auth-gated, mirroring tickets)

- `GET /api/goals` — list.
- `POST /api/goals` — create `{ title, expected_output, acceptance?, project }` → 400 on missing title/expected_output/project or unresolvable project.
- `GET /api/goals/:id` — detail (+ events, like the task detail route).
- `POST /api/goals/:id/run` — `goalRunner.start(id)`; 409 if already `building`.
- `POST /api/goals/:id/cancel` — abort the session + worktree cleanup; → `cancelled`.
- `DELETE /api/goals/:id` — **409 ("cancel the goal before deleting it") if `building`** (same guard pattern as `DELETE /api/tasks/:id`); otherwise delete the row and remove the worktree if one is still present.

## 11. Client + UI

- **`web/src/lib/api.ts` + `use-automation-data.ts`:** `goals`, `goal`, `createGoal`, `runGoal`, `cancelGoal`, `deleteGoal` + matching React Query hooks — mirror the ticket methods/hooks.
- **`web/src/routes/goals.tsx`** (mirrors the tickets panel via `AutomationPage`):
  - List + create form (`expected_output` textarea, `acceptance` textarea).
  - Detail pane: status chip · branch name · **live progress** (reuse `TaskOutput` on the goal's `session_id`) · the **structured report** rendered when present (summary, files changed, commands+results, incomplete list, and the `goal_met` claim shown explicitly as *agent claim — unverified*).
  - Actions: **Run · Cancel · Delete**.
- Add "Goals" to the per-project section nav (alongside Tasks / Cron / Tickets).

## 12. Safety (Slice 1)

- **Worktree isolation** — the user's working tree is never touched; concurrent goals never collide.
- **No auto-merge** — deck produces a branch + report; a human reviews and merges.
- **Cancel** — reuses the task abort path + worktree cleanup.
- **Concurrency cap** — the existing `taskRunner` cap applies.
- **Git-repo required** — non-git projects fail fast with a clear message.
- **`maxTurns` bound** — a single pass is bounded; exhaustion yields an honest `failed`/incomplete report, not a hang.
- Budget/$ caps and the retry loop are **Slice 3** (a single pass still spends, but is bounded by `maxTurns` + the concurrency cap).

## 13. Testing

- **Server (vitest):** goal CRUD; `SinglePassExecutor` worktree add/remove against a **real temporary git repo** (assert branch created, worktree created then removed, status transitions); `goal_report` validation + persistence; routes (`run`→`building`, report→`review`, terminal-without-report→`failed`, non-git-repo→`failed`, `cancel`, delete-while-building guard). Extend the existing `routes.interactive.test.ts`-style harness.
- **Client (vitest):** api methods + hooks (mirror the ticket api tests in `web/src/lib/api.tickets-tasks-cron.test.ts`).
- **Manual smoke:** create a goal → run → watch the live stream → report renders → `git branch` shows `goal/<id>` in the repo and the worktree dir is gone → cancel and delete behave.

## 14. Suggested build sequence

1. `goal` table + store CRUD + union widenings (server, tested).
2. `goal_report` MCP tool + `sessionManager` cwd override (server, tested).
3. `goalRunner` / `SinglePassExecutor` + lifecycle watcher (server, tested against a temp git repo).
4. Goal REST endpoints (server, tested).
5. Client api + hooks (tested).
6. Goals UI section (typecheck + manual smoke).
7. Full verification + live smoke.

## 15. Risks & mitigations

- **A single pass may not finish a real feature within `maxTurns`.** Mitigation: a raised `goalMaxTurns`; honest `incomplete` reporting; the real fix (continuation/iteration) is Slice 3. Slice 1 must not pretend partial work is complete — hence the unverified `review` state.
- **Worktree leakage** (crash mid-run leaves a stray worktree). Mitigation: cleanup on terminal **and** cancel; a startup reconciler that prunes orphaned `goal/*` worktrees with no `building` goal can be added (note for the plan).
- **Autonomous agent with `bypassPermissions` in a worktree** can still run arbitrary commands. Mitigation for Slice 1: isolation (worktree, no auto-merge) bounds blast radius to a throwaway branch; broader sandboxing is a program-level concern revisited in Slice 3.
- **Worktree path inside the project tree** would self-nest. Mitigation: worktrees live under deck's data dir, outside any project.

## 16. Program decomposition (for reference)

Slice 1 (this spec) → Slice 2 (verification gate) → Slice 3 (bounded autonomous loop + budget caps) → Slice 4 (multi-dimensional QA: UI/UX, security, performance, architecture). Each slice is its own spec → plan → implementation cycle and produces working, shippable software on its own.
