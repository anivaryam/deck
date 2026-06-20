# Goal-Driven (Slice 2 — Verification Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After the Slice-1 build pass, automatically run an independent adversarial **judge agent** in the worktree that runs tests + checks acceptance and records a structured `goal_verdict`; the verdict drives the goal to `achieved` or back to `review`.

**Architecture:** Extend the existing goal machinery. The build session ends → the lifecycle watcher launches a second task session (`source_kind='goal_verify'`) in the same worktree with an adversarial verify prompt, exposing a new `goal_verdict` MCP tool. The verifier's verdict (`achieved` bool) sets the final status; the worktree is cleaned after verification (not after the build). No retry loop (Slice 3).

**Tech Stack:** Fastify + better-sqlite3 + Claude Agent SDK + vitest (server); React 19 + TanStack Query + vitest (web).

**Spec:** `docs/superpowers/specs/2026-06-20-goal-driven-verification-design.md`

**Verify commands:** server tests `npm --prefix server test` (filter `-- <substring>`); server typecheck `cd server && bunx tsc --noEmit` (exit 0; vitest does NOT typecheck server); web tests `cd web && bun run test`; web typecheck `cd web && bun run typecheck` (NOT `build`).

**Current code anchors (verified):**
- `server/src/goalRunner.ts`: `RunnerLike` (run input `origin:'goal', sourceKind:'goal'`), `goalPrompt(goalId,expected,acceptance)`, `SinglePassExecutor.start()` (resetWorktree→addWorktree→status building→try runner.run catch fail→session_id), `registerGoalAutomation(manager, store)` (handles `source_kind==='goal'` only).
- `server/src/store.ts`: `GoalRow` status `'queued'|'building'|'review'|'failed'|'cancelled'` (no verdict field); `updateGoal` allowlist `status|branch|worktree_path|session_id|report`; goal table created in `migrate()`.
- `server/src/sessionManager.ts:152` maxTurns goal branch (`source_kind==='goal'`); `:167` `buildDeckMcp(store, project, ticketId?, goalId?)` call passing goalId when `source_kind==='goal'`.
- `server/src/deckTools.ts`: `buildDeckMcp(store, projectPath, ticketId?, goalId?)`, `deckToolNames(ticketId?, goalId?)`, `goal_report` pushed `if (goalId)`.
- `server/src/routes.ts:425` delete guard `status === 'building'`.
- `web/src/lib/automation.ts:20` `goalStatus`; `web/src/lib/types.ts:126` `Goal` (+`126` status union, `report` field).

---

## File Structure

**Server — modify:** `store.ts` (verdict column + status union + `goal_verify` unions + allowlist + migration), `deckTools.ts` (`goal_verdict` tool), `sessionManager.ts` (verify gating + maxTurns), `goalRunner.ts` (startVerification + reworked automation + verify prompt + clear-on-run + RunnerLike widen), `server.ts` (verifier wiring), `routes.ts` (delete-while-verifying guard).
**Server — tests:** extend `store.goal.test.ts`, `deckTools.goal.test.ts`, `sessionManager.cwd.test.ts`, `goalRunner.test.ts`, `routes.goals.test.ts`.
**Client — modify:** `lib/types.ts`, `lib/automation.ts` (+test), `components/deck/goal-detail.tsx`, `hooks/use-automation-data.ts`.
**Client — create:** `components/deck/goal-verdict.tsx`.

---

## Task GV-1: store — verdict column, status union, `goal_verify`, allowlist, migration

**Files:** Modify `server/src/store.ts`; Test extend `server/test/store.goal.test.ts`

- [ ] **Step 1: Add failing tests** — append inside `describe('Store goals', ...)` in `server/test/store.goal.test.ts`:

```typescript
  it('persists a verdict and the new statuses', () => {
    const g = store.createGoal({ projectPath: '/p/a', title: 'A', expectedOutput: 'x' });
    store.updateGoal(g.id, { status: 'verifying' });
    expect(store.getGoal(g.id)!.status).toBe('verifying');
    store.updateGoal(g.id, { status: 'achieved', verdict: JSON.stringify({ achieved: true, reasons: 'ok' }) });
    const got = store.getGoal(g.id)!;
    expect(got.status).toBe('achieved');
    expect(JSON.parse(got.verdict!).achieved).toBe(true);
  });
```

- [ ] **Step 2: Run** — `npm --prefix server test -- store.goal` → FAIL (verdict not persisted / type).

- [ ] **Step 3: Implement** — in `server/src/store.ts`:

(a) `GoalRow`: extend the status union and add `verdict`:
```typescript
  status: 'queued' | 'building' | 'verifying' | 'achieved' | 'review' | 'failed' | 'cancelled';
  branch: string | null;
  worktree_path: string | null;
  session_id: string | null;
  report: string | null;
  verdict: string | null;
  created_at: number;
```

(b) `SessionOrigin` already includes `'goal'`; widen the `sourceKind` unions in `createTask` input and `listRunsForSource` to also include `'goal_verify'`:
```typescript
    sourceKind?: 'cron' | 'ticket' | 'goal' | 'goal_verify';   // createTask input
```
```typescript
  listRunsForSource(sourceKind: 'cron' | 'ticket' | 'goal' | 'goal_verify', sourceId: string, limit = 20): SessionRow[] {
```

(c) In `migrate()`, add a `verdict` column to the goal table. The goal `CREATE TABLE` already exists; add `verdict TEXT` to it (for fresh DBs) AND a PRAGMA-guarded ALTER (for DBs created by Slice 1 without the column). After the goal `CREATE TABLE ... ; CREATE INDEX ...` block, add:
```typescript
    // Additive: goal.verdict was added in Slice 2; ALTER for DBs created before it.
    const goalCols = new Set(
      (this.db.prepare(`PRAGMA table_info(goal)`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    if (!goalCols.has('verdict')) this.db.exec(`ALTER TABLE goal ADD COLUMN verdict TEXT`);
```
and add `verdict TEXT` to the goal `CREATE TABLE` column list (after `report TEXT,`).

(d) The `insertGoal` statement inserts an explicit column list (`id, project_path, title, expected_output, acceptance, status, branch, worktree_path, session_id, report, created_at`). `verdict` is not inserted (defaults to NULL) — leave insertGoal as-is.

(e) `updateGoal`: add `verdict` to the allowlist:
```typescript
    p: Partial<Pick<GoalRow, 'status' | 'branch' | 'worktree_path' | 'session_id' | 'report' | 'verdict'>>,
  ): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of ['status', 'branch', 'worktree_path', 'session_id', 'report', 'verdict'] as const) {
```

- [ ] **Step 4: Run** — `npm --prefix server test -- store.goal` → PASS; then full suite + `cd server && bunx tsc --noEmit` (exit 0).

- [ ] **Step 5: Commit**
```bash
git add server/src/store.ts server/test/store.goal.test.ts
git commit -m "feat(store): goal verdict column + verifying/achieved statuses + goal_verify kind"
```

---

## Task GV-2: `goal_verdict` MCP tool + verify-session gating

**Files:** Modify `server/src/deckTools.ts`, `server/src/sessionManager.ts`; Test extend `server/test/deckTools.goal.test.ts`, `server/test/sessionManager.cwd.test.ts`

- [ ] **Step 1: Add failing tests**

