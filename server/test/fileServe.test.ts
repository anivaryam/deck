// server/test/fileServe.test.ts
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

const TOKEN = 'file-serve-token-9999';

let root: string;
let app: ReturnType<typeof Fastify>;
let store: Store;
let projectPath: string;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-fileserve-'));
  projectPath = path.join(root, 'alpha');
  fs.mkdirSync(path.join(projectPath, '.deck-artifacts'), { recursive: true });
  fs.writeFileSync(path.join(projectPath, '.deck-artifacts', 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(projectPath, '.deck-artifacts', 'report.pdf'), Buffer.from('%PDF-1.4 fake'));
  fs.writeFileSync(path.join(projectPath, '.deck-artifacts', 'data.zip'), Buffer.from('PK fake'));
  fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP SECRET'); // outside the project

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

describe('GET /api/file/:sessionId/*', () => {
  it('returns 401 without a cookie', async () => {
    const sess = store.create({ projectPath });
    const res = await app.inject({ method: 'GET', url: `/api/file/${sess.id}/.deck-artifacts/shot.png` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown session', async () => {
    const cookieHeader = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/file/no-such-session/.deck-artifacts/shot.png',
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(404);
  });

  it('serves an image inline with the right Content-Type', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/shot.png`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(String(res.headers['content-disposition'])).toContain('inline');
    expect(res.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('serves a pdf inline', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/report.pdf`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(String(res.headers['content-disposition'])).toContain('inline');
  });

  it('maps .jpg to image/jpeg', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    fs.writeFileSync(path.join(projectPath, '.deck-artifacts', 'pic.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/pic.jpg`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(String(res.headers['content-disposition'])).toContain('inline');
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/shot.png`,
      headers: { cookie: cookieHeader },
    });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves SVG as an attachment, never inline (XSS mitigation)', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    fs.writeFileSync(path.join(projectPath, '.deck-artifacts', 'x.svg'), '<svg onload="alert(1)"></svg>');
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/x.svg`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-disposition'])).toContain('attachment');
  });

  it('serves an unknown type as an attachment download', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/data.zip`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(String(res.headers['content-disposition'])).toContain('attachment');
  });

  it('blocks path traversal out of the project (403)', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/../secret.txt`,
      headers: { cookie: cookieHeader },
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.rawPayload.toString()).not.toContain('TOP SECRET');
  });

  it('blocks a symlink that escapes the project (403/404)', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    fs.symlinkSync(path.join(root, 'secret.txt'), path.join(projectPath, '.deck-artifacts', 'escape.txt'));
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/escape.txt`,
      headers: { cookie: cookieHeader },
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.rawPayload.toString()).not.toContain('TOP SECRET');
  });

  it('returns 404 for a missing file', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/nope.png`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(404);
  });
});
