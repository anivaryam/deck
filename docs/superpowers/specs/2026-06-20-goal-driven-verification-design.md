# Goal-Driven (Slice 2 — Verification Gate) — Design

**Date:** 2026-06-20
**Status:** Approved (user delegated decision authority — "you are in charge, finish to get the decided output"); pending implementation.
**Scope:** Slice 2 of the Goal-Driven program. Adds an automatic **verification pass** after the Slice-1 build pass: an independent judge agent decides whether the goal is genuinely met, moving a goal to a real **`achieved`** state (or back to `review` with reasons) instead of the unverified `review` S1 always landed at.

**Builds on:** `docs/superpowers/specs/2026-06-20-goal-driven-foundation-design.md` (Slice 1, merged).

## 1. Summary

Slice 1 runs one build pass in an isolated worktree and lands the goal in an **unverified** `review` state carrying the builder's own (untrusted) `goal_met` claim. Slice 2 closes that gap: when the build pass completes successfully, deck automatically launches a **separate, adversarial judge agent** in the same worktree. The judge runs the project's tests, checks the changes against the acceptance criteria, and records a structured **verdict**. The verdict drives the goal to `achieved` (gate passed) or `review` (gate failed, with reasons). No retry loop yet — that is Slice 3.

## 2. Why a judge agent (decision)

Verification is done by **one independent judge agent**, not by deck-side test orchestration. Rationale:
- **Robust across stacks** — the agent figures out how to test any project (npm/cargo/pytest/etc.); deck doesn't need fragile per-stack `verify_command` detection.
- **Trust through independence** — a fresh session with no builder context, prompted to be skeptical, is a credible check on the builder's claims (the same independent-reviewer pattern used to build Slice 1).
- **One clean pass** — both the objective (tests) and semantic (acceptance) checks live in one agent, reusing the existing session machinery.

## 3. Lifecycle

```
queued ─run─▶ building ──(build session terminal)──▶
    success + goal_report  ─▶ verifying ──(verify session terminal)──▶
                                  verdict.achieved        ─▶ achieved
                                  verdict not achieved    ─▶ review   (reasons surfaced)
                                  no verdict / verify error ─▶ review (verification inconclusive)
                                  verify cancelled        ─▶ cancelled
    build error / no report ─▶ failed        (no verification)
    build cancelled         ─▶ cancelled
```

New statuses vs Slice 1: **`verifying`** (judge running) and **`achieved`** (gate passed). `review` now means "build done but not verified-achieved" (either gate failed or inconclusive) — and carries the verdict's reasons.

**Worktree lifetime changes:** in Slice 1 the worktree was removed at the build terminal. In Slice 2 the worktree must survive into verification (the judge needs the changes), so cleanup moves to the **verify terminal** (and still happens on any build-side failure/cancel that skips verification).

## 4. Data model changes (`server/src/store.ts`)

`GoalRow` gains:
- `verdict: string | null` — JSON of `{ achieved, reasons, unmet_criteria, tests_summary }`, written by the `goal_verdict` tool.
- status union extended: `'queued' | 'building' | 'verifying' | 'achieved' | 'review' | 'failed' | 'cancelled'`.

`updateGoal`'s allowlist gains `verdict`. The `goal` table gains a `verdict TEXT` column (additive migration). `SessionOrigin`/`sourceKind` gain **`'goal_verify'`** (alongside the existing `'goal'`).

## 5. The verifier session

A verification run is an ordinary task session, distinguished from the build session by `source_kind = 'goal_verify'` (build = `'goal'`), both with `source_id = goalId` and `cwd = the goal's worktree`. Implications:
- **Tool gating** (`server/src/sessionManager.ts` → `buildDeckMcp`): a `'goal'` session is exposed `goal_report`; a `'goal_verify'` session is exposed **`goal_verdict`** (and not `goal_report`).
- **Turn cap:** the `goalMaxTurns` branch in `sessionManager` applies to both `'goal'` and `'goal_verify'` sessions.
- **Worktree cwd:** the verifier reuses the build worktree (the changes are on its `goal/<id>` branch), via the existing per-session `cwd`.

