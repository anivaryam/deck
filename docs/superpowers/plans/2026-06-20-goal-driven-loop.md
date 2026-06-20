# Goal-Driven (Slice 3 — Autonomous Loop) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Auto-retry a goal that lands in `review` (feeding the prior verdict's failure reasons into the next build) up to a per-goal `max_iterations` cap, until `achieved` or exhausted. Cancel = kill switch.

**Architecture:** Extend the goal lifecycle. On a not-achieved verify terminal, the watcher increments `iteration` and (if attempts remain) calls the executor's `start()` again for a fresh, verdict-informed build. Iteration cap = deterministic spend bound.

**Verify:** server tests `npm --prefix server test` (filter `-- <substring>`); server typecheck `cd server && bunx tsc --noEmit` (exit 0); web tests `cd web && bun run test`; web typecheck `cd web && bun run typecheck`.

**Spec:** `docs/superpowers/specs/2026-06-20-goal-driven-loop-design.md`

**Current code anchors (verified):**
- `store.ts`: `GoalRow` (status incl verifying/achieved; fields …report, verdict, created_at; no iteration fields); `createGoal(i:{projectPath,title,expectedOutput,acceptance?})` → `insertGoal.run(id, projectPath, title, expectedOutput, acceptance??null, Date.now())`; `insertGoal` = `INSERT INTO goal (id, project_path, title, expected_output, acceptance, status, branch, worktree_path, session_id, report, created_at) VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, NULL, ?)`; migrate() has a goal CREATE TABLE + a `goalCols` PRAGMA set already (from the S2 verdict ALTER); `updateGoal` allowlist `status|branch|worktree_path|session_id|report|verdict`.
- `goalRunner.ts`: `goalPrompt(goalId, expected, acceptance)`; `SinglePassExecutor.start()` (reads g, resetWorktree+addWorktree, `updateGoal({status:'building', branch, worktree_path, verdict:null, report:null})`, runs `goalPrompt`); `registerGoalAutomation(manager, store, verifier: { startVerification })` — verify-not-achieved → `updateGoal({status:'review'})` + cleanup.
- `routes.ts`: `POST /api/goals` (validates title/expected_output/project, `createGoal({projectPath,title,expectedOutput:expected_output,acceptance})`); `POST /api/goals/:id/run` (`if building||verifying → 409`; `goalExecutor?.start(g.id)`).
- `config.ts`: `goalMaxTurns` (env+default pattern at ~line 123).
- `web/src/lib/types.ts`: `Goal` (status union, expected_output, acceptance, …). `web/src/lib/api.ts`: `createGoal(body:{project,title,expected_output,acceptance?})`. `web/src/components/deck/goal-form.tsx`, `goal-detail.tsx`.

---

## Task GL-1: store — `max_iterations` + `iteration`

**Files:** Modify `server/src/store.ts`; Test extend `server/test/store.goal.test.ts`

- [ ] **Step 1: Failing test** — append inside `describe('Store goals', ...)`:
```typescript
  it('stores max_iterations (default 3) and a 0 iteration; updates iteration', () => {
    const a = store.createGoal({ projectPath: '/p', title: 'A', expectedOutput: 'x' });
    expect(store.getGoal(a.id)!.max_iterations).toBe(3);
    expect(store.getGoal(a.id)!.iteration).toBe(0);
    const b = store.createGoal({ projectPath: '/p', title: 'B', expectedOutput: 'x', maxIterations: 5 });
    expect(store.getGoal(b.id)!.max_iterations).toBe(5);
    store.updateGoal(a.id, { iteration: 2 });
    expect(store.getGoal(a.id)!.iteration).toBe(2);
  });
```

- [ ] **Step 2: Run** — `npm --prefix server test -- store.goal` → FAIL.

- [ ] **Step 3: Implement** — in `server/src/store.ts`:

(a) `GoalRow` — add after `verdict: string | null;`:
```typescript
  max_iterations: number;
  iteration: number;
```

(b) `migrate()` — in the goal `CREATE TABLE IF NOT EXISTS goal (...)` column list, after `verdict TEXT,` add:
```sql
      max_iterations INTEGER NOT NULL DEFAULT 3,
      iteration INTEGER NOT NULL DEFAULT 0,
```
and next to the existing `if (!goalCols.has('verdict')) ...` ALTER, add:
```typescript
    if (!goalCols.has('max_iterations')) this.db.exec(`ALTER TABLE goal ADD COLUMN max_iterations INTEGER NOT NULL DEFAULT 3`);
    if (!goalCols.has('iteration')) this.db.exec(`ALTER TABLE goal ADD COLUMN iteration INTEGER NOT NULL DEFAULT 0`);
```

