// server/test/routes.interactive.test.ts
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
let cancelSpy: ReturnType<typeof vi.fn>;
let isActiveSpy: ReturnType<typeof vi.fn>;

const TOKEN = 'interactive-test-token-9012';

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-interactive-'));
  fs.mkdirSync(path.join(root, 'alpha'));

  store = new Store(':memory:');
  const fakeSdkManager = { send: async (_id: string, _p: string): Promise<void> => {}, emit: () => true } as any;
  const taskRunner = new TaskRunner(store, fakeSdkManager);
  const scheduler = new Scheduler(store, taskRunner);

  cancelSpy = vi.fn(() => true);
  isActiveSpy = vi.fn(() => false);
  const manager = { cancel: cancelSpy, isActive: isActiveSpy, discard: vi.fn() } as any;

  app = Fastify();
  await app.register(cookie);
  registerRoutes(app, {
    store,
    config: { token: TOKEN, projectsRoot: root, port: 1, model: 'claude-opus-4-8' },
    taskRunner,
    scheduler,
    manager,
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

async function createTask(cookieHeader: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { cookie: cookieHeader },
    payload: { project: 'alpha', prompt: 'do the thing' },
  });
  return res.json().id;
}

describe('DELETE /api/tasks/:id', () => {
  it('404 for a missing id', async () => {
    const c = await login();
    const res = await app.inject({ method: 'DELETE', url: '/api/tasks/nope', headers: { cookie: c } });
    expect(res.statusCode).toBe(404);
  });

  it('404 when the id is a chat session, not a task', async () => {
    const c = await login();
    const sess = await app.inject({
      method: 'POST', url: '/api/sessions', headers: { cookie: c }, payload: { project: 'alpha' },
    });
    const id = sess.json().id;
    const res = await app.inject({ method: 'DELETE', url: `/api/tasks/${id}`, headers: { cookie: c } });
    expect(res.statusCode).toBe(404);
  });

  it('409 while the task is active', async () => {
    const c = await login();
    const id = await createTask(c); // taskRunner marks it active synchronously
    const res = await app.inject({ method: 'DELETE', url: `/api/tasks/${id}`, headers: { cookie: c } });
    expect(res.statusCode).toBe(409);
  });

  it('204 and removes a finished task', async () => {
    const c = await login();
    const id = await createTask(c);
    store.setStatus(id, 'idle'); // simulate completion
    const res = await app.inject({ method: 'DELETE', url: `/api/tasks/${id}`, headers: { cookie: c } });
    expect(res.statusCode).toBe(204);
    expect(store.get(id)).toBeUndefined();
  });
});

describe('POST /api/tasks/:id/cancel', () => {
  it('404 for a non-task id', async () => {
    const c = await login();
    const res = await app.inject({ method: 'POST', url: '/api/tasks/nope/cancel', headers: { cookie: c } });
    expect(res.statusCode).toBe(404);
  });

  it('aborts an active task via the manager and reports aborted:true', async () => {
    const c = await login();
    const id = await createTask(c);
    const res = await app.inject({ method: 'POST', url: `/api/tasks/${id}/cancel`, headers: { cookie: c } });
    expect(res.statusCode).toBe(200);
    expect(res.json().aborted).toBe(true);
    expect(cancelSpy).toHaveBeenCalledWith(id);
  });

  it('is idempotent: aborted:false when nothing was running', async () => {
    const c = await login();
    const id = await createTask(c);
    cancelSpy.mockReturnValueOnce(false);
    const res = await app.inject({ method: 'POST', url: `/api/tasks/${id}/cancel`, headers: { cookie: c } });
    expect(res.statusCode).toBe(200);
    expect(res.json().aborted).toBe(false);
  });
});