## 6. `goal_verdict` MCP tool (`server/src/deckTools.ts`)

Added with the same conditional-exposure pattern as `goal_report`/`link_pr`, gated on a verify context. `buildDeckMcp` gains a `verifyGoalId?` parameter; when set, it exposes:

```
goal_verdict({
  achieved: boolean,              // the gate result
  reasons: string,                // why achieved / why not
  unmet_criteria: string[],       // acceptance criteria not satisfied (empty if achieved)
  tests_summary: string,          // what tests were run and their result
})
```

On call, deck persists the payload to `goal.verdict`. Its presence + `achieved` flag drive the verify-terminal status decision.

`deckToolNames(ticketId?, goalId?, verifyGoalId?)` adds `'goal_verdict'` when `verifyGoalId` is set.

## 7. Verify prompt (adversarial)

Built by the executor and passed as the verify session's prompt:

> A previous agent attempted to achieve the goal below on the **current branch** (`goal/<id>`). Independently and **skeptically** verify whether the goal is genuinely met. Do **not** trust the prior agent's claims. Review the changes (`git diff` against the base), run the project's tests yourself, and check each acceptance criterion.
> **Goal (expected output):** `<expected_output>`
> **Acceptance criteria:** `<acceptance, or — if empty — "verify the changes fully satisfy the expected output above">`
> Be strict: a goal is **achieved only if the tests pass and every acceptance criterion is genuinely satisfied**. If there are no tests, say so in `tests_summary` and base the verdict on the criteria plus your own inspection. When done, call the **`goal_verdict`** tool with your honest structured verdict.

The verifier inherits the `claude_code` preset (has bash + skills), so it can run tests and inspect the diff.

## 8. Executor + automation changes (`server/src/goalRunner.ts`)

`SinglePassExecutor` gains a second entry point:
- `startVerification(goalId)`: loads the goal; if its worktree is missing, fail gracefully (→ `review`, "worktree gone, cannot verify"); otherwise launch a task run with `sourceKind: 'goal_verify'`, `cwd = goal.worktree_path`, the verify prompt, and update `goal.session_id` to the verifier's id (so cancel targets the active session).

`registerGoalAutomation(manager, store, verifier)` gains a `verifier: { startVerification(goalId): void }` dependency and handles **both** kinds:
- `source_kind === 'goal'` (build) terminal:
  - `cancelled` → `cancelled` + worktree cleanup.
  - `success` **and** `goal.report` present → status **`verifying`**, then `verifier.startVerification(goalId)` (worktree **kept**).
  - else → `failed` + worktree cleanup.
- `source_kind === 'goal_verify'` (verify) terminal:
  - `cancelled` → `cancelled` + cleanup.
  - read `goal.verdict`: present and `achieved === true` → `achieved`; present and not achieved → `review`; absent (judge errored / never called the tool) → `review`; → then worktree cleanup in all cases.

The `SinglePassExecutor` itself is the natural `verifier` (it owns the worktree + runner), so `server.ts` passes the same instance into both `registerRoutes` (as `goalExecutor`) and `registerGoalAutomation` (as `verifier`).

## 9. API

No new endpoints. Verification is automatic (triggered by the build terminal). Existing `run`/`cancel`/`delete` suffice:
- **Cancel** during `verifying` cancels the active verifier session (`goal.session_id` points at it), which the automation turns into `cancelled` + cleanup.
- **Delete** still 409s while `building`; it should also 409 while `verifying` (a live verifier session + worktree). The delete guard changes from `=== 'building'` to `(=== 'building' || === 'verifying')`.
- **Run again** on an `achieved`/`review`/`failed`/`cancelled` goal re-enters the build pass (Slice 1 re-run path, already idempotent). The executor clears the stale `verdict` **and** `report` (`updateGoal({ verdict: null, report: null })`) at the start of `start()`, so a prior attempt's output doesn't linger during the fresh build.