(a) append to `server/test/deckTools.goal.test.ts` (inside the existing `describe`):
```typescript
  it('exposes goal_verdict only when a verifyGoalId is present', () => {
    expect(deckToolNames(undefined, 'g1', undefined)).not.toContain('goal_verdict');
    expect(deckToolNames(undefined, undefined, 'g1')).toContain('goal_verdict');
  });

  it('persists the verdict payload to the goal row', async () => {
    const g = store.createGoal({ projectPath: '/p', title: 'T', expectedOutput: 'x' });
    const res = await goalVerdictHandler(store, g.id, {
      achieved: true, reasons: 'tests pass, criteria met', unmet_criteria: [], tests_summary: 'npm test: 10/10',
    });
    expect(res.content[0].text).toMatch(/verdict recorded/i);
    expect(JSON.parse(store.getGoal(g.id)!.verdict!).achieved).toBe(true);
  });
```
Add `goalVerdictHandler` to the import: `import { deckToolNames, goalReportHandler, goalVerdictHandler } from '../src/deckTools.ts';`.

(b) append to `server/test/sessionManager.cwd.test.ts` (inside an appropriate `describe`, reusing `captureOptions`/`store`/`cfg`):
```typescript
describe('sessionManager goal_verify session', () => {
  it('exposes the deck mcp server for a goal_verify session and gives it goalMaxTurns', async () => {
    const a = captureOptions();
    const mgr = new SessionManager(store, cfg, a.queryFn);
    const v = store.createTask({ projectPath: '/proj', prompt: 'p', origin: 'goal', sourceKind: 'goal_verify', cwd: '/proj/wt' });
    await mgr.send(v.id, 'go');
    expect(a.seen.maxTurns).toBe(150);
    expect(a.seen.cwd).toBe('/proj/wt');
    expect(a.seen.mcpServers?.deck).toBeDefined();
  });
});
```

- [ ] **Step 2: Run** — `npm --prefix server test -- deckTools.goal` and `-- sessionManager.cwd` → FAIL.

- [ ] **Step 3: Implement**

(a) `server/src/deckTools.ts` — add the handler (after `goalReportHandler`):
```typescript
export interface GoalVerdictArgs {
  achieved: boolean;
  reasons: string;
  unmet_criteria: string[];
  tests_summary: string;
}

export async function goalVerdictHandler(
  store: Store, goalId: string, args: GoalVerdictArgs,
): Promise<ToolResult> {
  store.updateGoal(goalId, { verdict: JSON.stringify(args) });
  return { content: [{ type: 'text', text: `Verdict recorded for goal ${goalId} (achieved=${args.achieved}).` }] };
}
```

Widen `deckToolNames`:
```typescript
export function deckToolNames(ticketId?: string, goalId?: string, verifyGoalId?: string): string[] {
  const names = ['create_ticket', 'list_tickets'];
  if (ticketId) names.push('link_pr');
  if (goalId) names.push('goal_report');
  if (verifyGoalId) names.push('goal_verdict');
  return names;
}
```

Widen `buildDeckMcp(store, projectPath, ticketId?, goalId?, verifyGoalId?)` — add the 5th param and, after the `if (goalId) {...}` block, before `return createSdkMcpServer(...)`:
```typescript
  if (verifyGoalId) {
    tools.push(
      tool(
        'goal_verdict',
        'Record the FINAL verification verdict for the current goal. Call this exactly once after verifying.',
        {
          achieved: z.boolean().describe('Does the result genuinely meet the goal (tests pass + acceptance met)?'),
          reasons: z.string().describe('Why achieved / why not'),
          unmet_criteria: z.array(z.string()).describe('Acceptance criteria not satisfied (empty if achieved)'),
          tests_summary: z.string().describe('What tests you ran and their result'),
        },
        async (args) => goalVerdictHandler(store, verifyGoalId, args as GoalVerdictArgs),
      ),
    );
  }
```

(b) `server/src/sessionManager.ts`:
- maxTurns line (`:152`): widen the goal branch to include `goal_verify`:
```typescript
        ? ((sess.source_kind === 'goal' || sess.source_kind === 'goal_verify') ? (this.cfg.goalMaxTurns ?? 150) : (this.cfg.maxTurns ?? 40))
```
- `buildDeckMcp` call (`:167`): add the 5th arg for verify sessions:
```typescript
          deck: buildDeckMcp(
            this.store,
            sess.project_path,
            sess.source_kind === 'ticket' && sess.source_id ? sess.source_id : undefined,
            sess.source_kind === 'goal' && sess.source_id ? sess.source_id : undefined,
            sess.source_kind === 'goal_verify' && sess.source_id ? sess.source_id : undefined,
          ),
```

