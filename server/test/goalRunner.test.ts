import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.ts';
import { SinglePassExecutor, registerGoalAutomation } from '../src/goalRunner.ts';
import { removeWorktree as removeWorktreeForTest } from '../src/git.ts';

let repo: string, wtBase: string, store: Store, manager: any, runs: any[], taskRunner: any;

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
  taskRunner = {
    run: (input: any) => {
      runs.push(input);
      const t = store.createTask({ projectPath: input.projectPath, prompt: input.prompt, origin: input.origin, sourceKind: input.sourceKind, sourceId: input.sourceId, cwd: input.cwd });
      return t.id;
    },
  };
  manager = new EventEmitter();
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wtBase, { recursive: true, force: true });
});

describe('SinglePassExecutor', () => {
  it('fails a non-git project', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'));
    const g = store.createGoal({ projectPath: plain, title: 'T', expectedOutput: 'x' });
    new SinglePassExecutor(store, taskRunner, wtBase).start(g.id);
    expect(store.getGoal(g.id)!.status).toBe('failed');
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('creates a worktree + branch, launches a run, sets building', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'do x', acceptance: 'x' });
    new SinglePassExecutor(store, taskRunner, wtBase).start(g.id);
    const got = store.getGoal(g.id)!;
    expect(got.status).toBe('building');
    expect(got.branch).toBe(`goal/${g.id}`);
    expect(got.session_id).toBeTruthy();
    expect(fs.existsSync(got.worktree_path!)).toBe(true);
    expect(runs[0].cwd).toBe(got.worktree_path);
    expect(runs[0].origin).toBe('goal');
    expect(runs[0].prompt).toMatch(/do x/);
  });

  it('re-run after a prior run succeeds (idempotent worktree/branch reset)', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x' });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    exec.start(g.id);
    expect(store.getGoal(g.id)!.status).toBe('building');
    // simulate the prior run's worktree being removed on terminal, branch left behind
    const wt = store.getGoal(g.id)!.worktree_path!;
    removeWorktreeForTest(repo, wt);
    // re-run must not collide on the existing goal/<id> branch
    exec.start(g.id);
    expect(store.getGoal(g.id)!.status).toBe('building');
    expect(store.getGoal(g.id)!.branch).toBe(`goal/${g.id}`);
  });

  it('marks failed + cleans worktree when the runner throws', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x' });
    const throwingRunner = { run: () => { throw new Error('queue exploded'); } };
    new SinglePassExecutor(store, throwingRunner as any, wtBase).start(g.id);
    const got = store.getGoal(g.id)!;
    expect(got.status).toBe('failed');
    expect(got.worktree_path).toBeNull();
  });
});

describe('registerGoalAutomation', () => {
  it('on success+report → review and removes the worktree', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x' });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    registerGoalAutomation(manager, store, exec);
    exec.start(g.id);
    const wt = store.getGoal(g.id)!.worktree_path!;
    store.updateGoal(g.id, { report: JSON.stringify({ summary: 's', goal_met: true }) });
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal', source_id: g.id, status: 'idle', result: 'success' });
    expect(store.getGoal(g.id)!.status).toBe('verifying');
  });

  it('on terminal without a report → failed', () => {
    const g = store.createGoal({ projectPath: repo, title: 'T', expectedOutput: 'x' });
    const exec = new SinglePassExecutor(store, taskRunner, wtBase);
    registerGoalAutomation(manager, store, exec);
    exec.start(g.id);
    manager.emit('task', { id: store.getGoal(g.id)!.session_id, source_kind: 'goal', source_id: g.id, status: 'errored', result: 'error' });
    expect(store.getGoal(g.id)!.status).toBe('failed');
  });
});

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
    expect(fs.existsSync(wt)).toBe(true);
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
