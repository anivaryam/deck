// server/src/routes.ts
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME, safeEqual, AuthSessions, RateLimiter, originAllowed } from './auth.ts';
import { listProjects, resolveProjectPath, createProject } from './projectScanner.ts';
import type { Store } from './store.ts';
import type { Config } from './config.ts';
import type { TaskRunner } from './taskRunner.ts';
import { Scheduler } from './scheduler.ts';

export interface RouteDeps {
  store: Store;
  config: Config;
  taskRunner: TaskRunner;
  scheduler: Scheduler;
  /** Shared with the WS hub. Created per-app if omitted (tests). */
  auth?: AuthSessions;
}

/** Cookie carries an opaque session id; valid only if the registry knows it. */
export function isAuthed(req: { cookies: Record<string, string | undefined> }, auth: AuthSessions): boolean {
  return auth.valid(req.cookies[COOKIE_NAME]);
}

/** Accept only plausible Claude model identifiers before persisting / forwarding to the SDK. */
function isValidModel(m: unknown): boolean {
  return typeof m === 'string' && m.length <= 100 && /^claude[A-Za-z0-9._:-]+$/.test(m);
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { store, config, taskRunner, scheduler } = deps;
  const auth = deps.auth ?? new AuthSessions();
  const loginLimiter = new RateLimiter(8, 60_000);

  app.post<{ Body: { token?: string } }>('/auth', async (req, reply) => {
    const ip = req.ip || 'unknown';
    if (loginLimiter.blocked(ip)) return reply.code(429).send({ error: 'too many attempts, slow down' });
    const provided = req.body?.token ?? '';
    if (!safeEqual(provided, config.token)) {
      loginLimiter.fail(ip);
      return reply.code(401).send({ error: 'bad token' });
    }
    loginLimiter.reset(ip);
    const sid = auth.issue();
    reply.setCookie(COOKIE_NAME, sid, {
      httpOnly: true,
      secure: config.cookieSecure ?? true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return reply.code(204).send();
  });

  app.post('/auth/logout', async (req, reply) => {
    auth.revoke((req.cookies as Record<string, string | undefined>)[COOKIE_NAME]);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  // Guard everything under /api: require a valid session, and reject cross-origin
  // mutating requests (CSRF defense-in-depth beyond SameSite).
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (!isAuthed(req, auth)) return reply.code(401).send({ error: 'unauthorized' });
    const m = req.method;
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      const origin = req.headers.origin;
      if (origin && !originAllowed(origin, config.publicOrigin)) {
        return reply.code(403).send({ error: 'cross-origin request blocked' });
      }
    }
  });

  app.get('/api/projects', async () => listProjects(config.projectsRoot));

  app.post<{ Body: { name?: string } }>('/api/projects', async (req, reply) => {
    const name = req.body?.name;
    if (!name) return reply.code(400).send({ error: 'name required' });
    try {
      return createProject(config.projectsRoot, name);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid project' });
    }
  });

  app.get('/api/sessions', async () => store.listSessions('chat'));

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const s = store.get(req.params.id);
    if (!s) return reply.code(404).send({ error: 'not found' });
    return { ...s, events: store.eventsSince(req.params.id, 0) };
  });

  app.post<{ Body: { project?: string; title?: string; model?: string } }>('/api/sessions', async (req, reply) => {
    const project = req.body?.project;
    if (!project) return reply.code(400).send({ error: 'project required' });
    if (req.body?.model !== undefined && !isValidModel(req.body.model)) {
      return reply.code(400).send({ error: 'invalid model' });
    }
    let projectPath: string;
    try {
      projectPath = resolveProjectPath(config.projectsRoot, project);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid project' });
    }
    return store.create({ projectPath, title: req.body?.title, model: req.body?.model });
  });

  // tasks
  app.get('/api/tasks', async () => store.listTasks());
  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const s = store.get(req.params.id);
    if (!s || s.kind !== 'task') return reply.code(404).send({ error: 'not found' });
    return { ...s, events: store.eventsSince(req.params.id, 0) };
  });
  app.post<{ Body: { project?: string; prompt?: string; model?: string } }>('/api/tasks', async (req, reply) => {
    const { project, prompt, model } = req.body ?? {};
    if (!project || !prompt) return reply.code(400).send({ error: 'project and prompt required' });
    if (model !== undefined && !isValidModel(model)) return reply.code(400).send({ error: 'invalid model' });
    let projectPath: string;
    try {
      projectPath = resolveProjectPath(config.projectsRoot, project);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'invalid project' });
    }
    const id = taskRunner.run({ projectPath, prompt, origin: 'manual', model });
    return { id };
  });

  // cron
  app.get('/api/cron', async () => store.listCron());
  app.post<{ Body: { schedule?: string; project?: string; prompt?: string } }>('/api/cron', async (req, reply) => {
    const { schedule, project, prompt } = req.body ?? {};
    if (!schedule || !project || !prompt) return reply.code(400).send({ error: 'schedule, project, prompt required' });
    if (!Scheduler.isValid(schedule)) return reply.code(400).send({ error: 'invalid cron expression' });
    let projectPath: string;
    try {
      projectPath = resolveProjectPath(config.projectsRoot, project);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'invalid project' });
    }
    const c = store.createCron({ schedule, projectPath, prompt });
    scheduler.reload();
    return c;
  });
  app.patch<{ Params: { id: string }; Body: { enabled?: boolean } }>('/api/cron/:id', async (req, reply) => {
    if (!store.getCron(req.params.id)) return reply.code(404).send({ error: 'not found' });
    if (typeof req.body?.enabled === 'boolean') store.setCronEnabled(req.params.id, req.body.enabled);
    scheduler.reload();
    return store.getCron(req.params.id);
  });
  app.delete<{ Params: { id: string } }>('/api/cron/:id', async (req, reply) => {
    store.deleteCron(req.params.id);
    scheduler.reload();
    return reply.code(204).send();
  });

  // tickets
  app.get('/api/tickets', async () => store.listTickets());
  app.post<{ Body: { title?: string; body?: string; project?: string } }>('/api/tickets', async (req, reply) => {
    const { title, body, project } = req.body ?? {};
    if (!title || !project) return reply.code(400).send({ error: 'title and project required' });
    let projectPath: string;
    try {
      projectPath = resolveProjectPath(config.projectsRoot, project);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'invalid project' });
    }
    return store.createTicket({ title, body, projectPath });
  });
  app.patch<{ Params: { id: string }; Body: { status?: string; pr_url?: string } }>(
    '/api/tickets/:id',
    async (req, reply) => {
      if (!store.getTicket(req.params.id)) return reply.code(404).send({ error: 'not found' });
      store.updateTicket(req.params.id, { status: req.body?.status, pr_url: req.body?.pr_url });
      return store.getTicket(req.params.id);
    },
  );
  app.post<{ Params: { id: string } }>('/api/tickets/:id/run', async (req, reply) => {
    const tk = store.getTicket(req.params.id);
    if (!tk) return reply.code(404).send({ error: 'not found' });
    const prompt = `Work on this ticket.\n\nTitle: ${tk.title}\n\n${tk.body ?? ''}`.trim();
    const sessionId = taskRunner.run({ projectPath: tk.project_path, prompt, origin: 'ticket', title: tk.title });
    store.updateTicket(tk.id, { status: 'running', session_id: sessionId });
    return { session_id: sessionId };
  });

  app.post<{ Body: { sessionId?: string; filename?: string; dataBase64?: string } }>(
    '/api/upload',
    async (req, reply) => {
      const { sessionId, filename, dataBase64 } = req.body ?? {};
      if (!sessionId || !filename || !dataBase64)
        return reply.code(400).send({ error: 'sessionId, filename, dataBase64 required' });
      const sess = store.get(sessionId);
      if (!sess) return reply.code(404).send({ error: 'unknown session' });
      const buf = Buffer.from(dataBase64, 'base64');
      if (buf.length > 10 * 1024 * 1024) return reply.code(413).send({ error: 'file too large (max 10MB)' });

      const base = path.basename(filename).replace(/[^\w.\- ]/g, '_');
      const safe = base === '' || base === '.' || base === '..' ? 'upload.bin' : base;
      const dir = path.resolve(sess.project_path, '.deck-uploads');
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.resolve(dir, safe);
      // Jail: resolved dest must stay strictly under the uploads dir.
      if (dest !== dir && !dest.startsWith(dir + path.sep)) {
        return reply.code(400).send({ error: 'invalid path' });
      }
      fs.writeFileSync(dest, buf);
      return { path: path.relative(sess.project_path, dest) };
    },
  );
}
