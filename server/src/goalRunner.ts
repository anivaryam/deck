import path from 'node:path';
import type { Store } from './store.ts';
import type { SessionManager } from './sessionManager.ts';
import { isGitRepo, addWorktree, removeWorktree, resetWorktree } from './git.ts';

export interface GoalExecutor {
  start(goalId: string): void;
}

/** Minimal interface the executor needs from any task runner. */
interface RunnerLike {
  run(input: {
    projectPath: string;
    cwd: string;
    prompt: string;
    origin: 'goal';
    title?: string | null;
    sourceKind: 'goal';
    sourceId: string;
  }): string;
}

function goalPrompt(goalId: string, expected: string, acceptance: string | null): string {
  return [
    `You are running a production-grade build to achieve the goal below. You are already on an isolated git worktree on branch \`goal/${goalId}\` — work here and commit your changes on this branch. Do NOT merge.`,
    '',
    `Goal (expected output): ${expected}`,
    `Acceptance criteria: ${acceptance && acceptance.trim() ? acceptance : 'none stated'}`,
    '',
    "Plan first, then implement in focused changes, then run the project's tests and confirm they pass. Use your available skills and subagents as appropriate. When finished — or if blocked — call the `goal_report` tool with an honest structured outcome: summarize what you built, list files changed and the commands/tests you ran with their results, and list anything still incomplete. Report incomplete items truthfully rather than claiming false success.",
  ].join('\n');
}

/** Slice-1 executor: one agent pass in a per-goal git worktree. */
export class SinglePassExecutor implements GoalExecutor {
  constructor(
    private store: Store,
    private runner: RunnerLike,
    private worktreesDir: string,
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
      resetWorktree(g.project_path, worktreePath, branch); // idempotent re-run
      addWorktree(g.project_path, worktreePath, branch);
    } catch (e) {
      this.store.updateGoal(goalId, { status: 'failed', report: JSON.stringify({ error: `worktree setup failed: ${e instanceof Error ? e.message : e}` }) });
      return;
    }
    this.store.updateGoal(goalId, { status: 'building', branch, worktree_path: worktreePath });
    let sessionId: string;
    try {
      sessionId = this.runner.run({
        projectPath: g.project_path,
        cwd: worktreePath,
        prompt: goalPrompt(goalId, g.expected_output, g.acceptance),
        origin: 'goal',
        title: g.title,
        sourceKind: 'goal',
        sourceId: goalId,
      });
    } catch (e) {
      try { removeWorktree(g.project_path, worktreePath); } catch { /* best-effort */ }
      this.store.updateGoal(goalId, { status: 'failed', worktree_path: null, report: JSON.stringify({ error: `failed to start run: ${e instanceof Error ? e.message : e}` }) });
      return;
    }
    this.store.updateGoal(goalId, { session_id: sessionId });
  }
}

/** Drive goal status from task lifecycle frames + clean up the worktree. */
export function registerGoalAutomation(manager: Pick<SessionManager, 'on'>, store: Store): void {
  manager.on('task', (frame: { id: string; source_kind: string | null; source_id: string | null; status: string; result: string | null }) => {
    try {
      if (frame.source_kind !== 'goal' || !frame.source_id) return;
      const g = store.getGoal(frame.source_id);
      if (!g) return;
      if (frame.status === 'active') return; // building already set by the executor
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