(c) `insertGoal` prepared statement — add `max_iterations` to the column list + a `?` (iteration uses the column default 0):
```typescript
      insertGoal: db.prepare(
        `INSERT INTO goal (id, project_path, title, expected_output, acceptance, status, branch, worktree_path, session_id, report, max_iterations, created_at)
         VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, NULL, ?, ?)`,
      ),
```

(d) `createGoal` — accept `maxIterations` and pass it (clamped ≥1):
```typescript
  createGoal(i: { projectPath: string; title: string; expectedOutput: string; acceptance?: string; maxIterations?: number }): GoalRow {
    const id = randomUUID();
    const maxIterations = Math.max(1, Math.floor(i.maxIterations ?? 3));
    this.stmts.insertGoal.run(id, i.projectPath, i.title, i.expectedOutput, i.acceptance ?? null, maxIterations, Date.now());
    return this.getGoal(id)!;
  }
```

(e) `updateGoal` — add `iteration` to the allowlist (the `Pick<...>` type and the `for (const k of [...] as const)` loop):
```typescript
    p: Partial<Pick<GoalRow, 'status' | 'branch' | 'worktree_path' | 'session_id' | 'report' | 'verdict' | 'iteration'>>,
  ): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of ['status', 'branch', 'worktree_path', 'session_id', 'report', 'verdict', 'iteration'] as const) {
```

- [ ] **Step 4: Run** — `npm --prefix server test -- store.goal` → PASS; full suite + `cd server && bunx tsc --noEmit` (exit 0).

- [ ] **Step 5: Commit**
```bash
git add server/src/store.ts server/test/store.goal.test.ts
git commit -m "feat(store): goal max_iterations + iteration columns for the autonomous loop"
```

---

## Task GL-2: config `goalMaxIterations` + routes (max_iterations, run resets iteration)

**Files:** Modify `server/src/config.ts`, `server/src/routes.ts`; Test extend `server/test/config.test.ts`, `server/test/routes.goals.test.ts`

- [ ] **Step 1: Failing tests**

(a) `server/test/config.test.ts` (append):
```typescript
describe('goalMaxIterations', () => {
  it('defaults to 3 and reads DECK_GOAL_MAX_ITERATIONS', () => {
    const base = { DECK_TOKEN: 'a-long-test-token-value-1234', ANTHROPIC_API_KEY: 'k' };
    expect(loadConfig({ ...base } as any).goalMaxIterations).toBe(3);
    expect(loadConfig({ ...base, DECK_GOAL_MAX_ITERATIONS: '7' } as any).goalMaxIterations).toBe(7);
  });
});
```

(b) `server/test/routes.goals.test.ts` (append inside `describe('goal routes', ...)`):
```typescript
  it('POST /api/goals stores max_iterations from the body', async () => {
    const c = await login();
    const r = await app.inject({ method: 'POST', url: '/api/goals', headers: { cookie: c }, payload: { project: 'alpha', title: 'T', expected_output: 'x', max_iterations: 4 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().max_iterations).toBe(4);
  });

  it('POST /run resets iteration to 0', async () => {
    const c = await login();
    const id = (await create(c)).json().id;
    store.updateGoal(id, { iteration: 2 });
    await app.inject({ method: 'POST', url: `/api/goals/${id}/run`, headers: { cookie: c } });
    expect(store.getGoal(id)!.iteration).toBe(0);
  });
```

- [ ] **Step 2: Run** — `npm --prefix server test -- config` and `-- routes.goals` → FAIL.

- [ ] **Step 3: Implement**

(a) `server/src/config.ts` — add to the `Config` interface (near `goalMaxTurns`):
```typescript
  /** Default attempt cap for a goal's autonomous loop (DECK_GOAL_MAX_ITERATIONS, default 3, min 1). */
  goalMaxIterations?: number;
```
and in the returned object in `loadConfig`:
```typescript
    goalMaxIterations:
      env.DECK_GOAL_MAX_ITERATIONS && Number.isFinite(Number(env.DECK_GOAL_MAX_ITERATIONS))
        ? Math.max(1, Math.floor(Number(env.DECK_GOAL_MAX_ITERATIONS)))
        : 3,
```