- [ ] **Step 4: Run** — both filtered tests PASS; full suite + `cd server && bunx tsc --noEmit` (exit 0).

- [ ] **Step 5: Commit**
```bash
git add server/src/deckTools.ts server/src/sessionManager.ts server/test/deckTools.goal.test.ts server/test/sessionManager.cwd.test.ts
git commit -m "feat(mcp): goal_verdict tool gated on goal_verify sessions"
```

---

## Task GV-3: goalRunner — verification launch + reworked automation

**Files:** Modify `server/src/goalRunner.ts`; Test extend `server/test/goalRunner.test.ts`

- [ ] **Step 1: Add failing tests** — the existing `goalRunner.test.ts` builds a temp git repo, a fake `taskRunner` (records `runs`, creates a task row), and an `EventEmitter` `manager`. Append:

```typescript
describe('verification gate', () => {
  it('build success+report → verifying and launches a goal_verify run (worktree kept)', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x', acceptance: 'x works' });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    registerGoalAutomation(manager, store, exec);
    exec.start(g.id);
    const wt = store.getGoal(g.id)!.worktree_path!;
    store.updateGoal(g.id, { report: JSON.stringify({ summary: 's', goal_met: true }) });
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal', source_id: g.id, status: 'idle', result: 'success' });
    expect(store.getGoal(g.id)!.status).toBe('verifying');
    expect(fs.existsSync(wt)).toBe(true); // worktree kept for the verifier
    const verifyRun = runs.find((r) => r.sourceKind === 'goal_verify');
    expect(verifyRun).toBeTruthy();
    expect(verifyRun.cwd).toBe(wt);
    expect(verifyRun.prompt).toMatch(/skeptically|verify/i);
  });

  it('verify terminal with achieved verdict → achieved + worktree removed', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x' });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    registerGoalAutomation(manager, store, exec);
    exec.start(g.id);
    const wt = store.getGoal(g.id)!.worktree_path!;
    store.updateGoal(g.id, { report: JSON.stringify({ summary: 's' }) });
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal', source_id: g.id, status: 'idle', result: 'success' });
    // verifier ran; now it finishes with an achieved verdict
    store.updateGoal(g.id, { verdict: JSON.stringify({ achieved: true, reasons: 'ok', unmet_criteria: [], tests_summary: 'pass' }) });
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal_verify', source_id: g.id, status: 'idle', result: 'success' });
    expect(store.getGoal(g.id)!.status).toBe('achieved');
    expect(fs.existsSync(wt)).toBe(false);
  });

  it('verify terminal with not-achieved verdict → review', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x' });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    registerGoalAutomation(manager, store, exec);
    exec.start(g.id);
    store.updateGoal(g.id, { report: JSON.stringify({ summary: 's' }) });
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal', source_id: g.id, status: 'idle', result: 'success' });
    store.updateGoal(g.id, { verdict: JSON.stringify({ achieved: false, reasons: 'tests fail', unmet_criteria: ['x'], tests_summary: 'fail' }) });
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal_verify', source_id: g.id, status: 'idle', result: 'success' });
    expect(store.getGoal(g.id)!.status).toBe('review');
  });

  it('verify terminal with no verdict → review (inconclusive)', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x' });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    registerGoalAutomation(manager, store, exec);
    exec.start(g.id);
    store.updateGoal(g.id, { report: JSON.stringify({ summary: 's' }) });
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal', source_id: g.id, status: 'idle', result: 'success' });
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal_verify', source_id: g.id, status: 'errored', result: 'error' });
    expect(store.getGoal(g.id)!.status).toBe('review');
  });

  it('build failure still → failed (no verification)', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x' });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    registerGoalAutomation(manager, store, exec);
    exec.start(g.id);
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal', source_id: g.id, status: 'errored', result: 'error' });
    expect(store.getGoal(g.id)!.status).toBe('failed');
    expect(runs.some((r) => r.sourceKind === 'goal_verify')).toBe(false);
  });
});
```