## 10. Client (`web/`)

- **types** (`lib/types.ts`): `Goal.status` union + `'verifying' | 'achieved'`; `Goal.verdict: string | null`; a `GoalVerdict` interface `{ achieved, reasons, unmet_criteria, tests_summary }`.
- **status vocab** (`lib/automation.ts`): `goalStatus` maps `verifying → 'running'` and `achieved → 'merged'` (the strongest-success chip), plus existing mappings.
- **verdict view**: a `goal-verdict.tsx` component rendering the verdict (achieved badge or "not met", reasons, unmet criteria list, tests summary), shown in `goal-detail.tsx` when `goal.verdict` is present — alongside the existing report.
- The list/detail already poll while `building`; extend the poll predicate to also poll while `verifying` (both `useGoal` and `useGoals`).

## 11. Safety

- The verifier runs `bypassPermissions` in the same throwaway worktree — same blast-radius bound as the builder (no auto-merge; branch is disposable).
- Bounded by `goalMaxTurns` + the concurrency cap.
- The verifier is independent (fresh session, adversarial prompt) — it cannot inherit the builder's context or rationalizations.
- A judge that never calls `goal_verdict` (or errors) → `review` (inconclusive), never a false `achieved`. The gate **fails closed**: `achieved` requires an explicit positive verdict.

## 12. Testing

- **Server (vitest):** store goal `verdict` column + `updateGoal({verdict})`; `goal_verdict` tool gating (only with verifyGoalId) + persistence; `deckTools` exposure (`goal_verdict` not exposed to a build session, exposed to a verify session); `sessionManager` exposes `goal_verdict` for `source_kind==='goal_verify'` and gives it `goalMaxTurns`; `startVerification` launches a `goal_verify` run in the worktree + updates session_id; `registerGoalAutomation` — build success → `verifying` + verifier invoked (worktree kept); verify terminal with `achieved` verdict → `achieved` + cleanup; verify terminal with not-achieved verdict → `review`; verify terminal with no verdict → `review`; build failure path unchanged (`failed` + cleanup). Extend `goalRunner.test.ts`, `routes.goals.test.ts` (delete-while-verifying 409, run clears verdict), `deckTools.goal.test.ts`.
- **Client (vitest):** no new api methods (verification is automatic) — extend `goalStatus` tests for `verifying`/`achieved`.
- **Manual smoke (real agent spend):** run a goal whose acceptance is clearly checkable → confirm it flows building → verifying → achieved with a verdict; run a goal designed to fail its tests → confirm verifying → review with unmet reasons.

## 13. Suggested build sequence

1. Store: `verdict` column + status union + `'goal_verify'` unions + `updateGoal` allowlist (tested).
2. `goal_verdict` tool + `buildDeckMcp` verify param + `sessionManager` gating & maxTurns for `goal_verify` (tested).
3. `goalRunner`: `startVerification` + reworked `registerGoalAutomation(manager, store, verifier)` + verify prompt + clear-verdict-on-run (tested).
4. `server.ts`: pass the executor as `verifier` to `registerGoalAutomation`.
5. Routes: delete-while-verifying 409; run clears verdict (tested).
6. Client: types + `goalStatus` + `goal-verdict.tsx` + detail wiring + poll-while-verifying (typecheck).
7. Full verification + (gated) live smoke.

## 14. Out of scope (later slices)

- **Slice 3:** autonomous retry loop (if `review`, re-build automatically) with **budget/iteration caps** + kill switch.
- **Slice 4:** multi-dimensional QA (dedicated UI/UX, security, performance, architecture judges) beyond the single correctness/acceptance judge here.
- Auto-merge of an `achieved` goal's branch.