(b) `server/src/routes.ts`:
- `POST /api/goals`: widen the Body type to include `max_iterations?: number`, and pass it to `createGoal`. Change the body destructure + the `createGoal` call:
```typescript
  app.post<{ Body: { title?: string; expected_output?: string; acceptance?: string; project?: string; max_iterations?: number } }>(
    '/api/goals',
    async (req, reply) => {
      const { title, expected_output, acceptance, project, max_iterations } = req.body ?? {};
      if (!title || !title.trim() || !expected_output || !expected_output.trim() || !project) {
        return reply.code(400).send({ error: 'title, expected_output and project required' });
      }
      let projectPath: string;
      try {
        projectPath = resolveProjectPath(projectsRoots, project);
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'invalid project' });
      }
      const maxIterations = Math.max(1, Math.floor(Number(max_iterations) || (config.goalMaxIterations ?? 3)));
      return store.createGoal({ projectPath, title, expectedOutput: expected_output, acceptance, maxIterations });
    },
  );
```
- `POST /api/goals/:id/run`: reset iteration before start:
```typescript
    if (g.status === 'building' || g.status === 'verifying') return reply.code(409).send({ error: 'goal is already in progress' });
    store.updateGoal(g.id, { iteration: 0 });
    goalExecutor?.start(g.id);
    return store.getGoal(g.id);
```

- [ ] **Step 4: Run** — both filtered suites PASS; full suite + server tsc (exit 0).

- [ ] **Step 5: Commit**
```bash
git add server/src/config.ts server/src/routes.ts server/test/config.test.ts server/test/routes.goals.test.ts
git commit -m "feat(api): goalMaxIterations config + per-goal max_iterations; run resets iteration"
```

---

## Task GL-3: goalRunner — retry-informed build + the loop

**Files:** Modify `server/src/goalRunner.ts`; Test extend `server/test/goalRunner.test.ts`

- [ ] **Step 1: Failing tests** — append a `describe('autonomous loop', ...)` to `server/test/goalRunner.test.ts` (uses the existing `repo`, `wtBase`, `store`, `taskRunner`, `runs`, `manager`):
```typescript
describe('autonomous loop', () => {
  function buildSuccessFrame(id: string, gid: string) {
    return { id, source_kind: 'goal', source_id: gid, status: 'idle', result: 'success' };
  }

  it('not-achieved with attempts remaining → iteration++ and a fresh build is launched', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x', maxIterations: 3 });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    registerGoalAutomation(manager, store, exec);
    exec.start(g.id); // attempt 0 (iteration 0)
    store.updateGoal(g.id, { report: JSON.stringify({ summary: 's' }) });
    manager.emit('task', buildSuccessFrame(store.getGoal(g.id)!.session_id!, g.id)); // → verifying
    store.updateGoal(g.id, { verdict: JSON.stringify({ achieved: false, reasons: 'tests fail', unmet_criteria: ['x'], tests_summary: 'fail' }) });
    const buildCountBefore = runs.filter((r) => r.sourceKind === 'goal').length;
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal_verify', source_id: g.id, status: 'idle', result: 'success' });
    // retry: iteration incremented, a new goal build launched, status building again
    expect(store.getGoal(g.id)!.iteration).toBe(1);
    expect(store.getGoal(g.id)!.status).toBe('building');
    expect(runs.filter((r) => r.sourceKind === 'goal').length).toBe(buildCountBefore + 1);
    // the retry build prompt mentions the prior failure
    const lastBuild = runs.filter((r) => r.sourceKind === 'goal').at(-1);
    expect(lastBuild.prompt).toMatch(/attempt 2|previous attempt|tests fail/i);
  });

  it('not-achieved at the cap → review (no new build)', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x', maxIterations: 1 });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    registerGoalAutomation(manager, store, exec);
    exec.start(g.id);
    store.updateGoal(g.id, { report: JSON.stringify({ summary: 's' }) });
    manager.emit('task', buildSuccessFrame(store.getGoal(g.id)!.session_id!, g.id));
    store.updateGoal(g.id, { verdict: JSON.stringify({ achieved: false, reasons: 'no', unmet_criteria: [], tests_summary: '' }) });
    const buildCountBefore = runs.filter((r) => r.sourceKind === 'goal').length;
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal_verify', source_id: g.id, status: 'idle', result: 'success' });
    expect(store.getGoal(g.id)!.status).toBe('review');
    expect(runs.filter((r) => r.sourceKind === 'goal').length).toBe(buildCountBefore); // no retry
  });

  it('achieved → achieved (loop stops)', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x', maxIterations: 3 });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    registerGoalAutomation(manager, store, exec);
    exec.start(g.id);
    store.updateGoal(g.id, { report: JSON.stringify({ summary: 's' }) });
    manager.emit('task', buildSuccessFrame(store.getGoal(g.id)!.session_id!, g.id));
    store.updateGoal(g.id, { verdict: JSON.stringify({ achieved: true, reasons: 'ok', unmet_criteria: [], tests_summary: 'pass' }) });
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal_verify', source_id: g.id, status: 'idle', result: 'success' });
    expect(store.getGoal(g.id)!.status).toBe('achieved');
  });
});
```

