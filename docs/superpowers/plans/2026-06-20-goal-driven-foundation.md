# Goal-Driven (Slice 1 — Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-project "Goals" section: a user states an expected output, deck runs ONE orchestrated agent pass in an isolated git worktree (branch `goal/<id>`), captures a structured report via a `goal_report` MCP tool, and lands the goal in an unverified `review` state.

**Architecture:** Reuse deck's existing single-agent machinery (`taskRunner` → `sessionManager` → Claude Agent SDK). A goal = a definition row (like a ticket) that spawns one task session whose `cwd` is a per-goal git worktree, driven by a structured "production-grade build" prompt. Deck adds worktree isolation, a `goal_report` tool, a lifecycle watcher (mirrors `ticketAutomation`), and a Goals UI panel (mirrors the tickets panel). The executor sits behind a `GoalExecutor` interface so Slice 3 can swap the single-pass impl for a loop.

**Tech Stack:** Fastify v5 + better-sqlite3 + Claude Agent SDK + vitest (server); React 19 + TanStack Router/Query + Tailwind + vitest (web). Git worktrees via `node:child_process`.

**Spec:** `docs/superpowers/specs/2026-06-20-goal-driven-foundation-design.md`

**Conventions (verified from the codebase — do not deviate):**
- Server route errors: `return reply.code(N).send({ error: '…' })`; 204 via `reply.code(204).send()`.
- `registerRoutes(app, { store, config, taskRunner, scheduler, manager?, closeRoom? })`; `projectsRoots = config.projectsRoots ?? [config.projectsRoot]`; `resolveProjectPath(projectsRoots, project)` throws on a bad project.
- Store: `migrate()` holds `CREATE TABLE` + an `additions: Array<[col, ALTER sql]>` migration list; `prepareStatements()` holds the `stmts` map; methods use prepared stmts or a fixed-allowlist dynamic `UPDATE`.
- Tasks set status `'active'` synchronously in `taskRunner.run` (a freshly-created run reads `active`).
- MCP tools: `buildDeckMcp(store, projectPath, ticketId?)` builds a per-session server; `link_pr` is conditionally included only when `ticketId` is set (`deckTools.ts`). Zod schemas.
- `sessionManager.send` builds `options.cwd = sess.project_path` and `options.mcpServers.deck = buildDeckMcp(...)`; gates tools via `sess.source_kind === 'ticket' && sess.source_id`.
- Lifecycle: `manager.on('task', frame)` with `frame = { id, source_kind, source_id, status, result }`; `ticketAutomation` is the template.
- Web: routes are file-based (`web/src/routes/goals.tsx` auto-registers `/goals`); panels use `AutomationPage`; status vocab + helpers live in `web/src/lib/automation.ts`; sidebar nav links live in `web/src/components/deck/sidebar-projects.tsx`.
- Verify: server `npm --prefix server test`; web tests `cd web && bun run test`; **web typecheck `cd web && bun run typecheck`** (NOT `build` — `vite build` skips types).

---

## File Structure

**Server — modify:** `store.ts` (goal table + CRUD + `cwd` column + union widenings), `sessionManager.ts` (cwd override + goalId tool gating), `taskRunner.ts` (`cwd` passthrough), `deckTools.ts` (`goal_report` tool), `config.ts` (`goalMaxTurns`), `routes.ts` (goal endpoints), `server.ts` (wire `goalRunner` + automation + worktrees dir).
**Server — create:** `git.ts` (worktree helpers), `goalRunner.ts` (`GoalExecutor` + `SinglePassExecutor` + `registerGoalAutomation`), plus tests `store.goal.test.ts`, `deckTools.goal.test.ts`, `git.test.ts`, `goalRunner.test.ts`, `routes.goals.test.ts`.
**Client — modify:** `lib/api.ts` (goal methods), `lib/types.ts` (`Goal`, `GoalReport`), `lib/automation.ts` (goal status vocab), `hooks/use-automation-data.ts` (goal hooks), `components/deck/sidebar-projects.tsx` (nav link), `lib/api.tickets-tasks-cron.test.ts` (goal api tests).
**Client — create:** `routes/goals.tsx`, `components/deck/goals-list.tsx`, `components/deck/goal-form.tsx`, `components/deck/goal-detail.tsx`, `components/deck/goal-report.tsx`.

---

## PHASE 1 — Server data layer

### Task 1: `goal` table + store CRUD + union widenings

**Files:** Modify `server/src/store.ts`; Create `server/test/store.goal.test.ts`

- [ ] **Step 1: Write the failing test** — Create `server/test/store.goal.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('Store goals', () => {
  it('creates and reads a goal with default queued status', () => {
    const g = store.createGoal({ projectPath: '/p/a', title: 'T', expectedOutput: 'do X', acceptance: 'X works' });
    expect(g.id).toMatch(/.+/);
    expect(g.status).toBe('queued');
    expect(g.expected_output).toBe('do X');
    expect(g.acceptance).toBe('X works');
    expect(store.getGoal(g.id)?.title).toBe('T');
  });

  it('lists goals newest-first and by project', () => {
    const a = store.createGoal({ projectPath: '/p/a', title: 'A', expectedOutput: 'x' });
    const b = store.createGoal({ projectPath: '/p/b', title: 'B', expectedOutput: 'y' });
    expect(store.listGoals().map((g) => g.id)).toEqual([b.id, a.id]);
    expect(store.listGoalsByProject('/p/a').map((g) => g.id)).toEqual([a.id]);
  });

  it('updates a subset of fields', () => {
    const g = store.createGoal({ projectPath: '/p/a', title: 'A', expectedOutput: 'x' });
    store.updateGoal(g.id, { status: 'building', branch: 'goal/' + g.id, worktree_path: '/wt', session_id: 's1' });
    const got = store.getGoal(g.id)!;
    expect(got.status).toBe('building');
    expect(got.branch).toBe('goal/' + g.id);
    expect(got.worktree_path).toBe('/wt');
    expect(got.session_id).toBe('s1');
  });

  it('persists a report and deletes', () => {
    const g = store.createGoal({ projectPath: '/p/a', title: 'A', expectedOutput: 'x' });
    store.updateGoal(g.id, { report: JSON.stringify({ summary: 's' }) });
    expect(JSON.parse(store.getGoal(g.id)!.report!)).toEqual({ summary: 's' });
    store.deleteGoal(g.id);
    expect(store.getGoal(g.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm --prefix server test -- store.goal` → FAIL (`createGoal is not a function`).

- [ ] **Step 3: Implement** — In `server/src/store.ts`:

(a) Widen unions near the top:

```typescript
export type SessionOrigin = 'manual' | 'cron' | 'ticket' | 'goal';
```

(b) Add the `GoalRow` interface after `TicketRow`:

```typescript
export interface GoalRow {
  id: string;
  project_path: string;
  title: string;
  expected_output: string;
  acceptance: string | null;
  status: 'queued' | 'building' | 'review' | 'failed' | 'cancelled';
  branch: string | null;
  worktree_path: string | null;
  session_id: string | null;
  report: string | null;
  created_at: number;
}
```

(c) In `migrate()`, add a `cwd` column to the session `additions` array (for Task 2) and a `goal` table to the second `db.exec`. Add to `additions`:

```typescript
    ['cwd', `ALTER TABLE session ADD COLUMN cwd TEXT`],
```

and append to the `CREATE TABLE` exec block (after the `ticket` table):

```sql
    CREATE TABLE IF NOT EXISTS goal (
      id TEXT PRIMARY KEY, project_path TEXT NOT NULL, title TEXT NOT NULL,
      expected_output TEXT NOT NULL, acceptance TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      branch TEXT, worktree_path TEXT, session_id TEXT, report TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goal_project ON goal(project_path);
```

(d) In `prepareStatements()`, add goal statements to the `stmts` map:

```typescript
    insertGoal: db.prepare(
      `INSERT INTO goal (id, project_path, title, expected_output, acceptance, status, branch, worktree_path, session_id, report, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, NULL, ?)`,
    ),
    getGoal: db.prepare(`SELECT * FROM goal WHERE id = ?`),
    listGoals: db.prepare(`SELECT * FROM goal ORDER BY created_at DESC`),
    listGoalsByProject: db.prepare(`SELECT * FROM goal WHERE project_path = ? ORDER BY created_at DESC`),
    deleteGoal: db.prepare(`DELETE FROM goal WHERE id = ?`),
```

(e) Add methods (after the ticket methods):

```typescript
  createGoal(i: { projectPath: string; title: string; expectedOutput: string; acceptance?: string }): GoalRow {
    const id = randomUUID();
    this.stmts.insertGoal.run(id, i.projectPath, i.title, i.expectedOutput, i.acceptance ?? null, Date.now());
    return this.getGoal(id)!;
  }

  getGoal(id: string): GoalRow | undefined {
    return this.stmts.getGoal.get(id) as GoalRow | undefined;
  }

  listGoals(): GoalRow[] {
    return this.stmts.listGoals.all() as GoalRow[];
  }

  listGoalsByProject(projectPath: string): GoalRow[] {
    return this.stmts.listGoalsByProject.all(projectPath) as GoalRow[];
  }

  updateGoal(
    id: string,
    p: Partial<Pick<GoalRow, 'status' | 'branch' | 'worktree_path' | 'session_id' | 'report'>>,
  ): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of ['status', 'branch', 'worktree_path', 'session_id', 'report'] as const) {
      if (p[k] !== undefined) {
        sets.push(`${k} = ?`);
        vals.push(p[k]);
      }
    }
    if (!sets.length) return;
    vals.push(id);
    this.db.prepare(`UPDATE goal SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  deleteGoal(id: string): void {
    this.stmts.deleteGoal.run(id);
  }
```

(f) Widen `createTask`'s `sourceKind` param and `listRunsForSource`'s param to include `'goal'`:

```typescript
    sourceKind?: 'cron' | 'ticket' | 'goal';   // in createTask input type
