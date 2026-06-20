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

  it('persists a verdict and the new statuses', () => {
    const g = store.createGoal({ projectPath: '/p/a', title: 'A', expectedOutput: 'x' });
    store.updateGoal(g.id, { status: 'verifying' });
    expect(store.getGoal(g.id)!.status).toBe('verifying');
    store.updateGoal(g.id, { status: 'achieved', verdict: JSON.stringify({ achieved: true, reasons: 'ok' }) });
    const got = store.getGoal(g.id)!;
    expect(got.status).toBe('achieved');
    expect(JSON.parse(got.verdict!).achieved).toBe(true);
  });

  it('stores max_iterations (default 3) and a 0 iteration; updates iteration', () => {
    const a = store.createGoal({ projectPath: '/p', title: 'A', expectedOutput: 'x' });
    expect(store.getGoal(a.id)!.max_iterations).toBe(3);
    expect(store.getGoal(a.id)!.iteration).toBe(0);
    const b = store.createGoal({ projectPath: '/p', title: 'B', expectedOutput: 'x', maxIterations: 5 });
    expect(store.getGoal(b.id)!.max_iterations).toBe(5);
    store.updateGoal(a.id, { iteration: 2 });
    expect(store.getGoal(a.id)!.iteration).toBe(2);
  });
});
