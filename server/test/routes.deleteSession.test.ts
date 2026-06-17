// server/test/routes.deleteSession.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.ts';
import { SessionManager } from '../src/sessionManager.ts';
import { TaskRunner } from '../src/taskRunner.ts';
import { Scheduler } from '../src/scheduler.ts';
import { registerRoutes } from '../src/routes.ts';

const TOKEN = 'a-long-test-token-value-1234';
let app: ReturnType<typeof Fastify>;
let store: Store;
let closed: string[];

beforeEach(async () => {
  app = Fastify();
  await app.register(cookie);
  store = new Store(':memory:');
  closed = [];
  const cfg = { token: TOKEN, projectsRoot: '/p', port: 1, model: 'claude-opus-4-8' };
  const fakeManager = { send: async () => {} } as any;
  const taskRunner = new TaskRunner(store, fakeManager);
  const scheduler = new Scheduler(store, taskRunner);
  const manager = new SessionManager(store, cfg as any);
  registerRoutes(app, {
    store,
    config: cfg as any,
    taskRunner,
    scheduler,
    manager,
    closeRoom: (id: string) => closed.push(id),
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function login(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
  return res.headers['set-cookie'] as string;
}

describe('DELETE /api/sessions/:id', () => {
  it('requires auth', async () => {
    const s = store.create({ projectPath: '/p/proj' });
    const res = await app.inject({ method: 'DELETE', url: `/api/sessions/${s.id}` });
    expect(res.statusCode).toBe(401);
  });

  it('deletes the session, closes its room, returns 204', async () => {
    const cookieHeader = await login();
    const s = store.create({ projectPath: '/p/proj' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${s.id}`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(204);
    expect(store.get(s.id)).toBeUndefined();
    expect(closed).toEqual([s.id]);
  });

  it('returns 404 for an unknown id', async () => {
    const cookieHeader = await login();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/does-not-exist`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(404);
  });

  it('discards an in-flight turn before deleting an active session', async () => {
    // Wire a fresh app with a SPY manager that reports the session as active,
    // to assert the route cancels the running turn (discard) before deleting.
    const app2 = Fastify();
    await app2.register(cookie);
    const store2 = new Store(':memory:');
    const s = store2.create({ projectPath: '/p/proj' });
    const discarded: string[] = [];
    const spyManager = {
      isActive: (id: string) => id === s.id,
      discard: (id: string) => discarded.push(id),
    } as any;
    const cfg = { token: TOKEN, projectsRoot: '/p', port: 1, model: 'claude-opus-4-8' };
    const taskRunner = new TaskRunner(store2, { send: async () => {} } as any);
    const scheduler = new Scheduler(store2, taskRunner);
    registerRoutes(app2, {
      store: store2,
      config: cfg as any,
      taskRunner,
      scheduler,
      manager: spyManager,
      closeRoom: () => {},
    });
    await app2.ready();
    const loginRes = await app2.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    const cookieHeader = loginRes.headers['set-cookie'] as string;

    const res = await app2.inject({
      method: 'DELETE',
      url: `/api/sessions/${s.id}`,
      headers: { cookie: cookieHeader },
    });

    expect(res.statusCode).toBe(204);
    expect(discarded).toEqual([s.id]); // discard called for the active session
    expect(store2.get(s.id)).toBeUndefined(); // row removed
    await app2.close();
  });
});