> The existing 2-arg `registerGoalAutomation(manager, store)` calls in earlier tests must be updated to pass a verifier. The simplest: pass the `exec` instance (which now implements `startVerification`). Update those earlier `registerGoalAutomation(manager, store)` call sites in this file to `registerGoalAutomation(manager, store, exec)` (construct `exec` before registering).

- [ ] **Step 2: Run** — `npm --prefix server test -- goalRunner` → FAIL.

- [ ] **Step 3: Implement** — rewrite `server/src/goalRunner.ts`:

(a) Widen `RunnerLike.run` input to allow the verify kind:
```typescript
interface RunnerLike {
  run(input: {
    projectPath: string;
    cwd: string;
    prompt: string;
    origin: 'goal';
    title?: string | null;
    sourceKind: 'goal' | 'goal_verify';
    sourceId: string;
  }): string;
}
```

(b) Add a verify prompt builder (next to `goalPrompt`):
```typescript
function verifyPrompt(goalId: string, expected: string, acceptance: string | null): string {
  return [
    `A previous agent attempted to achieve the goal below on the CURRENT branch (\`goal/${goalId}\`). Independently and SKEPTICALLY verify whether the goal is genuinely met. Do NOT trust the prior agent's claims. Review the changes (\`git diff\`), run the project's tests yourself, and check each acceptance criterion.`,
    '',
    `Goal (expected output): ${expected}`,
    `Acceptance criteria: ${acceptance && acceptance.trim() ? acceptance : 'verify the changes fully satisfy the expected output above'}`,
    '',
    'Be strict: a goal is achieved ONLY if the tests pass and every acceptance criterion is genuinely satisfied. If there are no tests, say so in tests_summary and base the verdict on the criteria plus your own inspection. When done, call the `goal_verdict` tool with your honest structured verdict.',
  ].join('\n');
}
```

(c) In `SinglePassExecutor.start()`, clear stale `verdict`/`report` when entering `building`. Change the line:
```typescript
    this.store.updateGoal(goalId, { status: 'building', branch, worktree_path: worktreePath });
```
to:
```typescript
    this.store.updateGoal(goalId, { status: 'building', branch, worktree_path: worktreePath, verdict: null, report: null });
```

(d) Add a `startVerification` method to `SinglePassExecutor` (after `start`):
```typescript
  /** Launch the adversarial verifier in the goal's existing worktree. */
  startVerification(goalId: string): void {
    const g = this.store.getGoal(goalId);
    if (!g) return;
    if (!g.worktree_path) {
      this.store.updateGoal(goalId, { status: 'review' }); // worktree gone — cannot verify
      return;
    }
    let sessionId: string;
    try {
      sessionId = this.runner.run({
        projectPath: g.project_path,
        cwd: g.worktree_path,
        prompt: verifyPrompt(goalId, g.expected_output, g.acceptance),
        origin: 'goal',
        title: g.title,
        sourceKind: 'goal_verify',
        sourceId: goalId,
      });
    } catch (e) {
      try { removeWorktree(g.project_path, g.worktree_path); } catch { /* best-effort */ }
      this.store.updateGoal(goalId, { status: 'review', worktree_path: null, verdict: JSON.stringify({ achieved: false, reasons: `failed to start verification: ${e instanceof Error ? e.message : e}`, unmet_criteria: [], tests_summary: '' }) });
      return;
    }
    this.store.updateGoal(goalId, { session_id: sessionId });
  }
