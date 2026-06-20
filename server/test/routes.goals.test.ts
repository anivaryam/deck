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
  return app.inject({ method: 'POST', url: '/api/goals', headers: { cookie: c }, payload: { project: 'alpha', title: 'T', expected_output: 'do x', acceptance: 'x' } });
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
    await app.inject({ method: 'POST', url: `/api/goals/${id}/run`, headers: { cookie: c } });
    const cancel = await app.inject({ method: 'POST', url: `/api/goals/${id}/cancel`, headers: { cookie: c } });
    expect(cancel.statusCode).toBe(200);
    expect(cancelSpy).toHaveBeenCalledWith('s1');
    store.updateGoal(id, { status: 'building' });
    expect((await app.inject({ method: 'DELETE', url: `/api/goals/${id}`, headers: { cookie: c } })).statusCode).toBe(409);
    store.updateGoal(id, { status: 'review' });
    expect((await app.inject({ method: 'DELETE', url: `/api/goals/${id}`, headers: { cookie: c } })).statusCode).toBe(204);
  });

  it('cancel on a queued goal (no session) marks it cancelled', async () => {
    const c = await login();
    const id = (await create(c)).json().id;
    const res = await app.inject({ method: 'POST', url: `/api/goals/${id}/cancel`, headers: { cookie: c } });
    expect(res.statusCode).toBe(200);
    expect(store.getGoal(id)!.status).toBe('cancelled');
  });

  it('rejects a whitespace-only title/expected_output with 400', async () => {
    const c = await login();
    const r = await app.inject({ method: 'POST', url: '/api/goals', headers: { cookie: c }, payload: { project: 'alpha', title: '   ', expected_output: '   ' } });
    expect(r.statusCode).toBe(400);
  });

  it('DELETE 409s while verifying', async () => {
    const c = await login();
    const id = (await create(c)).json().id;
    store.updateGoal(id, { status: 'verifying' });
    expect((await app.inject({ method: 'DELETE', url: `/api/goals/${id}`, headers: { cookie: c } })).statusCode).toBe(409);
  });

  it('POST /run 409s while verifying', async () => {
    const c = await login();
    const id = (await create(c)).json().id;
    store.updateGoal(id, { status: 'verifying' });
    expect((await app.inject({ method: 'POST', url: `/api/goals/${id}/run`, headers: { cookie: c } })).statusCode).toBe(409);
  });
});