describe('POST /api/cron/:id/run', () => {
  async function createCron(c: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/cron', headers: { cookie: c },
      payload: { schedule: '0 3 * * *', project: 'alpha', prompt: 'tick' },
    });
    return res.json().id;
  }

  it('404 for a missing cron', async () => {
    const c = await login();
    const res = await app.inject({ method: 'POST', url: '/api/cron/nope/run', headers: { cookie: c } });
    expect(res.statusCode).toBe(404);
  });

  it('fires immediately and returns a session_id, recording it on the cron', async () => {
    const c = await login();
    const id = await createCron(c);
    const res = await app.inject({ method: 'POST', url: `/api/cron/${id}/run`, headers: { cookie: c } });
    expect(res.statusCode).toBe(200);
    const { session_id } = res.json();
    expect(typeof session_id).toBe('string');
    const session = store.get(session_id)!;
    expect(session.kind).toBe('task');
    expect(session.origin).toBe('cron');
    expect(store.getCron(id)!.last_session_id).toBe(session_id);
  });

  it('409 when the previous run is still active (overlap guard)', async () => {
    const c = await login();
    const id = await createCron(c);
    await app.inject({ method: 'POST', url: `/api/cron/${id}/run`, headers: { cookie: c } }); // run 1 stays active
    const res = await app.inject({ method: 'POST', url: `/api/cron/${id}/run`, headers: { cookie: c } });
    expect(res.statusCode).toBe(409);
  });

  it('409 when the cron is disabled', async () => {
    const c = await login();
    const id = await createCron(c);
    await app.inject({ method: 'PATCH', url: `/api/cron/${id}`, headers: { cookie: c }, payload: { enabled: false } });
    const res = await app.inject({ method: 'POST', url: `/api/cron/${id}/run`, headers: { cookie: c } });
    expect(res.statusCode).toBe(409);
  });
});

describe('PATCH /api/cron/:id (edit schedule/prompt)', () => {
  async function createCron(c: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/cron', headers: { cookie: c },
      payload: { schedule: '0 3 * * *', project: 'alpha', prompt: 'old' },
    });
    return res.json().id;
  }

  it('updates schedule and prompt', async () => {
    const c = await login();
    const id = await createCron(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/cron/${id}`, headers: { cookie: c },
      payload: { schedule: '0 4 * * *', prompt: 'new' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().schedule).toBe('0 4 * * *');
    expect(res.json().prompt).toBe('new');
  });

  it('rejects an invalid schedule with 400', async () => {
    const c = await login();
    const id = await createCron(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/cron/${id}`, headers: { cookie: c },
      payload: { schedule: 'not a cron' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/invalid cron/i);
  });

  it('rejects a too-frequent schedule with 400', async () => {
    const c = await login();
    const id = await createCron(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/cron/${id}`, headers: { cookie: c },
      payload: { schedule: '*/30 * * * * *' }, // 30s gap < 60s min
    });
    expect(res.statusCode).toBe(400);
  });

  it('still toggles enabled', async () => {
    const c = await login();
    const id = await createCron(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/cron/${id}`, headers: { cookie: c },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(0);
  });

  it('rejects an empty prompt with 400', async () => {
    const c = await login();
    const id = await createCron(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/cron/${id}`, headers: { cookie: c },
      payload: { prompt: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/tickets/:id (edit title/body)', () => {
  async function createTicket(c: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/tickets', headers: { cookie: c },
      payload: { title: 'old title', project: 'alpha', body: 'old body' },
    });
    return res.json().id;
  }

  it('updates title and body', async () => {
    const c = await login();
    const id = await createTicket(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/tickets/${id}`, headers: { cookie: c },
      payload: { title: 'new title', body: 'new body' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('new title');
    expect(res.json().body).toBe('new body');
  });

  it('rejects an empty title with 400', async () => {
    const c = await login();
    const id = await createTicket(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/tickets/${id}`, headers: { cookie: c },
      payload: { title: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('still updates status', async () => {
    const c = await login();
    const id = await createTicket(c);
    const res = await app.inject({
      method: 'PATCH', url: `/api/tickets/${id}`, headers: { cookie: c },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('done');
  });
});
