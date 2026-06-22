// server/test/routes.test.ts
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

let root: string;
let app: ReturnType<typeof Fastify>;
const TOKEN = 'a-long-test-token-value-1234';

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-routes-'));
  fs.mkdirSync(path.join(root, 'alpha'));
  app = Fastify();
  await app.register(cookie);
  const store = new Store(':memory:');
  const fakeManager = { send: async () => {} } as any;
  const taskRunner = new TaskRunner(store, fakeManager);
  const scheduler = new Scheduler(store, taskRunner);
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

describe('auth', () => {
  it('rejects a bad token', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth', payload: { token: 'wrong' } });
    expect(res.statusCode).toBe(401);
  });
  it('accepts the right token and sets a cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    expect(res.statusCode).toBe(204);
    expect(res.headers['set-cookie']).toMatch(/deck_session=/);
  });
});

describe('protected routes', () => {
  it('blocks /api/projects without a cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(401);
  });

  it('lists projects with a valid cookie', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    const cookieHeader = login.headers['set-cookie'] as string;
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((p: any) => p.name)).toContain('alpha');
  });

  it('blocks /api/config without a cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(401);
  });

  it('reports server defaults for new chats', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    const cookieHeader = login.headers['set-cookie'] as string;
    const res = await app.inject({ method: 'GET', url: '/api/config', headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(200);
    // chatEffort unset in this fixture → coalesces to the SDK default 'high'.
    expect(res.json()).toEqual({ defaultModel: 'claude-opus-4-8', defaultEffort: 'high' });
  });

  it('creates a session in a valid project and rejects an invalid one', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    const cookieHeader = login.headers['set-cookie'] as string;

    const ok = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: cookieHeader },
      payload: { project: 'alpha', title: 'A' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().project_path).toContain('alpha');

    const bad = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: cookieHeader },
      payload: { project: '../escape' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('persists model when creating a session with model field', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    const cookieHeader = login.headers['set-cookie'] as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: cookieHeader },
      payload: { project: 'alpha', model: 'claude-sonnet-4-6' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().model).toBe('claude-sonnet-4-6');
  });

  it('persists model when creating a task with model field', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    const cookieHeader = login.headers['set-cookie'] as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { cookie: cookieHeader },
      payload: { project: 'alpha', prompt: 'do something', model: 'claude-haiku-4-5-20251001' },
    });
    expect(res.statusCode).toBe(200);
    // Response is { id } — verify the session in store has model set
    const taskId = res.json().id;
    const detail = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: cookieHeader },
    });
    expect(detail.json().model).toBe('claude-haiku-4-5-20251001');
  });

  it('persists effort when creating a session with effort field', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    const cookieHeader = login.headers['set-cookie'] as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: cookieHeader },
      payload: { project: 'alpha', effort: 'max' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().effort).toBe('max');
  });

  it('rejects an invalid effort value', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    const cookieHeader = login.headers['set-cookie'] as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: cookieHeader },
      payload: { project: 'alpha', effort: 'ultra' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/effort/);
  });

  it('PATCH /api/sessions/:id updates disabled tools', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    const cookieHeader = login.headers['set-cookie'] as string;

    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: cookieHeader },
      payload: { project: 'alpha' },
    });
    const id = created.json().id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${id}`,
      headers: { cookie: cookieHeader },
      payload: { disabledTools: ['Bash', 'WebFetch'] },
    });
    expect(patched.statusCode).toBe(200);
    expect(JSON.parse(patched.json().disabled_tools)).toEqual(['Bash', 'WebFetch']);
  });

  it('PATCH rejects unknown tool names', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    const cookieHeader = login.headers['set-cookie'] as string;

    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: cookieHeader },
      payload: { project: 'alpha' },
    });
    const id = created.json().id;

    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${id}`,
      headers: { cookie: cookieHeader },
      payload: { disabledTools: ['rm -rf', 'Bash'] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/disabledTools/);
  });

  it('PATCH on an unknown session is 404', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
    const cookieHeader = login.headers['set-cookie'] as string;
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/does-not-exist',
      headers: { cookie: cookieHeader },
      payload: { disabledTools: ['Bash'] },
    });
    expect(res.statusCode).toBe(404);
  });
});
