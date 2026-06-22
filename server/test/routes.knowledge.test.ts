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

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-knowledge-'));
  app = Fastify();
  await app.register(cookie);
  store = new Store(':memory:');
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

async function login(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
  return res.headers['set-cookie'] as string;
}

describe('GET /api/knowledge', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/knowledge' });
    expect(res.statusCode).toBe(401);
  });

  it('returns all facts across scopes when authed', async () => {
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'g', fact: 'global fact' });
    store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'a', fact: 'alpha fact' });
    const res = await app.inject({ method: 'GET', url: '/api/knowledge', headers: { cookie: await login() } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ scope: string; fact: string }>;
    expect(body.map((f) => f.fact).sort()).toEqual(['alpha fact', 'global fact']);
  });
});
