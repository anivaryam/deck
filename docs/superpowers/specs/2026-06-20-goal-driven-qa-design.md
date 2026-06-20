# Goal-Driven (Slice 4 — Multi-Dimensional QA) — Design

**Date:** 2026-06-20 · **Status:** Approved (delegated authority) · Builds on S1–S3 (merged).
**Scope:** Extend the verification judge to evaluate, beyond correctness, a goal-selected set of QA **dimensions** — **security, performance, UI/UX, architecture** — each against an explicit rubric, and only confirm `achieved` if every enabled dimension passes. Per-dimension results are recorded and surfaced; failures feed the S3 retry loop.

## 1. Why one multi-lens judge (decision)

The verify pass stays a **single** independent judge session (not N parallel dimension agents). Rationale: cost is bounded to one verify session per attempt (with the S3 loop, total = `max_iterations × (1 build + 1 verify)`); the judge already inspects the diff + runs tests, so adding dimension rubrics to its prompt is cheap; and a fail in any dimension flows through the existing `achieved=false` → `review`/retry path. Dedicated per-dimension agents are a heavier future refinement.

## 2. Dimensions

A goal carries `qa_dimensions`: a subset of `["security", "performance", "ux", "architecture"]` (correctness is **always** evaluated by the base verify prompt and is not in this list). Default `[]` — so existing/default goals behave exactly as S2/S3 (correctness only). The create form lets the user enable extras.

## 3. Data model (`server/src/store.ts`)

`GoalRow` gains `qa_dimensions: string` — a JSON array string, default `'[]'`. Migration: additive `qa_dimensions TEXT NOT NULL DEFAULT '[]'` (CREATE-TABLE + PRAGMA-guarded ALTER). `createGoal` gains `qaDimensions?: string[]` — validated against the allowlist, JSON-stringified, stored. Create-only (not in `updateGoal`). `insertGoal` includes the column.

## 4. Verdict schema (`server/src/deckTools.ts`)

`GoalVerdictArgs` gains `dimensions?: { name: string; passed: boolean; notes: string }[]`. The `goal_verdict` zod schema adds an optional `dimensions` array. `goalVerdictHandler` is unchanged (persists the whole payload). The achieved gate is unchanged: `verdict.achieved === true` — the judge is instructed to set `achieved=false` if any enabled dimension materially fails, and to populate `dimensions` + fold failures into `reasons`/`unmet_criteria`.

## 5. Verify prompt (`server/src/goalRunner.ts`)

`verifyPrompt` gains a `dimensions: string[]` argument. For each enabled dimension it appends a rubric paragraph and instructs the judge to fail `achieved` on a material problem and to report a per-dimension entry:

- **security** — injection, authn/authz, secrets handling, unsafe input / SSRF, risky dependencies.
- **performance** — obvious inefficiencies, N+1 / unbounded work, blocking calls on hot paths, needless re-renders.
- **ux** — *if the change has a UI*, usability, loading/empty/error states, basic accessibility, sensible flows.
- **architecture** — separation of concerns, fits existing patterns, no unjustified complexity/duplication, clear boundaries.

The prompt closes: "For each dimension you evaluated (including correctness), include an entry in `dimensions` with `passed` + concise `notes`. The goal is achieved ONLY if correctness AND every requested dimension pass." `startVerification` reads `goal.qa_dimensions` (JSON-parsed, defaulting to `[]`) and passes it to `verifyPrompt`.

## 6. Routes (`server/src/routes.ts`)

`POST /api/goals` accepts an optional `qa_dimensions: string[]` (filtered to the allowlist) → `createGoal({ ..., qaDimensions })`.

## 7. Client (`web/`)

- **types**: `Goal` gains `qa_dimensions: string` (JSON array string); `GoalVerdict` gains `dimensions?: { name: string; passed: boolean; notes: string }[]`.
- **api**: `createGoal` body gains optional `qa_dimensions: string[]`.
- **goal-form**: a row of checkboxes for the four extra dimensions → `qa_dimensions`.
- **goal-verdict view**: render the `dimensions` breakdown (per-dimension pass/fail + notes) above the existing reasons/unmet/tests.

## 8. Loop interaction

A dimension failure sets `achieved=false` with the failure in `reasons`/`unmet_criteria`; the S3 loop then re-builds with that feedback (the retry prompt already surfaces `reasons` + `unmet_criteria`), so the builder fixes the security/perf/ux/arch issue and re-verifies — bounded by `max_iterations`.

## 9. Safety / cost

One verify session per attempt regardless of dimension count (the judge multiplexes). Bounded by `max_iterations` + concurrency cap. No new sessions, no new unbounded paths.

## 10. Testing

- **Server (vitest):** store `qa_dimensions` column + createGoal(qaDimensions, allowlist-filtered) ; verifyPrompt includes the rubric only for enabled dimensions (e.g. "security" present, "performance" absent); startVerification passes the parsed dimensions; goal_verdict persists a `dimensions` payload; route accepts/filters `qa_dimensions`.
- **Client (vitest):** api sends qa_dimensions (extend the api test); typecheck for the form/verdict UI.
- **Manual smoke (real spend):** a goal with `["security"]` enabled whose change has an injection flaw → verdict not achieved with a security dimension failure → loop retries.

## 11. Out of scope

Dedicated per-dimension judge agents (parallel specialists); dimension-specific tooling (e.g., a real SAST/perf profiler); auto-merge. These are future refinements beyond Slice 4.
