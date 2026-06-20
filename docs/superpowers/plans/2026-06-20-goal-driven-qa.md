# Goal-Driven (Slice 4 — Multi-Dimensional QA) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** The verification judge evaluates goal-selected QA dimensions (security/performance/ux/architecture) on top of correctness, recording per-dimension results; `achieved` only if all pass. Failures feed the S3 retry loop.

**Architecture:** One verify session per attempt (unchanged); the verify prompt gains dimension rubrics built from the goal's `qa_dimensions`; the `goal_verdict` payload gains an optional per-dimension breakdown.

**Verify:** server tests `npm --prefix server test` (filter `-- <substring>`); server typecheck `cd server && bunx tsc --noEmit` (exit 0); web tests `cd web && bun run test`; web typecheck `cd web && bun run typecheck`.

**Spec:** `docs/superpowers/specs/2026-06-20-goal-driven-qa-design.md`

**Current code anchors (verified, post-S3):**
- `store.ts`: `GoalRow` (…report, verdict, max_iterations, iteration, created_at). `createGoal(i:{projectPath,title,expectedOutput,acceptance?,maxIterations?})` → `insertGoal.run(id, projectPath, title, expectedOutput, acceptance??null, maxIterations, Date.now())`. `insertGoal` = `INSERT INTO goal (id, project_path, title, expected_output, acceptance, status, branch, worktree_path, session_id, report, max_iterations, created_at) VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, NULL, ?, ?)`. migrate() has a goal CREATE TABLE + `goalCols` PRAGMA set with verdict/max_iterations/iteration ALTERs.
- `deckTools.ts`: `GoalVerdictArgs { achieved, reasons, unmet_criteria, tests_summary }`; the `goal_verdict` tool's zod schema mirrors it; `goalVerdictHandler(store, goalId, args)` persists `JSON.stringify(args)`.
- `goalRunner.ts`: `verifyPrompt(goalId, expected, acceptance)` (lines ~34-43); `startVerification` calls `verifyPrompt(goalId, g.expected_output, g.acceptance)`.
- `routes.ts`: `POST /api/goals` Body `{title, expected_output, acceptance, project, max_iterations}` → `createGoal({projectPath, title, expectedOutput:expected_output, acceptance, maxIterations})`.
- `web/src/lib/types.ts`: `Goal` (+max_iterations, iteration); `GoalVerdict {achieved,reasons,unmet_criteria,tests_summary}`. `web/src/lib/api.ts` `createGoal` body. `web/src/components/deck/goal-form.tsx`, `goal-verdict.tsx`.

**Dimension allowlist (single source):** `["security", "performance", "ux", "architecture"]`.

---

## Task QA-1: store — `qa_dimensions`

**Files:** Modify `server/src/store.ts`; Test extend `server/test/store.goal.test.ts`

- [ ] **Step 1: Failing test** — append inside `describe('Store goals', ...)`:
```typescript
  it('stores qa_dimensions (default empty) and filters to the allowlist', () => {
    const a = store.createGoal({ projectPath: '/p', title: 'A', expectedOutput: 'x' });
    expect(JSON.parse(store.getGoal(a.id)!.qa_dimensions)).toEqual([]);
    const b = store.createGoal({ projectPath: '/p', title: 'B', expectedOutput: 'x', qaDimensions: ['security', 'bogus', 'performance'] });
    expect(JSON.parse(store.getGoal(b.id)!.qa_dimensions)).toEqual(['security', 'performance']);
  });
```

- [ ] **Step 2: Run** — `npm --prefix server test -- store.goal` → FAIL.

- [ ] **Step 3: Implement** — in `server/src/store.ts`:

(a) `GoalRow` — add after `iteration: number;` (or near the other goal fields):
```typescript
  qa_dimensions: string;
```

(b) `migrate()` — in the goal `CREATE TABLE` column list, after `iteration INTEGER NOT NULL DEFAULT 0,` add:
```sql
      qa_dimensions TEXT NOT NULL DEFAULT '[]',
```
and next to the other goal ALTERs add:
```typescript
    if (!goalCols.has('qa_dimensions')) this.db.exec(`ALTER TABLE goal ADD COLUMN qa_dimensions TEXT NOT NULL DEFAULT '[]'`);
```

(c) Add an allowlist constant near the top of the file (after imports):
```typescript
const QA_DIMENSIONS = ['security', 'performance', 'ux', 'architecture'] as const;
```

(d) `insertGoal` prepared statement — add `qa_dimensions` column + `?` (after `max_iterations`):
```typescript
      insertGoal: db.prepare(
        `INSERT INTO goal (id, project_path, title, expected_output, acceptance, status, branch, worktree_path, session_id, report, max_iterations, qa_dimensions, created_at)
         VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, NULL, ?, ?, ?)`,
      ),
```