```

(e) Rework `registerGoalAutomation` to take a `verifier` and handle both kinds:
```typescript
export function registerGoalAutomation(
  manager: Pick<SessionManager, 'on'>,
  store: Store,
  verifier: { startVerification(goalId: string): void },
): void {
  manager.on('task', (frame: { id: string; source_kind: string | null; source_id: string | null; status: string; result: string | null }) => {
    try {
      const kind = frame.source_kind;
      if ((kind !== 'goal' && kind !== 'goal_verify') || !frame.source_id) return;
      const g = store.getGoal(frame.source_id);
      if (!g) return;
      if (frame.status === 'active') return; // mid-run

      const cleanup = () => {
        if (g.worktree_path) {
          try { removeWorktree(g.project_path, g.worktree_path); } catch { /* best-effort */ }
          store.updateGoal(g.id, { worktree_path: null });
        }
      };

      if (kind === 'goal') {
        if (frame.result === 'cancelled') { store.updateGoal(g.id, { status: 'cancelled' }); cleanup(); return; }
        if (frame.result === 'success' && g.report) {
          // build succeeded — hand off to the verifier; keep the worktree.
          store.updateGoal(g.id, { status: 'verifying' });
          verifier.startVerification(g.id);
          return;
        }
        store.updateGoal(g.id, { status: 'failed' }); cleanup(); return;
      }

      // kind === 'goal_verify'
      if (frame.result === 'cancelled') { store.updateGoal(g.id, { status: 'cancelled' }); cleanup(); return; }
      let verdict: { achieved?: boolean } | null = null;
      try { verdict = g.verdict ? JSON.parse(g.verdict) : null; } catch { verdict = null; }
      store.updateGoal(g.id, { status: verdict?.achieved === true ? 'achieved' : 'review' });
      cleanup();
    } catch (err) {
      console.error('[goalAutomation] frame handling failed:', err instanceof Error ? err.message : err);
    }
  });
}
```

- [ ] **Step 4: Run** — `npm --prefix server test -- goalRunner` → PASS; full suite + `cd server && bunx tsc --noEmit` (exit 0).

- [ ] **Step 5: Commit**
```bash
git add server/src/goalRunner.ts server/test/goalRunner.test.ts
git commit -m "feat(goals): adversarial verification pass (startVerification + verdict-driven lifecycle)"
```

---

## Task GV-4: server.ts — wire the verifier

**Files:** Modify `server/src/server.ts`

- [ ] **Step 1: Implement** — `registerGoalAutomation` now needs a 3rd arg. In `server/src/server.ts`, the `goalExecutor` is already constructed (`const goalExecutor = new SinglePassExecutor(...)`) and `registerGoalAutomation(manager, store)` is called. Change that call to pass the executor as the verifier:
```typescript
  registerGoalAutomation(manager, store, goalExecutor);
```
(Ensure `goalExecutor` is constructed BEFORE this call; if the current order has `registerGoalAutomation` first, move it to after the `goalExecutor` construction.)

- [ ] **Step 2: Verify** — `npm --prefix server test` (full, green) + `cd server && bunx tsc --noEmit` (exit 0).

- [ ] **Step 3: Commit**
```bash
git add server/src/server.ts
git commit -m "feat(goals): wire SinglePassExecutor as the verification launcher"
```

---

## Task GV-5: routes — delete-while-verifying guard

**Files:** Modify `server/src/routes.ts`; Test extend `server/test/routes.goals.test.ts`

- [ ] **Step 1: Add failing test** — append inside `describe('goal routes', ...)`:
```typescript
  it('DELETE 409s while verifying', async () => {
    const c = await login();
    const id = (await create(c)).json().id;
    store.updateGoal(id, { status: 'verifying' });
    expect((await app.inject({ method: 'DELETE', url: `/api/goals/${id}`, headers: { cookie: c } })).statusCode).toBe(409);
  });
