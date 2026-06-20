# Goal-Driven (Slice 3 — Autonomous Loop) — Design

**Date:** 2026-06-20 · **Status:** Approved (delegated authority — full autonomous development) · Builds on S1 + S2 (merged).
**Scope:** When a goal lands in `review` (verification did not confirm `achieved`), automatically re-build — feeding the judge's failure reasons into the next attempt — up to a per-goal iteration cap, until `achieved` or the cap is exhausted. Cancel is the kill switch.

## 1. Summary

S2 produces a verdict but stops at `review` on failure, leaving a human to retry. S3 closes the loop: the lifecycle watcher, on a not-achieved verify terminal, increments the goal's attempt counter and (if attempts remain) launches a fresh build informed by the prior verdict — looping build→verify→build until `achieved` or the iteration cap is hit. This is the "loop until done" behavior, made **safe** by a hard, deterministic iteration cap.

## 2. Caps & kill switch (decisions)

- **Iteration cap** is the spend bound: a per-goal `max_iterations` (default `config.goalMaxIterations`, default 3, min 1). Total cost is bounded by `max_iterations × (build + verify) sessions × goalMaxTurns` + the existing concurrency cap. Deterministic — no token accounting needed for S3 (a token/$ budget is a future refinement).
- **Kill switch:** `cancel` aborts the active session; `cancelled` is terminal and stops the loop. `achieved` and `failed` are also terminal. Only a not-achieved `review` with attempts remaining continues.
- **No auto-merge** (unchanged) — even an `achieved` goal's branch is merged by a human.

## 3. Data model (`server/src/store.ts`)

`GoalRow` gains:
- `max_iterations: number` — set at create (default 3, min 1); not mutated after.
- `iteration: number` — attempts started so far (0-based index of the current attempt); default 0.

Migration: additive `max_iterations INTEGER NOT NULL DEFAULT 3` and `iteration INTEGER NOT NULL DEFAULT 0` columns (CREATE-TABLE columns + PRAGMA-guarded ALTERs for existing DBs). `createGoal` gains `maxIterations?: number` (default 3, clamped ≥1) and inserts both columns. `updateGoal` allowlist gains `iteration` (max_iterations stays create-only).

## 4. The loop (`server/src/goalRunner.ts` — automation verify branch)

The automation's 3rd argument widens from `{ startVerification }` to **`{ start; startVerification }`** (the `SinglePassExecutor` already has both). On a `goal_verify` terminal that is **not** cancelled:

```
parse verdict
if verdict.achieved === true → status 'achieved'; cleanup
else:
  if g.iteration + 1 < g.max_iterations:
      updateGoal(iteration: g.iteration + 1)   // count the retry
      verifier.start(g.id)                      // re-build (keeps the worktree? no — start() resets it)
      // NOTE: do NOT cleanup here; start() manages the worktree for the next attempt
  else:
      status 'review'  (exhausted); cleanup
```

`start()` already calls `resetWorktree` (wipes the branch/worktree) and re-creates a fresh worktree from HEAD, so each retry is a clean attempt from the project's base — informed by the prior verdict via the prompt (§5), not by leftover code. The `goal` build terminal and the achieved/cancelled paths are unchanged from S2.

## 5. Retry build prompt (`start()` reads the prior verdict before clearing it)

`start(goalId)` currently builds with `goalPrompt(...)` and then clears `verdict`/`report` in the building update. For a retry it must surface the prior verdict to the new builder. Change `start()` to, at entry, read `g.iteration` and `g.verdict`; when `g.iteration > 0` and a verdict is present, build the prompt with a retry preamble:

> This is **attempt N of M** for the goal below. A previous attempt FAILED verification. The judge's verdict was: `<reasons>`. Unmet criteria: `<unmet_criteria>`. Start fresh on the branch and FIX these specifically — do not repeat the same mistakes.

…then the existing `goalPrompt` body. The `building` update still clears `verdict`/`report` (the prompt already captured the prior verdict). When `iteration === 0` (a fresh/manual run), use the normal `goalPrompt`.

## 6. Manual run resets the counter (`server/src/routes.ts`)

`POST /api/goals/:id/run` is a fresh attempt, not a retry: set `iteration: 0` before `start()`:
```
store.updateGoal(g.id, { iteration: 0 });
goalExecutor?.start(g.id);
```
`POST /api/goals` accepts an optional `max_iterations` (clamped to ≥1; default `config.goalMaxIterations ?? 3`) → `createGoal({ ..., maxIterations })`.

## 7. Config (`server/src/config.ts`)

`goalMaxIterations?: number` (env `DECK_GOAL_MAX_ITERATIONS`, default 3, min 1) — the default applied when a goal is created without an explicit `max_iterations`.

## 8. Client (`web/`)

- **types**: `Goal` gains `max_iterations: number` and `iteration: number`.
- **goal-form**: an optional "Max attempts" number input (default 3), sent as `max_iterations`.
- **goal-detail**: an "attempt {iteration + 1} / {max_iterations}" line; while `building`/`verifying` it conveys the loop is progressing (the existing poll already refreshes it).
- `createGoal` api body gains optional `max_iterations`.

## 9. Safety recap

Bounded by the iteration cap (hard stop) + concurrency cap; cancel stops the loop; each attempt is isolated in a fresh worktree on a disposable branch; no auto-merge. The loop cannot run away: after `max_iterations` not-achieved verdicts it parks at `review`.

## 10. Testing

- **Server (vitest):** store columns + createGoal(maxIterations) + updateGoal(iteration); config default; route accepts max_iterations + run resets iteration; the loop — verify-not-achieved with attempts remaining → iteration++ + a fresh build launched (a new `goal` run); verify-not-achieved at the cap → `review` (no new build); achieved/cancelled still stop. Retry prompt includes prior verdict reasons.
- **Client (vitest):** api sends max_iterations; (no new pure-fn tests beyond types — typecheck covers the UI).
- **Manual smoke (real spend):** a goal that fails verification once then can pass → observe build→verify→review→build(attempt 2)→verify→achieved; a goal that always fails → parks at `review` after `max_iterations`.

## 11. Out of scope

Token/$ budget (iteration count is the cap); fix-forward retries (each retry is fresh-from-HEAD); multi-dimensional QA judges (Slice 4).
