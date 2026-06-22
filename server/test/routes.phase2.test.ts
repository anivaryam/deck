// server/test/routes.phase2.test.ts
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

let root: string;
let app: ReturnType<typeof Fastify>;
let store: Store;
let scheduler: Scheduler;
let reloadSpy: ReturnType<typeof vi.spyOn>;

const TOKEN = 'phase2-test-token-5678';

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-phase2-'));
  fs.mkdirSync(path.join(root, 'alpha'));

  store = new Store(':memory:');

  // Real TaskRunner with a no-op fakeManager so fire-and-forget doesn't error
  const fakeManager = { send: async (_id: string, _prompt: string): Promise<void> => {} } as any;
  const taskRunner = new TaskRunner(store, fakeManager);

  // Real Scheduler (reload is harmless with no enabled crons)
  scheduler = new Scheduler(store, taskRunner);
  reloadSpy = vi.spyOn(scheduler, 'reload');

  app = Fastify();
  await app.register(cookie);
  registerRoutes(app, {
    store,
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

// ────────────────────────────────────────────────────────────
// 401 guard
// ────────────────────────────────────────────────────────────
describe('401 without cookie', () => {
  it('GET /api/tasks → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks' });
    expect(res.statusCode).toBe(401);
  });
  it('POST /api/tasks → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: {} });
    expect(res.statusCode).toBe(401);
  });
  it('GET /api/cron → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cron' });
    expect(res.statusCode).toBe(401);
  });
  it('POST /api/cron → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/cron', payload: {} });
    expect(res.statusCode).toBe(401);
  });
  it('GET /api/tickets → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tickets' });
    expect(res.statusCode).toBe(401);
  });
  it('POST /api/tickets → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tickets', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

// ────────────────────────────────────────────────────────────
// Tasks
// ────────────────────────────────────────────────────────────
describe('tasks', () => {
  it('POST /api/tasks creates a task and returns {id}', async () => {
    const cookieHeader = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { cookie: cookieHeader },
      payload: { project: 'alpha', prompt: 'do the thing' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.id).toBe('string');
  });

  it('GET /api/tasks lists created tasks', async () => {
    const cookieHeader = await login();
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { cookie: cookieHeader },
      payload: { project: 'alpha', prompt: 'task one' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    const tasks = res.json();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks[0].kind).toBe('task');
  });

  it('POST /api/tasks with bad project → 400', async () => {
    const cookieHeader = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { cookie: cookieHeader },
      payload: { project: '../escape', prompt: 'do x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/tasks missing prompt → 400', async () => {
    const cookieHeader = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { cookie: cookieHeader },
      payload: { project: 'alpha' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────
// Cron
// ────────────────────────────────────────────────────────────
describe('cron', () => {
  it('POST /api/cron creates a cron entry', async () => {
    const cookieHeader = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/cron',
      headers: { cookie: cookieHeader },
      payload: { schedule: '* * * * *', project: 'alpha', prompt: 'tick' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.id).toBe('string');
    expect(body.enabled).toBe(1);
    expect(reloadSpy).toHaveBeenCalled();
  });

  it('POST /api/cron with bad schedule → 400', async () => {
    const cookieHeader = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/cron',
      headers: { cookie: cookieHeader },
      payload: { schedule: 'not a cron', project: 'alpha', prompt: 'tick' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/invalid cron/i);
  });

  it('PATCH /api/cron/:id toggles enabled and calls scheduler.reload', async () => {
    const cookieHeader = await login();
    const create = await app.inject({
      method: 'POST',
      url: '/api/cron',
      headers: { cookie: cookieHeader },
      payload: { schedule: '* * * * *', project: 'alpha', prompt: 'tick' },
    });
    const { id } = create.json();
    reloadSpy.mockClear();

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/cron/${id}`,
      headers: { cookie: cookieHeader },
      payload: { enabled: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().enabled).toBe(0);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('DELETE /api/cron/:id removes the entry and calls scheduler.reload', async () => {
    const cookieHeader = await login();
    const create = await app.inject({
      method: 'POST',
      url: '/api/cron',
      headers: { cookie: cookieHeader },
      payload: { schedule: '* * * * *', project: 'alpha', prompt: 'tick' },
    });
    const { id } = create.json();
    reloadSpy.mockClear();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/cron/${id}`,
      headers: { cookie: cookieHeader },
    });
    expect(del.statusCode).toBe(204);
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    // Verify it's gone
    const list = await app.inject({
      method: 'GET',
      url: '/api/cron',
      headers: { cookie: cookieHeader },
    });
    expect(list.json().find((c: any) => c.id === id)).toBeUndefined();
  });

  it('GET /api/cron lists all cron entries', async () => {
    const cookieHeader = await login();
    await app.inject({
      method: 'POST',
      url: '/api/cron',
      headers: { cookie: cookieHeader },
      payload: { schedule: '*/5 * * * *', project: 'alpha', prompt: 'p1' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/cron',
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────
// Tickets
// ────────────────────────────────────────────────────────────
describe('tickets', () => {
  it('POST /api/tickets creates a ticket', async () => {
    const cookieHeader = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: { cookie: cookieHeader },
      payload: { title: 'Fix bug', project: 'alpha', body: 'details here' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.id).toBe('string');
    expect(body.status).toBe('open');
    expect(body.title).toBe('Fix bug');
  });

  it('GET /api/tickets lists tickets', async () => {
    const cookieHeader = await login();
    await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: { cookie: cookieHeader },
      payload: { title: 'T1', project: 'alpha' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/tickets',
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /api/tickets/:id updates status', async () => {
    const cookieHeader = await login();
    const create = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: { cookie: cookieHeader },
      payload: { title: 'T2', project: 'alpha' },
    });
    const { id } = create.json();

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/tickets/${id}`,
      headers: { cookie: cookieHeader },
      payload: { status: 'done' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().status).toBe('done');
  });

  it('POST /api/tickets/:id/run returns session_id, sets status running, links session', async () => {
    const cookieHeader = await login();
    const create = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: { cookie: cookieHeader },
      payload: { title: 'Run me', project: 'alpha', body: 'Do something' },
    });
    const { id } = create.json();

    const run = await app.inject({
      method: 'POST',
      url: `/api/tickets/${id}/run`,
      headers: { cookie: cookieHeader },
    });
    expect(run.statusCode).toBe(200);
    const { session_id } = run.json();
    expect(typeof session_id).toBe('string');

    // Verify ticket is updated
    const ticket = store.getTicket(id)!;
    expect(ticket.status).toBe('running');
    expect(ticket.session_id).toBe(session_id);

    // Verify the linked session exists and is a task
    const session = store.get(session_id)!;
    expect(session).toBeDefined();
    expect(session.kind).toBe('task');
    expect(session.origin).toBe('ticket');
  });
});