(e) `createGoal` — accept + filter `qaDimensions`:
```typescript
  createGoal(i: { projectPath: string; title: string; expectedOutput: string; acceptance?: string; maxIterations?: number; qaDimensions?: string[] }): GoalRow {
    const id = randomUUID();
    const maxIterations = Math.max(1, Math.floor(i.maxIterations ?? 3));
    const dims = (i.qaDimensions ?? []).filter((d): d is (typeof QA_DIMENSIONS)[number] => (QA_DIMENSIONS as readonly string[]).includes(d));
    this.stmts.insertGoal.run(id, i.projectPath, i.title, i.expectedOutput, i.acceptance ?? null, maxIterations, JSON.stringify(dims), Date.now());
    return this.getGoal(id)!;
  }
```

- [ ] **Step 4: Run** — `npm --prefix server test -- store.goal` → PASS; full suite + `cd server && bunx tsc --noEmit` (exit 0).

- [ ] **Step 5: Commit**
```bash
git add server/src/store.ts server/test/store.goal.test.ts
git commit -m "feat(store): goal qa_dimensions (allowlist-filtered)"
```

---

## Task QA-2: `goal_verdict` gains per-dimension results

**Files:** Modify `server/src/deckTools.ts`; Test extend `server/test/deckTools.goal.test.ts`

- [ ] **Step 1: Failing test** — append inside the existing describe in `server/test/deckTools.goal.test.ts`:
```typescript
  it('persists per-dimension verdict results', async () => {
    const g = store.createGoal({ projectPath: '/p', title: 'T', expectedOutput: 'x' });
    await goalVerdictHandler(store, g.id, {
      achieved: false, reasons: 'security issue', unmet_criteria: ['fix injection'], tests_summary: 'pass',
      dimensions: [{ name: 'correctness', passed: true, notes: 'ok' }, { name: 'security', passed: false, notes: 'sql injection in q' }],
    });
    const v = JSON.parse(store.getGoal(g.id)!.verdict!);
    expect(v.dimensions).toHaveLength(2);
    expect(v.dimensions[1]).toEqual({ name: 'security', passed: false, notes: 'sql injection in q' });
  });
```

- [ ] **Step 2: Run** — `npm --prefix server test -- deckTools.goal` → FAIL (TS: `dimensions` not in `GoalVerdictArgs`).

- [ ] **Step 3: Implement** — in `server/src/deckTools.ts`:

(a) `GoalVerdictArgs` — add:
```typescript
  dimensions?: { name: string; passed: boolean; notes: string }[];
```

(b) The `goal_verdict` tool's zod schema — add a `dimensions` field (after `tests_summary`):
```typescript
          dimensions: z
            .array(z.object({ name: z.string(), passed: z.boolean(), notes: z.string() }))
            .optional()
            .describe('Per-dimension results (correctness + any requested QA dimensions)'),
```
(`goalVerdictHandler` is unchanged — it already persists the whole `args`.)

- [ ] **Step 4: Run** — `npm --prefix server test -- deckTools.goal` → PASS; full suite + server tsc (exit 0).

- [ ] **Step 5: Commit**
```bash
git add server/src/deckTools.ts server/test/deckTools.goal.test.ts
git commit -m "feat(mcp): goal_verdict carries per-dimension QA results"
```

---

## Task QA-3: verify prompt gains dimension rubrics

**Files:** Modify `server/src/goalRunner.ts`; Test extend `server/test/goalRunner.test.ts`

- [ ] **Step 1: Failing test** — append a `describe('multi-dimensional QA', ...)` to `server/test/goalRunner.test.ts`:
```typescript
describe('multi-dimensional QA', () => {
  it('verify prompt includes only the goal\'s enabled dimension rubrics', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x', qaDimensions: ['security'] });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    registerGoalAutomation(manager, store, exec);
    exec.start(g.id);
    store.updateGoal(g.id, { report: JSON.stringify({ summary: 's' }) });
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal', source_id: g.id, status: 'idle', result: 'success' });
    const verifyRun = runs.find((r) => r.sourceKind === 'goal_verify');
    expect(verifyRun.prompt).toMatch(/SECURITY/i);
    expect(verifyRun.prompt).not.toMatch(/PERFORMANCE/i);
    expect(verifyRun.prompt).toMatch(/dimensions/i);
  });
});
```

- [ ] **Step 2: Run** — `npm --prefix server test -- goalRunner` → FAIL.

- [ ] **Step 3: Implement** — in `server/src/goalRunner.ts`:

