// server/test/upload.test.ts
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

const TOKEN = 'upload-test-token-9999';

let root: string;
let app: ReturnType<typeof Fastify>;
let store: Store;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-upload-'));
  fs.mkdirSync(path.join(root, 'alpha'));

  store = new Store(':memory:');
  const fakeManager = { send: async () => {} } as any;
  const taskRunner = new TaskRunner(store, fakeManager);
  const scheduler = new Scheduler(store, taskRunner);

  app = Fastify();
  await app.register(cookie);
  registerRoutes(app, {
    store,
    config: { token: TOKEN, projectsRoot: root, port: 1, model: 'claude-opus-4-8' },
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

describe('POST /api/upload', () => {
  it('returns 401 without a cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/upload', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    const cookieHeader = await login();

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { cookie: cookieHeader },
      payload: { sessionId: 'x', filename: 'data.txt' }, // missing dataBase64
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/required/);
  });

  it('returns 404 for an unknown sessionId', async () => {
    const cookieHeader = await login();

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { cookie: cookieHeader },
      payload: {
        sessionId: 'no-such-session',
        filename: 'data.txt',
        dataBase64: Buffer.from('hello').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/unknown session/);
  });

  it('uploads a file, returns relative path, and the file exists on disk with exact bytes', async () => {
    const cookieHeader = await login();
    const projectPath = path.join(root, 'alpha');
    const sess = store.create({ projectPath });

    const content = 'hello-upload-world';
    const dataBase64 = Buffer.from(content).toString('base64');

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { cookie: cookieHeader },
      payload: { sessionId: sess.id, filename: 'hello.txt', dataBase64 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.path).toBe('.deck-uploads/hello.txt');

    const diskPath = path.join(projectPath, body.path);
    expect(fs.existsSync(diskPath)).toBe(true);
    expect(fs.readFileSync(diskPath, 'utf8')).toBe(content);
  });

  it('returns 413 when the decoded payload exceeds 10MB', async () => {
    const cookieHeader = await login();
    const projectPath = path.join(root, 'alpha');
    const sess = store.create({ projectPath });

    // 10MB + 1 byte
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
    const dataBase64 = big.toString('base64');

    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { cookie: cookieHeader },
      payload: { sessionId: sess.id, filename: 'big.bin', dataBase64 },
    });

    expect(res.statusCode).toBe(413);
  });

  it('sanitizes filenames — path separators become underscores', async () => {
    const cookieHeader = await login();
    const projectPath = path.join(root, 'alpha');
    const sess = store.create({ projectPath });

    const dataBase64 = Buffer.from('x').toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { cookie: cookieHeader },
      payload: { sessionId: sess.id, filename: '../../../etc/passwd', dataBase64 },
    });

    // Should succeed (sanitized to 'passwd') or reject with 400 — not write outside project
    if (res.statusCode === 200) {
      const body = res.json();
      // Must be inside .deck-uploads, not escape the project
      expect(body.path.startsWith('.deck-uploads/')).toBe(true);
      expect(body.path).not.toContain('..');
      const diskPath = path.join(projectPath, body.path);
      expect(fs.existsSync(diskPath)).toBe(true);
    } else {
      expect(res.statusCode).toBe(400);
    }
  });

  it('replaces spaces in filenames (artifact renderer tokenizes on whitespace)', async () => {
    const cookieHeader = await login();
    const projectPath = path.join(root, 'alpha');
    const sess = store.create({ projectPath });

    const dataBase64 = Buffer.from('x').toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { cookie: cookieHeader },
      payload: { sessionId: sess.id, filename: 'my notes v2.txt', dataBase64 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.path).toBe('.deck-uploads/my_notes_v2.txt');
    expect(body.path).not.toContain(' ');
  });
});
