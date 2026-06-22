// server/test/routes.hardening.test.ts
// Covers the audit-hardening additions: cron min-interval rejection,
// Sec-Fetch-Site CSRF signal, and the ?limit event-tail on session detail.
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
let store: Store;
const TOKEN = 'a-long-test-token-value-1234';

async function login(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
  return res.headers['set-cookie'] as string;
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-harden-'));
  fs.mkdirSync(path.join(root, 'alpha'));
  app = Fastify();
  await app.register(cookie);
  store = new Store(':memory:');
  const taskRunner = new TaskRunner(store, { send: async () => {} } as any);
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

describe('cron min-interval guard', () => {
  it('rejects a schedule that fires more often than the floor', async () => {
    const c = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/cron',
      headers: { cookie: c },
      payload: { schedule: '* * * * * *', project: 'alpha', prompt: 'go' }, // every second
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/too frequently/);
  });
  it('accepts a schedule at or above the floor', async () => {
    const c = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/cron',
      headers: { cookie: c },
      payload: { schedule: '*/2 * * * *', project: 'alpha', prompt: 'go' }, // every 2 min
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Sec-Fetch-Site CSRF signal', () => {
  it('blocks a cross-site mutating request even with a valid cookie', async () => {
    const c = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: c, 'sec-fetch-site': 'cross-site' },
      payload: { project: 'alpha' },
    });
    expect(res.statusCode).toBe(403);
  });
  it('allows a same-origin request (and absent header)', async () => {
    const c = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: c, 'sec-fetch-site': 'same-origin' },
      payload: { project: 'alpha' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('event tail (?limit)', () => {
  it('returns only the last N events when limit is given, all otherwise', async () => {
    const c = await login();
    const s = store.create({ projectPath: path.join(root, 'alpha') });
    for (let i = 0; i < 5; i++) store.appendEvent(s.id, { sdkUuid: null, type: 'assistant', payload: { i } });

    const all = await app.inject({ method: 'GET', url: `/api/sessions/${s.id}`, headers: { cookie: c } });
    expect(all.json().events).toHaveLength(5);

    const tail = await app.inject({ method: 'GET', url: `/api/sessions/${s.id}?limit=2`, headers: { cookie: c } });
    const ev = tail.json().events;
    expect(ev).toHaveLength(2);
    expect(ev[0].payload.i).toBe(3); // ascending order, last two
    expect(ev[1].payload.i).toBe(4);
  });
});
