import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { SessionManager } from '../src/sessionManager.ts';

let store: Store;
const cfg = { token: 't', projectsRoot: '/p', port: 1, model: 'claude-opus-4-8', memoryMining: false, memoryModel: 'm' } as any;

beforeEach(() => { store = new Store(':memory:'); });

function captureOptions() {
  const seen: any = {};
  const queryFn = ({ options }: any) => {
    Object.assign(seen, options);
    return (async function* () { /* no events */ })();
  };
  return { seen, queryFn };
}

describe('sessionManager goal maxTurns', () => {
  it('goal sessions get goalMaxTurns (default 150); plain tasks get 40', async () => {
    const a = captureOptions();
    const mgrA = new SessionManager(store, cfg, a.queryFn);
    const goal = store.createTask({ projectPath: '/proj', prompt: 'p', origin: 'goal', sourceKind: 'goal' });
    await mgrA.send(goal.id, 'go');
    expect(a.seen.maxTurns).toBe(150);

    const b = captureOptions();
    const mgrB = new SessionManager(store, cfg, b.queryFn);
    const task = store.createTask({ projectPath: '/proj', prompt: 'p', origin: 'manual' });
    await mgrB.send(task.id, 'go');
    expect(b.seen.maxTurns).toBe(40);
  });
});

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