(a) Add a rubric map + extend `verifyPrompt` to take `dimensions: string[]`. Replace the current `verifyPrompt(goalId, expected, acceptance)` function with:
```typescript
const DIMENSION_RUBRICS: Record<string, string> = {
  security: 'SECURITY — check for injection, authn/authz flaws, secrets handling, unsafe input / SSRF, and risky dependencies. Fail if there is any material vulnerability.',
  performance: 'PERFORMANCE — check for obvious inefficiencies, N+1 / unbounded work, blocking calls on hot paths, and needless re-renders. Fail if there is a material performance regression.',
  ux: 'UI/UX — if the change has a UI, check usability, loading/empty/error states, basic accessibility, and that flows make sense. Fail if the UX is materially broken or confusing.',
  architecture: 'ARCHITECTURE — check separation of concerns, fit with existing patterns, absence of unjustified complexity or duplication, and clear boundaries. Fail if the design is materially poor.',
};

function verifyPrompt(goalId: string, expected: string, acceptance: string | null, dimensions: string[]): string {
  const extra = dimensions
    .filter((d) => DIMENSION_RUBRICS[d])
    .map((d) => `- Also rigorously evaluate ${DIMENSION_RUBRICS[d]}`);
  return [
    `A previous agent attempted to achieve the goal below on the CURRENT branch (\`goal/${goalId}\`). Independently and SKEPTICALLY verify whether the goal is genuinely met. Do NOT trust the prior agent's claims. Review the changes (\`git diff\`), run the project's tests yourself, and check each acceptance criterion.`,
    '',
    `Goal (expected output): ${expected}`,
    `Acceptance criteria: ${acceptance && acceptance.trim() ? acceptance : 'verify the changes fully satisfy the expected output above'}`,
    ...(extra.length ? ['', 'In addition to correctness, evaluate these QA dimensions:', ...extra] : []),
    '',
    'Be strict: the goal is achieved ONLY if the tests pass, every acceptance criterion is genuinely satisfied, AND every dimension above passes. If there are no tests, say so in tests_summary and base the verdict on the criteria plus your own inspection. For each dimension you evaluated (including correctness), add an entry to `dimensions` with `passed` + concise `notes`. When done, call the `goal_verdict` tool with your honest structured verdict.',
  ].join('\n');
}
```

(b) `startVerification` — read + pass the goal's dimensions. Change the `prompt: verifyPrompt(goalId, g.expected_output, g.acceptance),` line in `startVerification`'s `runner.run({...})` to first parse the dimensions, then pass them:
```typescript
    let dims: string[] = [];
    try { const p = JSON.parse(g.qa_dimensions); if (Array.isArray(p)) dims = p.filter((d) => typeof d === 'string'); } catch { dims = []; }
    let sessionId: string;
    try {
      sessionId = this.runner.run({
        projectPath: g.project_path,
        cwd: g.worktree_path,
        prompt: verifyPrompt(goalId, g.expected_output, g.acceptance, dims),
        origin: 'goal',
        title: g.title,
        sourceKind: 'goal_verify',
        sourceId: goalId,
      });
```

- [ ] **Step 4: Run** — `npm --prefix server test -- goalRunner` → PASS (all incl new); full suite + server tsc (exit 0).

- [ ] **Step 5: Commit**
```bash
git add server/src/goalRunner.ts server/test/goalRunner.test.ts
git commit -m "feat(goals): verify judge evaluates enabled QA dimensions (security/perf/ux/architecture)"
```

---

## Task QA-4: route accepts `qa_dimensions`

**Files:** Modify `server/src/routes.ts`; Test extend `server/test/routes.goals.test.ts`

- [ ] **Step 1: Failing test** — append inside `describe('goal routes', ...)`:
```typescript
  it('POST /api/goals stores filtered qa_dimensions', async () => {
    const c = await login();
    const r = await app.inject({ method: 'POST', url: '/api/goals', headers: { cookie: c }, payload: { project: 'alpha', title: 'T', expected_output: 'x', qa_dimensions: ['security', 'nope', 'architecture'] } });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.json().qa_dimensions)).toEqual(['security', 'architecture']);
  });
```

- [ ] **Step 2: Run** — `npm --prefix server test -- routes.goals` → FAIL.

- [ ] **Step 3: Implement** — in `server/src/routes.ts`, `POST /api/goals`: widen the Body type to include `qa_dimensions?: string[]`, destructure it, and pass to `createGoal`:
```typescript
  app.post<{ Body: { title?: string; expected_output?: string; acceptance?: string; project?: string; max_iterations?: number; qa_dimensions?: string[] } }>(
    '/api/goals',
    async (req, reply) => {
      const { title, expected_output, acceptance, project, max_iterations, qa_dimensions } = req.body ?? {};
      if (!title || !title.trim() || !expected_output || !expected_output.trim() || !project) {
        return reply.code(400).send({ error: 'title, expected_output and project required' });
      }
      let projectPath: string;
      try {
        projectPath = resolveProjectPath(projectsRoots, project);
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'invalid project' });
      }
      const maxIterations = Number.isFinite(Number(max_iterations)) && Number(max_iterations) > 0
        ? Math.floor(Number(max_iterations))
        : (config.goalMaxIterations ?? 3);
      const qaDimensions = Array.isArray(qa_dimensions) ? qa_dimensions.filter((d) => typeof d === 'string') : [];
      return store.createGoal({ projectPath, title, expectedOutput: expected_output, acceptance, maxIterations, qaDimensions });
    },
  );