```

- [ ] **Step 2: Run** — `npm --prefix server test -- routes.goals` → FAIL (verifying currently allows delete → 204).

- [ ] **Step 3: Implement** — in `server/src/routes.ts`, the `DELETE /api/goals/:id` guard:
```typescript
    if (g.status === 'building') return reply.code(409).send({ error: 'cancel the goal before deleting it' });
```
change to:
```typescript
    if (g.status === 'building' || g.status === 'verifying') return reply.code(409).send({ error: 'cancel the goal before deleting it' });
```

- [ ] **Step 4: Run** — `npm --prefix server test -- routes.goals` → PASS; full suite + tsc (exit 0).

- [ ] **Step 5: Commit**
```bash
git add server/src/routes.ts server/test/routes.goals.test.ts
git commit -m "feat(api): block goal delete while verifying"
```

---

## Task GV-6: client types + goalStatus

**Files:** Modify `web/src/lib/types.ts`, `web/src/lib/automation.ts`; Test extend `web/src/lib/automation.test.ts`

- [ ] **Step 1: Add failing test** — append to `web/src/lib/automation.test.ts` (inside the `describe('goalStatus', ...)` block, or a new assertion there):
```typescript
  it("maps verifying and achieved", () => {
    expect(goalStatus("verifying")).toBe("running");
    expect(goalStatus("achieved")).toBe("merged");
  });
```

- [ ] **Step 2: Run** — `cd web && bun run test automation` → FAIL.

- [ ] **Step 3: Implement**

(a) `web/src/lib/automation.ts` `goalStatus` — add cases:
```typescript
export function goalStatus(s: string): AutomationStatus {
  switch (s) {
    case "building": return "running";
    case "verifying": return "running";
    case "achieved": return "merged";
    case "review": return "review";
    case "failed": return "failed";
    case "cancelled": return "closed";
    default: return "open"; // queued
  }
}
```

(b) `web/src/lib/types.ts` — extend `Goal.status`, add `verdict`, and add `GoalVerdict`:
```typescript
  status: "queued" | "building" | "verifying" | "achieved" | "review" | "failed" | "cancelled";
```
add a `verdict: string | null;` field to `Goal` (next to `report`), and add:
```typescript
export interface GoalVerdict {
  achieved: boolean;
  reasons: string;
  unmet_criteria: string[];
  tests_summary: string;
}
```

- [ ] **Step 4: Run** — `cd web && bun run test automation` → PASS; `cd web && bun run typecheck` (0 errors).

- [ ] **Step 5: Commit**
```bash
git add web/src/lib/automation.ts web/src/lib/automation.test.ts web/src/lib/types.ts
git commit -m "feat(web): verifying/achieved status mapping + GoalVerdict type"
```

---

## Task GV-7: client — verdict view + detail wiring + poll-while-verifying

**Files:** Create `web/src/components/deck/goal-verdict.tsx`; Modify `web/src/components/deck/goal-detail.tsx`, `web/src/hooks/use-automation-data.ts`

- [ ] **Step 1: Create `goal-verdict.tsx`**:
```typescript
import type { GoalVerdict } from "@/lib/types";