```
```typescript
  listRunsForSource(sourceKind: 'cron' | 'ticket' | 'goal', sourceId: string, limit = 20): SessionRow[] {
```

- [ ] **Step 4: Run to verify it passes** — `npm --prefix server test -- store.goal` → PASS (4).

- [ ] **Step 5: Commit**

```bash
git add server/src/store.ts server/test/store.goal.test.ts
git commit -m "feat(store): goal table + CRUD; widen origin/sourceKind for goals; session cwd column"
```

---

### Task 2: session `cwd` override (worktree working directory)

**Files:** Modify `server/src/store.ts` (SessionRow + insertTask + createTask), `server/src/taskRunner.ts`, `server/src/sessionManager.ts`; Test `server/test/sessionManager.cwd.test.ts`

> The `cwd` column was already added to the migration in Task 1. This task threads it through.

- [ ] **Step 1: Write the failing test** — Create `server/test/sessionManager.cwd.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { SessionManager } from '../src/sessionManager.ts';

let store: Store;
const cfg = { token: 't', projectsRoot: '/p', port: 1, model: 'claude-opus-4-8' } as any;

beforeEach(() => { store = new Store(':memory:'); });

function captureOptions() {
  const seen: any = {};
  const queryFn = ({ options }: any) => {
    Object.assign(seen, options);
    return (async function* () { /* no events */ })();
  };
  return { seen, queryFn };
}

describe('sessionManager cwd', () => {
  it('uses the session cwd override when set, else project_path', async () => {
    const { seen, queryFn } = captureOptions();
    const mgr = new SessionManager(store, cfg, queryFn);
    const task = store.createTask({ projectPath: '/proj', prompt: 'p', origin: 'goal', cwd: '/proj/.wt/abc' });
    await mgr.send(task.id, 'go');
    expect(seen.cwd).toBe('/proj/.wt/abc');

    const seen2 = captureOptions();
    const mgr2 = new SessionManager(store, cfg, seen2.queryFn);
    const task2 = store.createTask({ projectPath: '/proj', prompt: 'p', origin: 'manual' });
    await mgr2.send(task2.id, 'go');
    expect(seen2.seen.cwd).toBe('/proj');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm --prefix server test -- sessionManager.cwd` → FAIL (`cwd` not accepted by createTask / not on options).

- [ ] **Step 3: Implement**

(a) `server/src/store.ts` — add `cwd` to `SessionRow`:

```typescript
  cwd?: string | null;
```

Change the `insertTask` prepared statement to include the `cwd` column:

```typescript
    insertTask: db.prepare(
      `INSERT INTO session (id, project_path, title, sdk_session_id, status, kind, prompt, origin, model, effort, disabled_tools, source_kind, source_id, cwd, created_at)
       VALUES (?, ?, ?, NULL, 'idle', 'task', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
```

Add `cwd?: string` to the `createTask` input type and pass it in the `.run(...)` call (insert it just before `created_at`):

```typescript
      input.sourceId ?? null,
      input.cwd ?? null,
      created_at,
    );
```

(b) `server/src/taskRunner.ts` — add `cwd?: string` to the `run(input: {...})` type and forward it into `this.store.createTask({ ...input, ... })` (the spread already carries `cwd`).

(c) `server/src/sessionManager.ts` — change the `cwd` line in the `options` object from `cwd: sess.project_path,` to:

```typescript
        cwd: sess.cwd || sess.project_path,
```

- [ ] **Step 4: Run to verify it passes** — `npm --prefix server test -- sessionManager.cwd` → PASS. Also run `npm --prefix server test` to confirm no regressions.

- [ ] **Step 5: Commit**

```bash
git add server/src/store.ts server/src/taskRunner.ts server/src/sessionManager.ts server/test/sessionManager.cwd.test.ts
git commit -m "feat(session): optional per-session cwd override for worktree isolation"
```

---

## PHASE 2 — MCP tool, git, runner

### Task 3: `goal_report` MCP tool

**Files:** Modify `server/src/deckTools.ts`, `server/src/sessionManager.ts`; Test `server/test/deckTools.goal.test.ts`

- [ ] **Step 1: Write the failing test** — Create `server/test/deckTools.goal.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { deckToolNames, goalReportHandler } from '../src/deckTools.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('goal_report tool', () => {
  it('exposes goal_report only when a goalId is present', () => {
    expect(deckToolNames(undefined, undefined)).not.toContain('goal_report');
    expect(deckToolNames(undefined, 'g1')).toContain('goal_report');
  });

  it('persists the report payload to the goal row', async () => {
    const g = store.createGoal({ projectPath: '/p', title: 'T', expectedOutput: 'x' });
    const res = await goalReportHandler(store, g.id, {
      summary: 'built it', goal_met: true, files_changed: ['a.ts'],
      commands_run: [{ cmd: 'npm test', exit_code: 0, output_tail: 'ok' }], incomplete: [],
    });
    expect(res.content[0].text).toMatch(/recorded/i);
    const report = JSON.parse(store.getGoal(g.id)!.report!);
    expect(report.goal_met).toBe(true);
    expect(report.files_changed).toEqual(['a.ts']);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm --prefix server test -- deckTools.goal` → FAIL (`goalReportHandler`/2-arg `deckToolNames` missing).

- [ ] **Step 3: Implement** — In `server/src/deckTools.ts`:

Add the handler (after `linkPrHandler`):

```typescript
export interface GoalReportArgs {
  summary: string;
  goal_met: boolean;
  files_changed: string[];
  commands_run: { cmd: string; exit_code: number; output_tail: string }[];
  incomplete: string[];
  notes?: string;
}

export async function goalReportHandler(
  store: Store, goalId: string, args: GoalReportArgs,
): Promise<ToolResult> {
  store.updateGoal(goalId, { report: JSON.stringify(args) });
  return { content: [{ type: 'text', text: `Report recorded for goal ${goalId}.` }] };
}
```

Widen `deckToolNames` to take a `goalId`:

```typescript
export function deckToolNames(ticketId?: string, goalId?: string): string[] {
  const names = ['create_ticket', 'list_tickets'];
  if (ticketId) names.push('link_pr');
  if (goalId) names.push('goal_report');
  return names;
}
```

Widen `buildDeckMcp` to accept a `goalId` and conditionally push the tool (mirror the `link_pr` block). Add the `goalId` param and, after the `if (ticketId) {...}` block:

```typescript
export function buildDeckMcp(store: Store, projectPath: string, ticketId?: string, goalId?: string) {
  // … existing tools + link_pr block unchanged …
  if (goalId) {
    tools.push(
      tool(
        'goal_report',
        'Record the FINAL structured outcome for the current goal. Call this exactly once when finished or blocked.',
        {
          summary: z.string().describe('What you built / attempted'),
          goal_met: z.boolean().describe('Your honest claim: does the result meet the goal?'),
          files_changed: z.array(z.string()).describe('Paths changed'),
          commands_run: z
            .array(z.object({ cmd: z.string(), exit_code: z.number(), output_tail: z.string() }))
            .describe('Commands/tests run with their results'),
          incomplete: z.array(z.string()).describe('Anything still not done'),
          notes: z.string().optional(),
        },
        async (args) => goalReportHandler(store, goalId, args as GoalReportArgs),
      ),
    );
  }
  return createSdkMcpServer({ name: 'deck', version: '1.0.0', instructions: '…unchanged…', tools });
}
```

In `server/src/sessionManager.ts`, pass the goalId into `buildDeckMcp`:

```typescript
        mcpServers: {
          deck: buildDeckMcp(
            this.store,
            sess.project_path,
            sess.source_kind === 'ticket' && sess.source_id ? sess.source_id : undefined,
            sess.source_kind === 'goal' && sess.source_id ? sess.source_id : undefined,
          ),
        },
```

- [ ] **Step 4: Run to verify it passes** — `npm --prefix server test -- deckTools` → PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add server/src/deckTools.ts server/src/sessionManager.ts server/test/deckTools.goal.test.ts
git commit -m "feat(mcp): goal_report tool (gated on goalId) for structured outcome capture"
```

---

### Task 4: git worktree helper

**Files:** Create `server/src/git.ts`, `server/test/git.test.ts`

- [ ] **Step 1: Write the failing test** — Create `server/test/git.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isGitRepo, addWorktree, removeWorktree } from '../src/git.ts';

let repo: string;
let wtBase: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-git-'));
  execFileSync('git', ['-C', repo, 'init', '-q']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t.t']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'T']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'hi');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  wtBase = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-wt-'));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wtBase, { recursive: true, force: true });
});

describe('git worktree helpers', () => {
  it('isGitRepo is true for a repo, false for a plain dir', () => {
    expect(isGitRepo(repo)).toBe(true);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'));
    expect(isGitRepo(plain)).toBe(false);
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('adds a worktree on a new branch, then removes it (branch persists)', () => {
    const wt = path.join(wtBase, 'g1');
    addWorktree(repo, wt, 'goal/g1');
    expect(fs.existsSync(path.join(wt, 'README.md'))).toBe(true);
    const branches = execFileSync('git', ['-C', repo, 'branch', '--list', 'goal/g1']).toString();
    expect(branches).toMatch(/goal\/g1/);
    removeWorktree(repo, wt);
    expect(fs.existsSync(wt)).toBe(false);
    // branch still exists after worktree removal
    expect(execFileSync('git', ['-C', repo, 'branch', '--list', 'goal/g1']).toString()).toMatch(/goal\/g1/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm --prefix server test -- git` → FAIL (module missing).

- [ ] **Step 3: Implement** — Create `server/src/git.ts`:

```typescript
import { execFileSync } from 'node:child_process';

/** True if `dir` is inside a git work tree. */
export function isGitRepo(dir: string): boolean {
  try {
    execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Create a worktree at `worktreePath` on a new branch `branch`, off the repo's HEAD. */
export function addWorktree(repo: string, worktreePath: string, branch: string): void {
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-b', branch, worktreePath, 'HEAD'], { stdio: 'ignore' });
}

/** Remove a worktree dir (keeps the branch). Force-removes even if dirty. */
export function removeWorktree(repo: string, worktreePath: string): void {
  execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktreePath], { stdio: 'ignore' });
}
```

- [ ] **Step 4: Run to verify it passes** — `npm --prefix server test -- git` → PASS (2).

- [ ] **Step 5: Commit**

```bash
git add server/src/git.ts server/test/git.test.ts
git commit -m "feat(git): worktree add/remove + isGitRepo helpers"
```

---

### Task 5: `goalRunner` (SinglePassExecutor) + lifecycle automation

**Files:** Create `server/src/goalRunner.ts`, `server/test/goalRunner.test.ts`

- [ ] **Step 1: Write the failing test** — Create `server/test/goalRunner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.ts';
import { SinglePassExecutor, registerGoalAutomation } from '../src/goalRunner.ts';

let repo: string, wtBase: string, store: Store, manager: any, runs: any[];

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-goalrun-'));
  execFileSync('git', ['-C', repo, 'init', '-q']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t.t']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'T']);
  fs.writeFileSync(path.join(repo, 'r.txt'), 'x');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  wtBase = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-goalwt-'));
  store = new Store(':memory:');
  runs = [];
  // Fake taskRunner: records the run input, returns a fake session id, creates the task row.
  const taskRunner = {
    run: (input: any) => {
      runs.push(input);
      const t = store.createTask({ projectPath: input.projectPath, prompt: input.prompt, origin: input.origin, sourceKind: input.sourceKind, sourceId: input.sourceId, cwd: input.cwd });
      return t.id;
    },
  };
  manager = new EventEmitter();
  (globalThis as any).__exec = { store, taskRunner };
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wtBase, { recursive: true, force: true });
});

describe('SinglePassExecutor', () => {
  it('fails a non-git project', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'));
    const g = store.createGoal({ projectPath: plain, title: 'T', expectedOutput: 'x' });
    const exec = new SinglePassExecutor(store, (globalThis as any).__exec.taskRunner, wtBase);
    exec.start(g.id);
    expect(store.getGoal(g.id)!.status).toBe('failed');
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('creates a worktree + branch, launches a run, sets building', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'do x', acceptance: 'x' });
    const exec = new SinglePassExecutor(store, (globalThis as any).__exec.taskRunner, wtBase);
    exec.start(g.id);
    const got = store.getGoal(g.id)!;
    expect(got.status).toBe('building');
    expect(got.branch).toBe(`goal/${g.id}`);
    expect(got.session_id).toBeTruthy();
    expect(fs.existsSync(got.worktree_path!)).toBe(true);
    // the run used the worktree as cwd and origin 'goal'
    expect(runs[0].cwd).toBe(got.worktree_path);
    expect(runs[0].origin).toBe('goal');
    expect(runs[0].prompt).toMatch(/do x/);
  });
});

describe('registerGoalAutomation', () => {
  it('on success+report → review and removes the worktree', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x' });
    const exec = new SinglePassExecutor(store, (globalThis as any).__exec.taskRunner, wtBase);
    registerGoalAutomation(manager, store);
    exec.start(g.id);
    const wt = store.getGoal(g.id)!.worktree_path!;
    store.updateGoal(g.id, { report: JSON.stringify({ summary: 's', goal_met: true }) });
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal', source_id: g.id, status: 'idle', result: 'success' });
    expect(store.getGoal(g.id)!.status).toBe('review');
    expect(fs.existsSync(wt)).toBe(false);
  });

  it('on terminal without a report → failed', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x' });
    const exec = new SinglePassExecutor(store, (globalThis as any).__exec.taskRunner, wtBase);
    registerGoalAutomation(manager, store);
    exec.start(g.id);
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal', source_id: g.id, status: 'errored', result: 'error' });
    expect(store.getGoal(g.id)!.status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm --prefix server test -- goalRunner` → FAIL (module missing).

- [ ] **Step 3: Implement** — Create `server/src/goalRunner.ts`:

```typescript
import path from 'node:path';
import type { Store } from './store.ts';
import type { TaskRunner } from './taskRunner.ts';
import type { SessionManager } from './sessionManager.ts';
import { isGitRepo, addWorktree, removeWorktree } from './git.ts';

export interface GoalExecutor {
  start(goalId: string): void;
}

function goalPrompt(expected: string, acceptance: string | null): string {
  return [
    'You are running a production-grade build to achieve the goal below. You are already on an isolated git worktree on branch `goal/<id>` — work here and commit your changes on this branch. Do NOT merge.',
    '',
    `Goal (expected output): ${expected}`,
    `Acceptance criteria: ${acceptance && acceptance.trim() ? acceptance : 'none stated'}`,
    '',
    'Plan first, then implement in focused changes, then run the project\'s tests and confirm they pass. Use your available skills and subagents as appropriate. When finished — or if blocked — call the `goal_report` tool with an honest structured outcome: summarize what you built, list files changed and the commands/tests you ran with their results, and list anything still incomplete. Report incomplete items truthfully rather than claiming false success.',
  ].join('\n');
}

/** Slice-1 executor: one agent pass in a per-goal git worktree. */
export class SinglePassExecutor implements GoalExecutor {
  constructor(
    private store: Store,
    private runner: Pick<TaskRunner, 'run'>,
    private worktreesDir: string,
    private goalMaxTurns = 150,
  ) {}

  start(goalId: string): void {
    const g = this.store.getGoal(goalId);
    if (!g) return;
    if (!isGitRepo(g.project_path)) {
      this.store.updateGoal(goalId, { status: 'failed', report: JSON.stringify({ error: 'project is not a git repository' }) });
      return;
    }
    const branch = `goal/${goalId}`;
    const worktreePath = path.join(this.worktreesDir, goalId);
    try {
      addWorktree(g.project_path, worktreePath, branch);
    } catch (e) {
      this.store.updateGoal(goalId, { status: 'failed', report: JSON.stringify({ error: `worktree setup failed: ${e instanceof Error ? e.message : e}` }) });
      return;
    }
    this.store.updateGoal(goalId, { status: 'building', branch, worktree_path: worktreePath });
    const sessionId = this.runner.run({
      projectPath: g.project_path,
      cwd: worktreePath,
      prompt: goalPrompt(g.expected_output, g.acceptance),
      origin: 'goal',
      title: g.title,
      sourceKind: 'goal',
      sourceId: goalId,
      model: undefined,
      effort: undefined,
    });
    this.store.updateGoal(goalId, { session_id: sessionId });
  }
}

/** Drive goal status from task lifecycle frames + clean up the worktree. */
export function registerGoalAutomation(manager: SessionManager, store: Store): void {
  manager.on('task', (frame: { id: string; source_kind: string | null; source_id: string | null; status: string; result: string | null }) => {
    try {
      if (frame.source_kind !== 'goal' || !frame.source_id) return;
      const g = store.getGoal(frame.source_id);
      if (!g) return;
      if (frame.status === 'active') return; // building already set by the executor
      // terminal frame
      let status: 'review' | 'failed' | 'cancelled';
      if (frame.result === 'cancelled') status = 'cancelled';
      else if (frame.result === 'success' && g.report) status = 'review';
      else status = 'failed';
      store.updateGoal(g.id, { status });
      if (g.worktree_path) {
        try { removeWorktree(g.project_path, g.worktree_path); } catch { /* best-effort */ }
        store.updateGoal(g.id, { worktree_path: null });
      }
    } catch (err) {
      console.error('[goalAutomation] frame handling failed:', err instanceof Error ? err.message : err);
    }
  });
}
```

- [ ] **Step 4: Run to verify it passes** — `npm --prefix server test -- goalRunner` → PASS (4).

- [ ] **Step 5: Commit**

```bash
git add server/src/goalRunner.ts server/test/goalRunner.test.ts
git commit -m "feat(goals): SinglePassExecutor (worktree pass) + goal lifecycle automation"
```

---

## PHASE 3 — Routes + config + wiring

### Task 6: `config.goalMaxTurns`

**Files:** Modify `server/src/config.ts`; Test `server/test/config.test.ts` (append)

- [ ] **Step 1: Write the failing test** — Append to `server/test/config.test.ts`:

```typescript
describe('goalMaxTurns', () => {
  it('defaults to 150 and reads DECK_GOAL_MAX_TURNS', () => {
    const base = { DECK_TOKEN: 'a-long-test-token-value-1234', ANTHROPIC_API_KEY: 'k' };
    expect(loadConfig({ ...base } as any).goalMaxTurns).toBe(150);
    expect(loadConfig({ ...base, DECK_GOAL_MAX_TURNS: '50' } as any).goalMaxTurns).toBe(50);
  });
});
```

(If `loadConfig` isn't imported in this file, add `import { loadConfig } from '../src/config.ts';`.)

- [ ] **Step 2: Run to verify it fails** — `npm --prefix server test -- config` → FAIL (`goalMaxTurns` undefined).

- [ ] **Step 3: Implement** — In `server/src/config.ts`, add to the `Config` interface:

```typescript
  /** Turn ceiling for a goal pass (DECK_GOAL_MAX_TURNS, default 150). A goal does
   *  more than a task, so it gets a higher cap than the task default of 40. */
  goalMaxTurns?: number;
```

and in the returned object in `loadConfig`:

```typescript
    goalMaxTurns:
      env.DECK_GOAL_MAX_TURNS && Number.isFinite(Number(env.DECK_GOAL_MAX_TURNS))
        ? Math.max(1, Number(env.DECK_GOAL_MAX_TURNS))
        : 150,
```

- [ ] **Step 4: Run to verify it passes** — `npm --prefix server test -- config` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/test/config.test.ts
git commit -m "feat(config): goalMaxTurns (default 150)"
```

---

### Task 7: goal REST endpoints

**Files:** Modify `server/src/routes.ts`; Test `server/test/routes.goals.test.ts`

> The runner needs wiring (Task 9). For routes to call it, add an optional `goalExecutor` to `RouteDeps`. Tests pass a stub executor.

- [ ] **Step 1: Write the failing test** — Create `server/test/routes.goals.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.ts';
import { TaskRunner } from '../src/taskRunner.ts';
import { Scheduler } from '../src/scheduler.ts';
import { registerRoutes } from '../src/routes.ts';

let root: string, app: ReturnType<typeof Fastify>, store: Store, startSpy: ReturnType<typeof vi.fn>, cancelSpy: ReturnType<typeof vi.fn>;
const TOKEN = 'goal-routes-token-3456';

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-goals-'));
  fs.mkdirSync(path.join(root, 'alpha'));
  store = new Store(':memory:');
  const taskRunner = new TaskRunner(store, { send: async () => {}, emit: () => true } as any);
  const scheduler = new Scheduler(store, taskRunner);
  startSpy = vi.fn((goalId: string) => store.updateGoal(goalId, { status: 'building', session_id: 's1' }));
  cancelSpy = vi.fn(() => true);
  app = Fastify();
  await app.register(cookie);
  registerRoutes(app, {
    store,
    config: { token: TOKEN, projectsRoot: root, port: 1, model: 'claude-opus-4-8' },
    taskRunner, scheduler,
    manager: { cancel: cancelSpy, isActive: () => false, discard: vi.fn() } as any,
    goalExecutor: { start: startSpy } as any,
  });
  await app.ready();
});
afterEach(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
async function login() { const r = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } }); return r.headers['set-cookie'] as string; }
async function create(c: string) {
  const r = await app.inject({ method: 'POST', url: '/api/goals', headers: { cookie: c }, payload: { project: 'alpha', title: 'T', expected_output: 'do x', acceptance: 'x' } });
  return r;
}

describe('goal routes', () => {
  it('POST /api/goals creates a queued goal; 400 on missing fields', async () => {
    const c = await login();
    const r = await create(c);
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('queued');
    const bad = await app.inject({ method: 'POST', url: '/api/goals', headers: { cookie: c }, payload: { project: 'alpha' } });
    expect(bad.statusCode).toBe(400);
  });

  it('GET /api/goals lists; GET /api/goals/:id returns goal + events', async () => {
    const c = await login();
    const id = (await create(c)).json().id;
    expect((await app.inject({ method: 'GET', url: '/api/goals', headers: { cookie: c } })).json().length).toBeGreaterThanOrEqual(1);
    const detail = await app.inject({ method: 'GET', url: `/api/goals/${id}`, headers: { cookie: c } });
    expect(detail.statusCode).toBe(200);
    expect(Array.isArray(detail.json().events)).toBe(true);
  });

  it('POST /api/goals/:id/run invokes the executor; 404 unknown', async () => {
    const c = await login();
    const id = (await create(c)).json().id;
    const run = await app.inject({ method: 'POST', url: `/api/goals/${id}/run`, headers: { cookie: c } });
    expect(run.statusCode).toBe(200);
    expect(startSpy).toHaveBeenCalledWith(id);
    expect((await app.inject({ method: 'POST', url: '/api/goals/nope/run', headers: { cookie: c } })).statusCode).toBe(404);
  });

  it('POST /api/goals/:id/cancel cancels the session; DELETE guards building', async () => {
    const c = await login();
    const id = (await create(c)).json().id;
    await app.inject({ method: 'POST', url: `/api/goals/${id}/run`, headers: { cookie: c } }); // sets building + session_id via startSpy
    const cancel = await app.inject({ method: 'POST', url: `/api/goals/${id}/cancel`, headers: { cookie: c } });
    expect(cancel.statusCode).toBe(200);
    expect(cancelSpy).toHaveBeenCalledWith('s1');
    // delete while building → 409
    store.updateGoal(id, { status: 'building' });
    expect((await app.inject({ method: 'DELETE', url: `/api/goals/${id}`, headers: { cookie: c } })).statusCode).toBe(409);
    // delete when not building → 204
    store.updateGoal(id, { status: 'review' });
    expect((await app.inject({ method: 'DELETE', url: `/api/goals/${id}`, headers: { cookie: c } })).statusCode).toBe(204);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm --prefix server test -- routes.goals` → FAIL (no goal routes).

- [ ] **Step 3: Implement** — In `server/src/routes.ts`:

(a) Add `goalExecutor` to `RouteDeps`:

```typescript
  /** Optional: starts a goal pass. Present in production wiring; stubbed in tests. */
  goalExecutor?: { start: (goalId: string) => void };
```

(b) Destructure it in `registerRoutes`:

```typescript
  const { store, config, taskRunner, scheduler, manager, closeRoom, goalExecutor } = deps;
```

(c) After the tickets block, add the goals block:

```typescript
  // goals
  app.get('/api/goals', async () => store.listGoals());
  app.post<{ Body: { title?: string; expected_output?: string; acceptance?: string; project?: string } }>(
    '/api/goals',
    async (req, reply) => {
      const { title, expected_output, acceptance, project } = req.body ?? {};
      if (!title || !expected_output || !project) {
        return reply.code(400).send({ error: 'title, expected_output and project required' });
      }
      let projectPath: string;
      try {
        projectPath = resolveProjectPath(projectsRoots, project);
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'invalid project' });
      }
      return store.createGoal({ projectPath, title, expectedOutput: expected_output, acceptance });
    },
  );
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/goals/:id', async (req, reply) => {
    const g = store.getGoal(req.params.id);
    if (!g) return reply.code(404).send({ error: 'not found' });
    const events = g.session_id ? eventsForRequest(g.session_id, req.query?.limit) : [];
    return { ...g, events };
  });
  app.post<{ Params: { id: string } }>('/api/goals/:id/run', async (req, reply) => {
    const g = store.getGoal(req.params.id);
    if (!g) return reply.code(404).send({ error: 'not found' });
    if (g.status === 'building') return reply.code(409).send({ error: 'goal is already building' });
    goalExecutor?.start(g.id);
    return store.getGoal(g.id);
  });
  app.post<{ Params: { id: string } }>('/api/goals/:id/cancel', async (req, reply) => {
    const g = store.getGoal(req.params.id);
    if (!g) return reply.code(404).send({ error: 'not found' });
    if (g.session_id) manager?.cancel(g.session_id);
    return { cancelled: true };
  });
  app.delete<{ Params: { id: string } }>('/api/goals/:id', async (req, reply) => {
    const g = store.getGoal(req.params.id);
    if (!g) return reply.code(404).send({ error: 'not found' });
    if (g.status === 'building') return reply.code(409).send({ error: 'cancel the goal before deleting it' });
    store.deleteGoal(g.id);
    return reply.code(204).send();
  });
```

- [ ] **Step 4: Run to verify it passes** — `npm --prefix server test -- routes.goals` → PASS (4).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes.ts server/test/routes.goals.test.ts
git commit -m "feat(api): goal REST endpoints (list/create/detail/run/cancel/delete)"
```

---

### Task 8: wire `goalRunner` + automation + worktrees dir in `server.ts`

**Files:** Modify `server/src/server.ts`

> No new unit test (bootstrap wiring); verified by the full server suite staying green + the manual smoke in Task 13.

- [ ] **Step 1: Implement** — In `server/src/server.ts`, in `main()`:

Add imports at the top of the file:

```typescript
import path from 'node:path';
import { SinglePassExecutor, registerGoalAutomation } from './goalRunner.ts';
```

In `main()`, after `registerTicketAutomation(manager, store);` and the `taskRunner` construction, add:

```typescript
  const dbPath = process.env.DECK_DB || 'claude-deck.sqlite';
  const worktreesDir = process.env.DECK_GOALS_DIR || path.join(path.dirname(path.resolve(dbPath)), 'deck-goal-worktrees');
  const goalExecutor = new SinglePassExecutor(store, taskRunner, worktreesDir, config.goalMaxTurns ?? 150);
  registerGoalAutomation(manager, store);
```

Pass `goalExecutor` into `registerRoutes(app, { … })` (add the field to the existing deps object):

```typescript
    goalExecutor,
```

- [ ] **Step 2: Verify** — `npm --prefix server test` → all green (no regressions). Build the server if there's a build step (`npm --prefix server run build` if present) or rely on `tsc` via the test run.

- [ ] **Step 3: Commit**

```bash
git add server/src/server.ts
git commit -m "feat(goals): wire SinglePassExecutor + goal automation + worktrees dir"
```

---

## PHASE 4 — Client api + hooks + status vocab

### Task 9: client api methods + types + hooks

**Files:** Modify `web/src/lib/api.ts`, `web/src/lib/types.ts`, `web/src/hooks/use-automation-data.ts`, `web/src/lib/api.tickets-tasks-cron.test.ts`

- [ ] **Step 1: Add failing api tests** — Append to `web/src/lib/api.tickets-tasks-cron.test.ts`:

```typescript
  it("createGoal() POSTs the goal fields", async () => {
    const f = mockFetch(200, { id: "g1", status: "queued" });
    vi.stubGlobal("fetch", f);
    await api.createGoal({ project: "deck", title: "T", expected_output: "x", acceptance: "y" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/goals");
    expect(JSON.parse(init.body)).toEqual({ project: "deck", title: "T", expected_output: "x", acceptance: "y" });
  });

  it("runGoal() POSTs to the run subroute; goals() GETs the list", async () => {
    const f = mockFetch(200, { id: "g1", status: "building" });
    vi.stubGlobal("fetch", f);
    await api.runGoal("g1");
    expect(f.mock.calls[0][0]).toBe("/api/goals/g1/run");
    const f2 = mockFetch(200, [{ id: "g1" }]);
    vi.stubGlobal("fetch", f2);
    expect(await api.goals()).toEqual([{ id: "g1" }]);
  });

  it("cancelGoal() POSTs cancel; deleteGoal() DELETEs", async () => {
    const f = mockFetch(200, { cancelled: true });
    vi.stubGlobal("fetch", f);
    await api.cancelGoal("g1");
    expect(f.mock.calls[0][0]).toBe("/api/goals/g1/cancel");
    const f2 = mockFetch(204, undefined);
    vi.stubGlobal("fetch", f2);
    await api.deleteGoal("g1");
    expect(f2.mock.calls[0][1].method).toBe("DELETE");
  });
```

- [ ] **Step 2: Run to verify it fails** — `cd web && bun run test api.tickets-tasks-cron` → FAIL (goal methods missing).

- [ ] **Step 3: Implement types + api + hooks**

(a) `web/src/lib/types.ts` — add:

```typescript
export interface GoalReport {
  summary: string;
  goal_met: boolean;
  files_changed: string[];
  commands_run: { cmd: string; exit_code: number; output_tail: string }[];
  incomplete: string[];
  notes?: string;
  error?: string;
}

export interface Goal {
  id: string;
  project_path: string;
  title: string;
  expected_output: string;
  acceptance: string | null;
  status: "queued" | "building" | "review" | "failed" | "cancelled";
  branch: string | null;
  worktree_path: string | null;
  session_id: string | null;
  report: string | null; // JSON string of GoalReport
  created_at: number;
}

export interface GoalDetail extends Goal {
  events: DeckMessage[];
}
```

(b) `web/src/lib/api.ts` — add `Goal, GoalDetail` to the type import, and add these methods to the `api` object (after the tickets block):

```typescript
  // ---- goals ----
  async goals(): Promise<Goal[]> {
    return json(await fetch("/api/goals", { credentials: "same-origin" }));
  },
  async goal(id: string): Promise<GoalDetail> {
    return json(await fetch(`/api/goals/${id}`, { credentials: "same-origin" }));
  },
  async createGoal(body: { project: string; title: string; expected_output: string; acceptance?: string }): Promise<Goal> {
    return json(
      await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      }),
    );
  },
  async runGoal(id: string): Promise<Goal> {
    return json(await fetch(`/api/goals/${id}/run`, { method: "POST", credentials: "same-origin" }));
  },
  async cancelGoal(id: string): Promise<{ cancelled: boolean }> {
    return json(await fetch(`/api/goals/${id}/cancel`, { method: "POST", credentials: "same-origin" }));
  },
  async deleteGoal(id: string): Promise<void> {
    const res = await fetch(`/api/goals/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
      throw new ApiError(res.status, msg);
    }
  },
```

(c) `web/src/hooks/use-automation-data.ts` — add:

```typescript
export function useGoals() {
  return useQuery({ queryKey: ["goals"], queryFn: () => api.goals() });
}

export function useGoal(id: string | null) {
  return useQuery({
    queryKey: ["goals", id],
    queryFn: () => (id ? api.goal(id) : Promise.resolve(null)),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "building" ? 3000 : false),
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { project: string; title: string; expected_output: string; acceptance?: string }) => api.createGoal(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useRunGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.runGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useCancelGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}
```

- [ ] **Step 4: Run to verify it passes** — `cd web && bun run test api.tickets-tasks-cron` → PASS; `cd web && bun run typecheck` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/types.ts web/src/hooks/use-automation-data.ts web/src/lib/api.tickets-tasks-cron.test.ts
git commit -m "feat(web/api): goal api methods, types, and hooks"
```

---

### Task 10: goal status vocab in `automation.ts`

**Files:** Modify `web/src/lib/automation.ts`; Test `web/src/lib/automation.test.ts` (append)

- [ ] **Step 1: Add failing test** — Append to `web/src/lib/automation.test.ts`:

```typescript
import { goalStatus } from "./automation";

describe("goalStatus", () => {
  it("maps goal statuses to automation statuses", () => {
    expect(goalStatus("queued")).toBe("open");
    expect(goalStatus("building")).toBe("running");
    expect(goalStatus("review")).toBe("review");
    expect(goalStatus("failed")).toBe("failed");
    expect(goalStatus("cancelled")).toBe("closed");
  });
});
```

(If `describe`/`it`/`expect` are already imported at the top of the file, don't re-import.)

- [ ] **Step 2: Run to verify it fails** — `cd web && bun run test automation` → FAIL (`goalStatus` missing).

- [ ] **Step 3: Implement** — In `web/src/lib/automation.ts`, add (reusing the existing `AutomationStatus` union, which already has open/running/review/failed/closed):

```typescript
/** Map a goal's status onto the shared automation status vocabulary for chips/dots. */
export function goalStatus(s: string): AutomationStatus {
  switch (s) {
    case "building": return "running";
    case "review": return "review";
    case "failed": return "failed";
    case "cancelled": return "closed";
    default: return "open"; // queued
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `cd web && bun run test automation` → PASS; `cd web && bun run typecheck` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/automation.ts web/src/lib/automation.test.ts
git commit -m "feat(web): goalStatus mapping to the shared automation status vocab"
```

---

## PHASE 5 — Goals UI

### Task 11: goal form + list + report + detail components

**Files:** Create `web/src/components/deck/goal-form.tsx`, `goals-list.tsx`, `goal-report.tsx`, `goal-detail.tsx`

- [ ] **Step 1: Create `goal-form.tsx`** (mirrors `ticket-form.tsx`, create-only):

```typescript
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateGoal } from "@/hooks/use-automation-data";
import { ApiError } from "@/lib/api";

export function GoalForm({ projectName, onDone }: { projectName: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [expected, setExpected] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateGoal();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({ project: projectName, title, expected_output: expected, acceptance: acceptance || undefined });
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "failed to create goal");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <input
        autoFocus
        className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Goal title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        className="min-h-24 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Expected output — what 'done' looks like"
        value={expected}
        onChange={(e) => setExpected(e.target.value)}
        required
      />
      <textarea
        className="min-h-16 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Acceptance criteria (optional)"
        value={acceptance}
        onChange={(e) => setAcceptance(e.target.value)}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!title || !expected || create.isPending}>
          {create.isPending ? "Creating…" : "Create goal"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Create `goals-list.tsx`** (mirrors `tickets-list.tsx`, no tabs):

```typescript
import { cn } from "@/lib/utils";
import { StatusChip, StatusDot } from "./status-chip";
import { goalStatus, relativeTime } from "@/lib/automation";
import type { Goal } from "@/lib/types";

export function GoalsList({
  goals, selectedId, onSelect,
}: { goals: Goal[]; selectedId: string | null; onSelect: (g: Goal) => void }) {
  if (goals.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No goals.</p>;
  }
  return (
    <div className="p-2">
      {goals.map((g) => {
        const status = goalStatus(g.status);
        return (
          <button
            key={g.id}
            onClick={() => onSelect(g)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border border-transparent px-3.5 py-3 text-left",
              selectedId === g.id ? "border-border bg-card" : "hover:border-border hover:bg-card",
            )}
          >
            <StatusDot status={status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{g.title}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{relativeTime(g.created_at)}</span>
            </span>
            <StatusChip status={status} />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Create `goal-report.tsx`** (renders the structured report):

```typescript
import type { GoalReport } from "@/lib/types";

export function GoalReportView({ report }: { report: GoalReport }) {
  if (report.error) {
    return <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{report.error}</p>;
  }
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div>
        <span className={report.goal_met ? "text-primary" : "text-muted-foreground"}>
          {report.goal_met ? "✓ goal_met (agent claim — unverified)" : "✗ not met (agent claim)"}
        </span>
      </div>
      <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{report.summary}</p>
      {report.files_changed?.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Files changed</div>
          <ul className="list-inside list-disc font-mono text-[11px] text-foreground">
            {report.files_changed.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      )}
      {report.commands_run?.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Commands</div>
          {report.commands_run.map((c, i) => (
            <div key={i} className="mb-1 rounded border border-border p-2">
              <div className="font-mono text-[11px] text-foreground">
                <span className={c.exit_code === 0 ? "text-primary" : "text-destructive"}>[{c.exit_code}]</span> {c.cmd}
              </div>
              {c.output_tail && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{c.output_tail}</pre>}
            </div>
          ))}
        </div>
      )}
      {report.incomplete?.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Incomplete</div>
          <ul className="list-inside list-disc text-[11px] text-foreground">
            {report.incomplete.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `goal-detail.tsx`** (mirrors `ticket-detail.tsx`; live output + report + actions):

```typescript
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "./status-chip";
import { TaskOutput } from "./task-output";
import { GoalReportView } from "./goal-report";
import { useCancelGoal, useDeleteGoal, useRunGoal } from "@/hooks/use-automation-data";
import { goalStatus, relativeTime } from "@/lib/automation";
import { ApiError } from "@/lib/api";
import type { Goal, GoalReport } from "@/lib/types";

export function GoalDetail({ goal, onDeleted }: { goal: Goal; onDeleted?: () => void }) {
  const run = useRunGoal();
  const cancel = useCancelGoal();
  const del = useDeleteGoal();
  const status = goalStatus(goal.status);
  const building = goal.status === "building";
  const report: GoalReport | null = goal.report ? JSON.parse(goal.report) : null;

  const onDelete = () => {
    if (!window.confirm(`Delete goal "${goal.title}"? This cannot be undone.`)) return;
    del.mutate(goal.id, {
      onSuccess: () => onDeleted?.(),
      onError: (e) => toast.error(e instanceof ApiError && e.status === 409 ? "Cancel the goal before deleting it" : "Couldn't delete"),
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <div className="mb-2"><StatusChip status={status} /></div>
        <h2 className="text-sm font-bold leading-snug">{goal.title}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 text-xs text-muted-foreground">
        <p className="mb-3 whitespace-pre-wrap leading-relaxed">{goal.expected_output}</p>
        {goal.branch && <div className="mb-3 font-mono text-[11px]">branch: <span className="text-foreground">{goal.branch}</span></div>}
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">created</div>
        <div className="mb-3 text-[11px]">{relativeTime(goal.created_at)}</div>
        {report && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Report</div>
            <GoalReportView report={report} />
          </div>
        )}
        {goal.session_id && (
          <div className="mt-2 h-64 overflow-hidden rounded-md border border-border">
            <TaskOutput taskId={goal.session_id} />
          </div>
        )}
      </div>
      <div className="flex gap-2 border-t border-border p-4">
        {building ? (
          <Button className="flex-1" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(goal.id)}>
            Cancel
          </Button>
        ) : (
          <Button className="flex-1" disabled={run.isPending} onClick={() => run.mutate(goal.id)}>
            {run.isPending ? "Starting…" : goal.status === "queued" ? "▶ Run" : "▶ Run again"}
          </Button>
        )}
        <Button
          variant="ghost" size="icon" aria-label="Delete goal" title="Delete goal"
          disabled={del.isPending || building} onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + commit**

Run: `cd web && bun run typecheck` → 0 errors.

```bash
git add web/src/components/deck/goal-form.tsx web/src/components/deck/goals-list.tsx web/src/components/deck/goal-report.tsx web/src/components/deck/goal-detail.tsx
git commit -m "feat(web/goals): goal form, list, report view, and detail components"
```

---

### Task 12: `goals.tsx` route + sidebar nav link

**Files:** Create `web/src/routes/goals.tsx`; Modify `web/src/components/deck/sidebar-projects.tsx`

- [ ] **Step 1: Create the route** — `web/src/routes/goals.tsx` (mirrors `tickets.tsx`; uses the live `useGoal` for the selected detail so the report/stream refresh while building):

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AutomationPage, NoProject } from "@/components/deck/automation-page";
import { GoalsList } from "@/components/deck/goals-list";
import { GoalDetail } from "@/components/deck/goal-detail";
import { GoalForm } from "@/components/deck/goal-form";
import { AsyncBoundary, useAuthRedirect } from "@/components/deck/async-boundary";
import { useGoal, useGoals } from "@/hooks/use-automation-data";
import { useProjects, useSessions } from "@/hooks/use-deck-data";
import { byProjectPath, projectNameForPath } from "@/lib/automation";

export const Route = createFileRoute("/goals")({
  validateSearch: (s: Record<string, unknown>) => ({ project: String(s.project ?? "") }),
  component: GoalsRoute,
});

function GoalsRoute() {
  const { project } = Route.useSearch();
  const projects = useProjects();
  const sessions = useSessions();
  const goalsQ = useGoals();
  const { data } = goalsQ;
  useAuthRedirect(goalsQ.error, projects.error, sessions.error);
  const [selId, setSelId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const name = projects.data ? projectNameForPath(projects.data, project) : null;
  const rows = useMemo(() => byProjectPath(data ?? [], project), [data, project]);
  const selectedLive = useGoal(selId);
  const selected = selectedLive.data ?? rows.find((g) => g.id === selId) ?? null;

  const projectThreadId = useMemo(() => {
    const chats = (sessions.data ?? []).filter(
      (s) => s.project_path === project && (s.kind ?? "chat") === "chat",
    );
    if (!chats.length) return undefined;
    return chats.reduce((a, b) => (b.created_at > a.created_at ? b : a)).id;
  }, [sessions.data, project]);

  if (!project) return <NoProject />;

  return (
    <AutomationPage
      projectName={name ?? project}
      projectThreadId={projectThreadId}
      section="Goals"
      actions={
        <Button disabled={!name} onClick={() => setCreating(true)}>+ New goal</Button>
      }
      list={
        creating && name ? (
          <GoalForm projectName={name} onDone={() => setCreating(false)} />
        ) : (
          <AsyncBoundary query={goalsQ} label="goals">
            <GoalsList goals={rows} selectedId={selId} onSelect={(g) => setSelId(g.id)} />
          </AsyncBoundary>
        )
      }
      detail={selected ? <GoalDetail goal={selected} onDeleted={() => setSelId(null)} /> : undefined}
      onCloseDetail={() => setSelId(null)}
    />
  );
}
```

- [ ] **Step 2: Add the sidebar nav link** — In `web/src/components/deck/sidebar-projects.tsx`, after the Cron `<Link>` block (the one with `to="/cron"`), add (pick an icon already imported, e.g. `Target` from lucide — add it to the lucide import if absent):

```typescript
                  <Link
                    to="/goals"
                    search={{ project: p.path }}
                    onClick={onNavigate}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&.active]:bg-sidebar-accent [&.active]:text-primary"
                  >
                    <Target className="size-3.5" /> Goals
                  </Link>
```

(If `Target` isn't imported, add it to the existing `lucide-react` import in that file.)

- [ ] **Step 3: Typecheck** — `cd web && bun run typecheck` → 0 errors. (TanStack Router regenerates `routeTree.gen.ts` for `/goals` on the next dev/build; if typecheck complains the route isn't in the tree, run `cd web && bun run build` once to regenerate it, or start the dev server.)

- [ ] **Step 4: Commit**

```bash
git add web/src/routes/goals.tsx web/src/components/deck/sidebar-projects.tsx web/src/routeTree.gen.ts
git commit -m "feat(web/goals): Goals route + sidebar nav link"
```

---

## PHASE 6 — Verification

### Task 13: full verification + live smoke

**Files:** none (verification only)

- [ ] **Step 1: Full server suite** — `npm --prefix server test` → all green (incl. `store.goal`, `sessionManager.cwd`, `deckTools.goal`, `git`, `goalRunner`, `config`, `routes.goals`).
- [ ] **Step 2: Full web suite** — `cd web && bun run test` → all green.
- [ ] **Step 3: Web typecheck** — `cd web && bun run typecheck` → 0 errors.
- [ ] **Step 4: Live smoke** (real agent spend — only with the user's go-ahead). Start the stack (`proc-compose up`) against a **git** project. In the Goals section: create a small goal (e.g. "add a hello() function with a passing test") → Run → watch the live stream → confirm the worktree appears under the deck data dir and a `goal/<id>` branch is created → on completion the report renders and status is `review` → `git -C <project> branch` shows `goal/<id>` and the worktree dir is gone → Cancel a fresh run mid-flight → Delete a finished goal. Also create a goal on a **non-git** project and confirm it lands `failed` with the clear message.
- [ ] **Step 5: Commit** (only if smoke required fixes)

```bash
git add -A
git commit -m "test: verification fixes for goal-driven foundation"
```

---

## Self-Review (completed by plan author)

**Spec coverage** — every Slice-1 spec item maps to a task: goal model + lifecycle (T1), `cwd` override (T2), `goal_report` tool (T3), worktree isolation (T4 helper, T5 runner), single-pass executor behind interface + lifecycle watcher (T5), `goalMaxTurns` (T6), REST endpoints incl. delete-while-building 409 (T7), wiring + worktrees dir (T8), client api/types/hooks (T9), status vocab (T10), UI form/list/report/detail + route + nav (T11–T12), testing + smoke incl. non-git failure (T13). Out-of-scope items (verification gate, loop/budget, multi-dim QA, auto-merge) are absent — correct.

**Type/name consistency** — `GoalRow`/`Goal`/`GoalDetail`/`GoalReport` fields agree across store, api, types, components; `createGoal({ projectPath, title, expectedOutput, acceptance })` vs the REST body field `expected_output` is mapped explicitly in the POST handler (T7) and `api.createGoal` (T9); `SinglePassExecutor`/`registerGoalAutomation` names match between T5, T7 (stub), and T8 wiring; `goalStatus`/`goalReportHandler`/`deckToolNames(ticketId, goalId)`/`buildDeckMcp(store, projectPath, ticketId?, goalId?)` consistent across tasks; `cwd` threads store→taskRunner→sessionManager (T2). `manager.cancel(session_id)` matches the existing `SessionManager.cancel`.

**Known confirm-at-implementation point:** the sidebar lucide icon import (`Target`) — verify it's imported in `sidebar-projects.tsx` and add it if not (T12). Everything else is pinned to verified patterns.