```
(`store.createGoal` re-filters against its allowlist, so a bogus value is dropped there too.)

- [ ] **Step 4: Run** — `npm --prefix server test -- routes.goals` → PASS; full suite + server tsc (exit 0).

- [ ] **Step 5: Commit**
```bash
git add server/src/routes.ts server/test/routes.goals.test.ts
git commit -m "feat(api): POST /api/goals accepts qa_dimensions"
```

---

## Task QA-5: client — dimension picker + verdict breakdown

**Files:** Modify `web/src/lib/types.ts`, `web/src/lib/api.ts`, `web/src/components/deck/goal-form.tsx`, `web/src/components/deck/goal-verdict.tsx`

- [ ] **Step 1: Implement** (UI — typecheck gates)

(a) `web/src/lib/types.ts`:
- `Goal` — add `qa_dimensions: string;`.
- `GoalVerdict` — add `dimensions?: { name: string; passed: boolean; notes: string }[];`.

(b) `web/src/lib/api.ts` — widen `createGoal` body:
```typescript
  async createGoal(body: { project: string; title: string; expected_output: string; acceptance?: string; max_iterations?: number; qa_dimensions?: string[] }): Promise<Goal> {
```

(c) `web/src/components/deck/goal-form.tsx` — add dimension checkboxes. Add a constant + state:
```typescript
const QA_DIMS = ["security", "performance", "ux", "architecture"] as const;
```
```typescript
  const [dims, setDims] = useState<string[]>([]);
```
include it in the mutate:
```typescript
      await create.mutateAsync({ project: projectName, title, expected_output: expected, acceptance: acceptance || undefined, max_iterations: maxIterations, qa_dimensions: dims });
```
and render a checkbox row (before the buttons):
```typescript
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="w-full text-[10px] uppercase tracking-wide">Extra QA dimensions</span>
        {QA_DIMS.map((d) => (
          <label key={d} className="flex items-center gap-1 rounded border border-input px-2 py-1 capitalize">
            <input
              type="checkbox"
              checked={dims.includes(d)}
              onChange={(e) => setDims((prev) => (e.target.checked ? [...prev, d] : prev.filter((x) => x !== d)))}
            />
            {d}
          </label>
        ))}
      </div>
```

(d) `web/src/components/deck/goal-verdict.tsx` — render the per-dimension breakdown. In `GoalVerdictView`, after the achieved badge and before `reasons`, add:
```typescript
      {verdict.dimensions && verdict.dimensions.length > 0 && (
        <div className="flex flex-col gap-1">
          {verdict.dimensions.map((d, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={d.passed ? "text-primary" : "text-destructive"}>{d.passed ? "✓" : "✗"}</span>
              <span className="capitalize text-foreground">{d.name}</span>
              {d.notes && <span className="text-muted-foreground">— {d.notes}</span>}
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 2: Typecheck** — `cd web && bun run typecheck` → 0 errors.

- [ ] **Step 3: Commit**
```bash
git add web/src/lib/types.ts web/src/lib/api.ts web/src/components/deck/goal-form.tsx web/src/components/deck/goal-verdict.tsx
git commit -m "feat(web/goals): QA dimension picker + per-dimension verdict breakdown"
```

---

## Task QA-6: verification

**Files:** none

- [ ] `npm --prefix server test` (green) · `cd server && bunx tsc --noEmit` (0) · `cd web && bun run test` (green) · `cd web && bun run typecheck` (0).
- [ ] Live smoke (real spend, gated): a goal with `["security"]` whose change has a flaw → verdict not-achieved with a security dimension failure → loop retries.

---

## Self-Review (plan author)

**Spec coverage:** qa_dimensions column + createGoal filter (QA-1); goal_verdict dimensions (QA-2); verify rubrics + startVerification passes dims (QA-3); route accepts/filters (QA-4); client picker + breakdown (QA-5); verify (QA-6). All §-items mapped. Out-of-scope (per-dimension agents, real SAST/profilers, auto-merge) absent.

**Type/name consistency:** `qa_dimensions` (snake, wire/db) ↔ `qaDimensions` (camel, store/route param); allowlist `["security","performance","ux","architecture"]` identical in store, route filter, client picker; `GoalVerdict.dimensions` shape `{name,passed,notes}` identical server tool ↔ client type ↔ view; `verifyPrompt(goalId, expected, acceptance, dimensions)` signature matches the `startVerification` call.

**Cost:** one verify session per attempt regardless of dimension count; bounded by `max_iterations`.