export function GoalVerdictView({ verdict }: { verdict: GoalVerdict }) {
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className={verdict.achieved ? "font-medium text-primary" : "font-medium text-destructive"}>
        {verdict.achieved ? "✓ verified achieved" : "✗ not achieved"}
      </div>
      <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{verdict.reasons}</p>
      {verdict.unmet_criteria?.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Unmet criteria</div>
          <ul className="list-inside list-disc text-[11px] text-foreground">
            {verdict.unmet_criteria.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}
      {verdict.tests_summary && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Tests</div>
          <pre className="overflow-x-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{verdict.tests_summary}</pre>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `goal-detail.tsx`** — add the import and a parsed verdict, and render it above the report. In `web/src/components/deck/goal-detail.tsx`:

Add import:
```typescript
import { GoalVerdictView } from "./goal-verdict";
import type { Goal, GoalReport, GoalVerdict } from "@/lib/types";
```
(replace the existing `import type { Goal, GoalReport } from "@/lib/types";`).

After the existing guarded `report` parse, add a guarded verdict parse:
```typescript
  let verdict: GoalVerdict | null = null;
  try { verdict = goal.verdict ? JSON.parse(goal.verdict) : null; } catch { verdict = null; }
```

In the scrollable body, render the verdict block BEFORE the report block:
```typescript
        {verdict && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Verdict</div>
            <GoalVerdictView verdict={verdict} />
          </div>
        )}
```

Also: the action row's `building` check gates Cancel-vs-Run. A `verifying` goal is also in-flight — extend the in-flight check. Change:
```typescript
  const building = goal.status === "building";
```
to:
```typescript
  const building = goal.status === "building" || goal.status === "verifying";
```
(So Cancel shows during verifying too, and Delete stays disabled.)

- [ ] **Step 3: Poll while verifying** — in `web/src/hooks/use-automation-data.ts`, both `useGoal` and `useGoals` poll only while `building`. Extend to `verifying`:

`useGoal`:
```typescript
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "building" || s === "verifying" ? 3000 : false;
    },
```
`useGoals`:
```typescript
    refetchInterval: (q) => (q.state.data?.some((g) => g.status === "building" || g.status === "verifying") ? 3000 : false),
```

- [ ] **Step 4: Typecheck** — `cd web && bun run typecheck` (0 errors).

- [ ] **Step 5: Commit**
```bash
git add web/src/components/deck/goal-verdict.tsx web/src/components/deck/goal-detail.tsx web/src/hooks/use-automation-data.ts
git commit -m "feat(web/goals): verdict view + verifying in-flight handling + polling"
```

---

## Task GV-8: full verification + live smoke

**Files:** none (verification only)

- [ ] **Step 1:** `npm --prefix server test` → all green (incl. new GV tests).
- [ ] **Step 2:** `cd server && bunx tsc --noEmit` → exit 0.
- [ ] **Step 3:** `cd web && bun run test` → green; `cd web && bun run typecheck` → 0 errors.
- [ ] **Step 4 (live smoke — real agent spend, only with go-ahead):** Run a goal with a clearly checkable acceptance against a git project → confirm it flows `building → verifying → achieved`, the verdict renders, and the worktree is cleaned. Run a goal whose tests will fail → confirm `verifying → review` with unmet reasons. Cancel during `verifying` → `cancelled`.
- [ ] **Step 5:** Commit any smoke fixes.

---

## Self-Review (plan author)

**Spec coverage:** verdict column + statuses + goal_verify (GV-1); goal_verdict tool + verify gating + maxTurns (GV-2); startVerification + reworked automation + verify prompt + clear-on-run + worktree-kept-until-verify (GV-3); verifier wiring (GV-4); delete-while-verifying (GV-5); client types/status (GV-6); verdict view + in-flight + polling (GV-7); verification (GV-8). All §-items mapped. Out-of-scope (retry loop, multi-dim QA, auto-merge) absent.

**Type/name consistency:** `goalVerdictHandler`/`deckToolNames(ticketId,goalId,verifyGoalId)`/`buildDeckMcp(...,verifyGoalId?)` agree across GV-2 and sessionManager; `registerGoalAutomation(manager, store, verifier)` signature matches GV-3 def, GV-4 wiring, and the updated test call sites; `SinglePassExecutor.startVerification` is the verifier; `sourceKind:'goal_verify'` consistent store↔runner↔sessionManager↔automation; `GoalVerdict` fields consistent server tool ↔ client type ↔ view; `goalStatus` achieved→merged consistent with the chip vocab.

**Fail-closed:** `achieved` requires `verdict.achieved === true`; missing/unparseable/absent verdict → `review`. No path yields a false `achieved`.
