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
    sourceKind: 'goal' | 'goal_verify';
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
    } catch (e) {
      try { removeWorktree(g.project_path, worktreePath); } catch { /* best-effort */ }
      this.store.updateGoal(goalId, { status: 'failed', worktree_path: null, report: JSON.stringify({ error: `failed to start run: ${e instanceof Error ? e.message : e}` }) });
      return;
    }
    this.store.updateGoal(goalId, { session_id: sessionId });
  }

  /** Launch the adversarial verifier in the goal's existing worktree. */
  startVerification(goalId: string): void {
    const g = this.store.getGoal(goalId);
    if (!g) return;
    if (!g.worktree_path) {
      this.store.updateGoal(goalId, { status: 'review' });
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
}

/** Drive goal status from task lifecycle frames + clean up the worktree. */
export function registerGoalAutomation(
  manager: Pick<SessionManager, 'on'>,
  store: Store,
  verifier: { start(goalId: string): void; startVerification(goalId: string): void },
): void {
  manager.on('task', (frame: { id: string; source_kind: string | null; source_id: string | null; status: string; result: string | null }) => {
    try {
      const kind = frame.source_kind;
      if ((kind !== 'goal' && kind !== 'goal_verify') || !frame.source_id) return;
      const g = store.getGoal(frame.source_id);
      if (!g) return;
      if (frame.status === 'active') return;

      const cleanup = () => {
        if (g.worktree_path) {
          try { removeWorktree(g.project_path, g.worktree_path); } catch { /* best-effort */ }
          store.updateGoal(g.id, { worktree_path: null });
        }
      };

      if (g.status === 'cancelled') { cleanup(); return; }

      if (kind === 'goal') {
        if (frame.result === 'cancelled') { store.updateGoal(g.id, { status: 'cancelled' }); cleanup(); return; }
        if (frame.result === 'success' && g.report) {
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
      if (verdict?.achieved === true) { store.updateGoal(g.id, { status: 'achieved' }); cleanup(); return; }
      // not achieved — retry if attempts remain, else park at review
      if (g.iteration + 1 < g.max_iterations) {
        store.updateGoal(g.id, { iteration: g.iteration + 1 });
        verifier.start(g.id); // fresh build (manages its own worktree)
        return;
      }
      store.updateGoal(g.id, { status: 'review' });
      cleanup();
    } catch (err) {
      console.error('[goalAutomation] frame handling failed:', err instanceof Error ? err.message : err);
    }
  });
}
