// server/test/routes.deleteTicket.test.ts
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

beforeEach(async () => {
  app = Fastify();
  await app.register(cookie);
  store = new Store(':memory:');
  const cfg = { token: TOKEN, projectsRoot: '/p', port: 1, model: 'claude-opus-4-8', memoryMining: false, memoryModel: 'm' };
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
    closeRoom: () => {},
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

describe('DELETE /api/tickets/:id', () => {
  it('requires auth', async () => {
    const t = store.createTicket({ title: 'x', projectPath: '/p/proj' });
    const res = await app.inject({ method: 'DELETE', url: `/api/tickets/${t.id}` });
    expect(res.statusCode).toBe(401);
  });

  it('deletes the ticket and returns 204', async () => {
    const cookieHeader = await login();
    const t = store.createTicket({ title: 'x', projectPath: '/p/proj' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tickets/${t.id}`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(204);
    expect(store.getTicket(t.id)).toBeUndefined();
    expect(store.listTickets()).toHaveLength(0);
  });

  it('returns 404 for an unknown id', async () => {
    const cookieHeader = await login();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tickets/does-not-exist`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(404);
  });
});
