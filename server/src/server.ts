// server/src/server.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.ts';
import { Store } from './store.ts';
import { SessionManager } from './sessionManager.ts';
import { MemoryMiner } from './memoryMiner.ts';
import { TaskRunner } from './taskRunner.ts';
import { Scheduler } from './scheduler.ts';
import { registerRoutes } from './routes.ts';
import { registerWs } from './wsHub.ts';
import { AuthSessions } from './auth.ts';
import { registerTicketAutomation } from './ticketAutomation.ts';
import { SinglePassExecutor, registerGoalAutomation } from './goalRunner.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const config = loadConfig(); // throws + exits non-zero if misconfigured
  const store = new Store(process.env.DECK_DB || 'claude-deck.sqlite');
  const miner = new MemoryMiner(store, config);
  const manager = new SessionManager(store, config, undefined, miner);
  const disposeTicketAutomation = registerTicketAutomation(manager, store);
  const taskRunner = new TaskRunner(store, manager, 6, { model: config.taskModel, effort: config.taskEffort });
  // Goal worktrees live OUTSIDE any project (never nested in deck or the target
  // repo). Override with DECK_GOALS_DIR. addWorktree() creates this on first use.
  const worktreesDir = process.env.DECK_GOALS_DIR || path.join(os.homedir(), '.deck', 'goal-worktrees');
  const goalExecutor = new SinglePassExecutor(store, taskRunner, worktreesDir);
  const disposeGoalAutomation = registerGoalAutomation(manager, store, goalExecutor);
  const scheduler = new Scheduler(store, taskRunner);
  const auth = new AuthSessions(config.sessionTtlMs);

  const app = Fastify({
    // Redact secrets if request logging is ever expanded; covers the auth cookie
    // (which carries the session id) and bearer headers.
    logger: { redact: ['req.headers.cookie', 'req.headers.authorization'] },
    // Base64 inflates ~33%; allow the documented 10MB upload + framing overhead.
    bodyLimit: 20 * 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(websocket);

  const ws = registerWs(app, { store, manager, config, auth });
  registerRoutes(app, { store, config, taskRunner, scheduler, auth, manager, closeRoom: ws.closeRoom, goalExecutor });

  // Serve the built SPA if present (production single-port mode)
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html'); // SPA fallback
    });
  }

  // Graceful shutdown: stop cron timers, close the HTTP server, flush + close the DB.
  // Without this, every restart leaked croner timers and left the WAL uncheckpointed.
  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`received ${sig}, shutting down`);
    try {
      scheduler.stop();
    } catch (e) {
      app.log.error(e);
    }
    // Detach manager event listeners so the automations + WS hub don't outlive
    // the server (prevents handler leaks across reinstantiation).
    try {
      disposeTicketAutomation();
      disposeGoalAutomation();
      ws.dispose();
    } catch (e) {
      app.log.error(e);
    }
    try {
      await app.close();
    } catch (e) {
      app.log.error(e);
    }
    try {
      store.close();
    } catch (e) {
      app.log.error(e);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: '127.0.0.1', port: config.port });
  // Repair sessions stranded 'active' by a prior crash BEFORE the scheduler reloads —
  // otherwise the cron in-flight guard treats a dead session as running and that cron
  // never fires again.
  const repaired = store.reconcileActiveSessions();
  if (repaired) app.log.warn(`reconciled ${repaired} stale active session(s) from a prior crash`);
  scheduler.reload();
  app.log.info('scheduler started');
  app.log.info(`claude-deck listening on http://127.0.0.1:${config.port}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