- [ ] **Step 2: Run** — `npm --prefix server test -- goalRunner` → FAIL.

- [ ] **Step 3: Implement** — in `server/src/goalRunner.ts`:

(a) Add a retry-prompt builder next to `goalPrompt`:
```typescript
function retryPrompt(goalId: string, attempt: number, maxAttempts: number, expected: string, acceptance: string | null, priorVerdict: { reasons?: string; unmet_criteria?: string[] } | null): string {
  const reasons = priorVerdict?.reasons ?? 'verification did not confirm the goal was met';
  const unmet = priorVerdict?.unmet_criteria?.length ? priorVerdict.unmet_criteria.join('; ') : 'none listed';
  return [
    `This is attempt ${attempt} of ${maxAttempts} for the goal below. A previous attempt FAILED verification. The judge's verdict was: ${reasons}. Unmet criteria: ${unmet}. Start fresh on the branch \`goal/${goalId}\` and FIX these specifically — do not repeat the same mistakes. Do NOT merge.`,
    '',
    `Goal (expected output): ${expected}`,
    `Acceptance criteria: ${acceptance && acceptance.trim() ? acceptance : 'none stated'}`,
    '',
    "Plan first, then implement in focused changes, then run the project's tests and confirm they pass. When finished — or if blocked — call the `goal_report` tool with an honest structured outcome.",
  ].join('\n');
}
```

(b) In `SinglePassExecutor.start()`, build the prompt from the goal's current iteration/verdict BEFORE the `building` update clears them. Replace the `prompt: goalPrompt(goalId, g.expected_output, g.acceptance),` line in the `runner.run({...})` call with a precomputed `prompt` variable, and compute it right after the worktree is created (before the building `updateGoal`):
```typescript
    this.store.updateGoal(goalId, { status: 'building', branch, worktree_path: worktreePath, verdict: null, report: null });
    let priorVerdict: { reasons?: string; unmet_criteria?: string[] } | null = null;
    try { priorVerdict = g.verdict ? JSON.parse(g.verdict) : null; } catch { priorVerdict = null; }
    const prompt = g.iteration > 0
      ? retryPrompt(goalId, g.iteration + 1, g.max_iterations, g.expected_output, g.acceptance, priorVerdict)
      : goalPrompt(goalId, g.expected_output, g.acceptance);
    let sessionId: string;
    try {
      sessionId = this.runner.run({
        projectPath: g.project_path,
        cwd: worktreePath,
        prompt,
        origin: 'goal',
        title: g.title,
        sourceKind: 'goal',
        sourceId: goalId,
      });
```
(Note: `g` was read at the top of `start()` and still holds the pre-clear `iteration`/`verdict`, so parsing `g.verdict` here is correct even though the DB row was just cleared.)

(c) Widen the automation `verifier` param type and add the loop. Change the signature:
```typescript
export function registerGoalAutomation(
  manager: Pick<SessionManager, 'on'>,
  store: Store,
  verifier: { start(goalId: string): void; startVerification(goalId: string): void },
): void {
```
and replace the `goal_verify` not-cancelled tail (currently `let verdict...; store.updateGoal({status: achieved?...:'review'}); cleanup();`) with:
```typescript
      // kind === 'goal_verify'
      if (frame.result === 'cancelled') { store.updateGoal(g.id, { status: 'cancelled' }); cleanup(); return; }
      let verdict: { achieved?: boolean } | null = null;
      try { verdict = g.verdict ? JSON.parse(g.verdict) : null; } catch { verdict = null; }
      if (verdict?.achieved === true) { store.updateGoal(g.id, { status: 'achieved' }); cleanup(); return; }
      // not achieved — retry if attempts remain, else park at review
      if (g.iteration + 1 < g.max_iterations) {
        store.updateGoal(g.id, { iteration: g.iteration + 1 });
        verifier.start(g.id); // fresh build (manages its own worktree)
        return;
      }
      store.updateGoal(g.id, { status: 'review' });
      cleanup();
```

- [ ] **Step 4: Run** — `npm --prefix server test -- goalRunner` → PASS (all incl 3 new); full suite + server tsc (exit 0).

- [ ] **Step 5: Commit**
```bash
git add server/src/goalRunner.ts server/test/goalRunner.test.ts
git commit -m "feat(goals): autonomous retry loop — re-build with prior-verdict feedback up to max_iterations"
```

---

## Task GL-4: client — max_iterations + attempt display

**Files:** Modify `web/src/lib/types.ts`, `web/src/lib/api.ts`, `web/src/components/deck/goal-form.tsx`, `web/src/components/deck/goal-detail.tsx`

- [ ] **Step 1: Implement** (UI — no unit tests; typecheck gates)

(a) `web/src/lib/types.ts` — add to `Goal` (near `report`/`verdict`):
```typescript
  max_iterations: number;
  iteration: number;
```

(b) `web/src/lib/api.ts` — widen `createGoal` body:
```typescript
  async createGoal(body: { project: string; title: string; expected_output: string; acceptance?: string; max_iterations?: number }): Promise<Goal> {
```
(the fetch body is `JSON.stringify(body)` — unchanged).

(c) `web/src/components/deck/goal-form.tsx` — add a max-attempts state + input + include it in the mutate. Add state near the others:
```typescript
  const [maxIterations, setMaxIterations] = useState(3);
```
in the submit's `create.mutateAsync({...})`, add `max_iterations: maxIterations`:
```typescript
      await create.mutateAsync({ project: projectName, title, expected_output: expected, acceptance: acceptance || undefined, max_iterations: maxIterations });
```
and add an input before the buttons row:
```typescript
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Max attempts
        <input
          type="number"
          min={1}
          max={10}
          className="w-16 rounded-md border border-input bg-input/40 px-2 py-1 text-sm"
          value={maxIterations}
          onChange={(e) => setMaxIterations(Math.max(1, Number(e.target.value) || 1))}
        />
      </label>
```

(d) `web/src/components/deck/goal-detail.tsx` — show the attempt counter. In the scrollable metadata body (near the `created` line), add:
```typescript
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">attempt</div>
        <div className="mb-3 text-[11px]">{Math.min(goal.iteration + 1, goal.max_iterations)} / {goal.max_iterations}</div>
```

- [ ] **Step 2: Typecheck** — `cd web && bun run typecheck` → 0 errors.

- [ ] **Step 3: Commit**
```bash
git add web/src/lib/types.ts web/src/lib/api.ts web/src/components/deck/goal-form.tsx web/src/components/deck/goal-detail.tsx
git commit -m "feat(web/goals): max-attempts input + attempt counter display"
```

---

## Task GL-5: verification

**Files:** none

- [ ] `npm --prefix server test` (green) · `cd server && bunx tsc --noEmit` (0) · `cd web && bun run test` (green) · `cd web && bun run typecheck` (0).
- [ ] Live smoke (real spend, gated): a goal that fails verification once then passes → build→verify→review→build(attempt 2)→verify→achieved; an always-failing goal → parks at `review` after `max_iterations`.

---

## Self-Review (plan author)

**Spec coverage:** columns+createGoal+updateGoal (GL-1); config+routes max_iterations+run-reset (GL-2); retry prompt + start() prior-verdict read + the loop with iteration cap (GL-3); client types/form/detail (GL-4); verify (GL-5). All §-items mapped. Out-of-scope (token budget, fix-forward, multi-dim QA) absent.

**Type/name consistency:** `max_iterations`/`iteration` consistent store↔routes↔client; `createGoal({maxIterations})` ↔ route `maxIterations`; `verifier: { start, startVerification }` matches the executor (has both) + the GL-3 loop call; loop guard `g.iteration + 1 < g.max_iterations` matches the spec; retry prompt fed from the pre-clear `g.verdict`.

**Loop safety:** the only retry path requires `iteration + 1 < max_iterations` (hard cap); achieved/cancelled/failed/exhausted all terminate. No unbounded path.
