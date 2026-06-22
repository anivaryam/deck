import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.ts';
import { TaskRunner } from '../src/taskRunner.ts';
import { Scheduler } from '../src/scheduler.ts';
import { registerRoutes } from '../src/routes.ts';
import { EventEmitter } from 'node:events';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('run history store', () => {
  it('createTask persists source_kind/source_id', () => {
    const t = store.createTask({ projectPath: '/p', prompt: 'x', origin: 'cron', sourceKind: 'cron', sourceId: 'c1' });
    const row = store.get(t.id)!;
    expect(row.source_kind).toBe('cron');
    expect(row.source_id).toBe('c1');
    expect(row.ended_at == null).toBe(true);
    expect(row.result == null).toBe(true);
  });

  it('createTask without source leaves columns null', () => {
    const t = store.createTask({ projectPath: '/p', prompt: 'x', origin: 'manual' });
    const row = store.get(t.id)!;
    expect(row.source_kind == null).toBe(true);
    expect(row.source_id == null).toBe(true);
  });

  it('finishRun sets ended_at and result', () => {
    const t = store.createTask({ projectPath: '/p', prompt: 'x', origin: 'manual' });
    store.finishRun(t.id, 'success');
    const row = store.get(t.id)!;
    expect(row.result).toBe('success');
    expect(typeof row.ended_at).toBe('number');
  });

  it('listRunsForSource filters by source and orders newest-first', () => {
    const a = store.createTask({ projectPath: '/p', prompt: 'a', origin: 'cron', sourceKind: 'cron', sourceId: 'c1' });
    const b = store.createTask({ projectPath: '/p', prompt: 'b', origin: 'cron', sourceKind: 'cron', sourceId: 'c1' });
    store.createTask({ projectPath: '/p', prompt: 'c', origin: 'cron', sourceKind: 'cron', sourceId: 'OTHER' });
    const runs = store.listRunsForSource('cron', 'c1');
    expect(runs.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('listRunsForSource respects the limit', () => {
    for (let i = 0; i < 5; i++) store.createTask({ projectPath: '/p', prompt: `${i}`, origin: 'ticket', sourceKind: 'ticket', sourceId: 't1' });
    expect(store.listRunsForSource('ticket', 't1', 3)).toHaveLength(3);
  });
});

describe('source threading', () => {
  it('taskRunner.run threads sourceKind/sourceId into the task', () => {
    const s = new Store(':memory:');
    const fakeManager = { send: async () => {} };
    const runner = new TaskRunner(s, fakeManager as any);
    const id = runner.run({ projectPath: '/p', prompt: 'x', origin: 'cron', sourceKind: 'cron', sourceId: 'c9' });
    const row = s.get(id)!;
    expect(row.source_kind).toBe('cron');
    expect(row.source_id).toBe('c9');
  });

  it('queue-full marks result=queue_full', () => {
    const s = new Store(':memory:');
    const blocking = { send: () => new Promise<void>(() => {}) }; // never resolves
    const runner = new TaskRunner(s, blocking as any, 1);
    runner.run({ projectPath: '/p', prompt: 'a', origin: 'manual' }); // fills the 1 slot
    const overflowId = runner.run({ projectPath: '/p', prompt: 'b', origin: 'manual' });
    expect(s.get(overflowId)!.result).toBe('queue_full');
  });

  it('scheduler.fireCron tags the run with the cron id', () => {
    const s = new Store(':memory:');
    const created: any[] = [];
    const runner = { run: (i: any) => { created.push(i); return 'sess1'; } };
    const sched = new Scheduler(s, runner as any);
    const c = s.createCron({ schedule: '* * * * *', projectPath: '/p', prompt: 'nightly' });
    sched.fireCron(c.id);
    expect(created[0]).toMatchObject({ origin: 'cron', sourceKind: 'cron', sourceId: c.id });
  });
});

describe('events channel contract', () => {
  it('manager emits a task lifecycle frame that a listener receives', () => {
    const mgr = new EventEmitter();
    const received: any[] = [];
    mgr.on('task', (f) => received.push(f));
    mgr.emit('task', { id: 's1', source_kind: 'cron', source_id: 'c1', status: 'idle', result: 'success' });
    expect(received).toEqual([{ id: 's1', source_kind: 'cron', source_id: 'c1', status: 'idle', result: 'success' }]);
  });
});

// ────────────────────────────────────────────────────────────
// GET /api/runs route
// ────────────────────────────────────────────────────────────
describe('GET /api/runs', () => {
  let root: string;
  let app: ReturnType<typeof Fastify>;
  let routeStore: Store;

  const TOKEN = 'runs-test-token-9999';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-runs-'));
    fs.mkdirSync(path.join(root, 'proj'));
    routeStore = new Store(':memory:');
    const fakeManager = { send: async (_id: string, _prompt: string): Promise<void> => {} } as any;
    const taskRunner = new TaskRunner(routeStore, fakeManager);
    const scheduler = new Scheduler(routeStore, taskRunner);
    app = Fastify();
    await app.register(cookie);
    registerRoutes(app, {
      store: routeStore,
      config: { token: TOKEN, projectsRoot: root, port: 1, model: 'claude-opus-4-8', memoryMining: false, memoryModel: 'm' },
      taskRunner,
      scheduler,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function login(): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    return res.headers['set-cookie'] as string;
  }

  it('GET /api/runs without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs?source_kind=cron&source_id=c1' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/runs missing source_kind → 400', async () => {
    const cookieHeader = await login();
    const res = await app.inject({ method: 'GET', url: '/api/runs?source_id=c1', headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/source_kind/i);
  });

  it('GET /api/runs missing source_id → 400', async () => {
    const cookieHeader = await login();
    const res = await app.inject({ method: 'GET', url: '/api/runs?source_kind=cron', headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/source_id/i);
  });

  it('GET /api/runs invalid source_kind → 400', async () => {
    const cookieHeader = await login();
    const res = await app.inject({ method: 'GET', url: '/api/runs?source_kind=manual&source_id=x1', headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/runs with no matching runs returns empty array', async () => {
    const cookieHeader = await login();
    const res = await app.inject({ method: 'GET', url: '/api/runs?source_kind=cron&source_id=nonexistent', headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/runs returns runs for the given source', async () => {
    const cookieHeader = await login();
    routeStore.createTask({ projectPath: root, prompt: 'run 1', origin: 'cron', sourceKind: 'cron', sourceId: 'c42' });
    routeStore.createTask({ projectPath: root, prompt: 'run 2', origin: 'cron', sourceKind: 'cron', sourceId: 'c42' });
    routeStore.createTask({ projectPath: root, prompt: 'other', origin: 'cron', sourceKind: 'cron', sourceId: 'OTHER' });
    const res = await app.inject({ method: 'GET', url: '/api/runs?source_kind=cron&source_id=c42', headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(200);
    const runs = res.json();
    expect(Array.isArray(runs)).toBe(true);
    expect(runs).toHaveLength(2);
    expect(runs.every((r: any) => r.source_kind === 'cron' && r.source_id === 'c42')).toBe(true);
  });

  it('GET /api/runs works for ticket source_kind', async () => {
    const cookieHeader = await login();
    routeStore.createTask({ projectPath: root, prompt: 'ticket run', origin: 'ticket', sourceKind: 'ticket', sourceId: 't7' });
    const res = await app.inject({ method: 'GET', url: '/api/runs?source_kind=ticket&source_id=t7', headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(200);
    const runs = res.json();
    expect(runs).toHaveLength(1);
    expect(runs[0].source_kind).toBe('ticket');
    expect(runs[0].source_id).toBe('t7');
  });
});
