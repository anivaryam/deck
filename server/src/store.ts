// server/src/store.ts
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type SessionStatus = 'idle' | 'active' | 'errored';
export type SessionKind = 'chat' | 'task';
export type SessionOrigin = 'manual' | 'cron' | 'ticket';

export interface SessionRow {
  id: string;
  project_path: string;
  title: string | null;
  sdk_session_id: string | null;
  status: SessionStatus;
  kind: SessionKind;
  prompt: string | null;
  origin: SessionOrigin;
  model: string | null;
  effort: string | null;
  /** JSON array of built-in tool names to disable for this session (disallowedTools). */
  disabled_tools: string | null;
  created_at: number;
}

export interface EventRow {
  seq: number;
  session_id: string;
  sdk_uuid: string | null;
  type: string;
  payload: unknown;
  created_at: number;
}

export interface CronRow {
  id: string;
  schedule: string;
  project_path: string;
  prompt: string;
  enabled: number;
  last_run_at: number | null;
  last_session_id: string | null;
  created_at: number;
}

export interface TicketRow {
  id: string;
  title: string;
  body: string | null;
  status: string;
  project_path: string;
  session_id: string | null;
  pr_url: string | null;
  created_at: number;
}

interface AppendInput {
  sdkUuid: string | null;
  type: string;
  payload: unknown;
}

/** Serialize an event payload, never throwing on non-JSON-able SDK values
 *  (BigInt, circular refs) — a serialization quirk must not kill a whole turn. */
function safeStringify(payload: unknown): string {
  try {
    return JSON.stringify(payload) ?? 'null';
  } catch {
    try {
      const seen = new WeakSet();
      return JSON.stringify(payload, (_k, v) => {
        if (typeof v === 'bigint') return v.toString();
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      });
    } catch {
      return JSON.stringify({ __unserializable: true });
    }
  }
}

export class Store {
  private db: Database.Database;
  // Prepared statements are compiled once and reused — better-sqlite3's whole
  // performance model. Recompiling per call (the old pattern) was the hottest waste
  // on the WS streaming path.
  private stmts!: {
    insertSession: Database.Statement;
    insertTask: Database.Statement;
    getSession: Database.Statement;
    listAll: Database.Statement;
    listByKind: Database.Statement;
    insertEvent: Database.Statement;
    eventBySeq: Database.Statement;
    eventsSince: Database.Statement;
    setResume: Database.Statement;
    setStatus: Database.Statement;
    setTitle: Database.Statement;
    setDisabledTools: Database.Statement;
    insertCron: Database.Statement;
    getCron: Database.Statement;
    listCron: Database.Statement;
    listEnabledCron: Database.Statement;
    setCronEnabled: Database.Statement;
    deleteCron: Database.Statement;
    recordCronRun: Database.Statement;
    insertTicket: Database.Statement;
    getTicket: Database.Statement;
    listTickets: Database.Statement;
    listTicketsByProject: Database.Statement;
  };

  constructor(filename = 'claude-deck.sqlite') {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL'); // standard WAL pairing — durable + fast
    this.db.pragma('busy_timeout = 5000'); // wait briefly instead of throwing SQLITE_BUSY
    this.migrate();
    this.prepareStatements();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        title TEXT,
        sdk_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        sdk_uuid TEXT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_event_session_seq ON event(session_id, seq);
    `);

    // Additive columns — check existence via PRAGMA rather than matching error text.
    const existing = new Set(
      (this.db.prepare(`PRAGMA table_info(session)`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    const additions: Array<[string, string]> = [
      ['kind', `ALTER TABLE session ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'`],
      ['prompt', `ALTER TABLE session ADD COLUMN prompt TEXT`],
      ['origin', `ALTER TABLE session ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'`],
      ['model', `ALTER TABLE session ADD COLUMN model TEXT`],
      ['effort', `ALTER TABLE session ADD COLUMN effort TEXT`],
      ['disabled_tools', `ALTER TABLE session ADD COLUMN disabled_tools TEXT`],
    ];
    for (const [name, sql] of additions) {
      if (!existing.has(name)) this.db.exec(sql);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cron (
        id TEXT PRIMARY KEY, schedule TEXT NOT NULL, project_path TEXT NOT NULL,
        prompt TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER, last_session_id TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, status TEXT NOT NULL DEFAULT 'open',
        project_path TEXT NOT NULL, session_id TEXT, pr_url TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ticket_project ON ticket(project_path);
    `);
  }

  private prepareStatements(): void {
    const db = this.db;
    this.stmts = {
      insertSession: db.prepare(
        `INSERT INTO session (id, project_path, title, sdk_session_id, status, kind, prompt, origin, model, effort, disabled_tools, created_at)
         VALUES (?, ?, ?, NULL, 'idle', 'chat', NULL, 'manual', ?, ?, ?, ?)`,
      ),
      insertTask: db.prepare(
        `INSERT INTO session (id, project_path, title, sdk_session_id, status, kind, prompt, origin, model, effort, disabled_tools, created_at)
         VALUES (?, ?, ?, NULL, 'idle', 'task', ?, ?, ?, ?, ?, ?)`,
      ),
      getSession: db.prepare(`SELECT * FROM session WHERE id = ?`),
      listAll: db.prepare(`SELECT * FROM session ORDER BY created_at DESC, rowid DESC`),
      listByKind: db.prepare(`SELECT * FROM session WHERE kind = ? ORDER BY created_at DESC, rowid DESC`),
      insertEvent: db.prepare(
        `INSERT INTO event (session_id, sdk_uuid, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      ),
      eventBySeq: db.prepare(`SELECT * FROM event WHERE seq = ?`),
      eventsSince: db.prepare(`SELECT * FROM event WHERE session_id = ? AND seq > ? ORDER BY seq ASC`),
      setResume: db.prepare(`UPDATE session SET sdk_session_id = ? WHERE id = ?`),
      setStatus: db.prepare(`UPDATE session SET status = ? WHERE id = ?`),
      // Only-if-null: auto-title sets the first title, never clobbers a real one.
      setTitle: db.prepare(`UPDATE session SET title = ? WHERE id = ? AND title IS NULL`),
      setDisabledTools: db.prepare(`UPDATE session SET disabled_tools = ? WHERE id = ?`),
      insertCron: db.prepare(
        `INSERT INTO cron (id, schedule, project_path, prompt, enabled, last_run_at, last_session_id, created_at)
         VALUES (?, ?, ?, ?, 1, NULL, NULL, ?)`,
      ),
      getCron: db.prepare(`SELECT * FROM cron WHERE id = ?`),
      listCron: db.prepare(`SELECT * FROM cron ORDER BY created_at DESC`),
      listEnabledCron: db.prepare(`SELECT * FROM cron WHERE enabled = 1`),
      setCronEnabled: db.prepare(`UPDATE cron SET enabled = ? WHERE id = ?`),
      deleteCron: db.prepare(`DELETE FROM cron WHERE id = ?`),
      recordCronRun: db.prepare(`UPDATE cron SET last_run_at = ?, last_session_id = ? WHERE id = ?`),
      insertTicket: db.prepare(
        `INSERT INTO ticket (id, title, body, status, project_path, session_id, pr_url, created_at)
         VALUES (?, ?, ?, 'open', ?, NULL, NULL, ?)`,
      ),
      getTicket: db.prepare(`SELECT * FROM ticket WHERE id = ?`),
      listTickets: db.prepare(`SELECT * FROM ticket ORDER BY created_at DESC`),
      listTicketsByProject: db.prepare(`SELECT * FROM ticket WHERE project_path = ? ORDER BY created_at DESC`),
    };
  }

  /** Flush WAL and release the file handle. Call on shutdown. */
  close(): void {
    this.db.close();
  }

  create(input: {
    projectPath: string;
    title?: string;
    model?: string;
    effort?: string;
    disabledTools?: string[];
  }): SessionRow {
    const id = randomUUID();
    const created_at = Date.now();
    this.stmts.insertSession.run(
      id,
      input.projectPath,
      input.title ?? null,
      input.model ?? null,
      input.effort ?? null,
      input.disabledTools && input.disabledTools.length ? JSON.stringify(input.disabledTools) : null,
      created_at,
    );
    return this.get(id)!;
  }

  get(id: string): SessionRow | undefined {
    return this.stmts.getSession.get(id) as SessionRow | undefined;
  }

  list(): SessionRow[] {
    return this.stmts.listAll.all() as SessionRow[];
  }

  listSessions(kind: SessionKind): SessionRow[] {
    return this.stmts.listByKind.all(kind) as SessionRow[];
  }

  createTask(input: {
    projectPath: string;
    prompt: string;
    origin: SessionOrigin;
    title?: string;
    model?: string;
    effort?: string;
    disabledTools?: string[];
  }): SessionRow {
    const id = randomUUID();
    const created_at = Date.now();
    this.stmts.insertTask.run(
      id,
      input.projectPath,
      input.title ?? null,
      input.prompt,
      input.origin,
      input.model ?? null,
      input.effort ?? null,
      input.disabledTools && input.disabledTools.length ? JSON.stringify(input.disabledTools) : null,
      created_at,
    );
    return this.get(id)!;
  }

  listTasks(): SessionRow[] {
    return this.listSessions('task');
  }

  appendEvent(sessionId: string, e: AppendInput): EventRow {
    const created_at = Date.now();
    const info = this.stmts.insertEvent.run(sessionId, e.sdkUuid, e.type, safeStringify(e.payload), created_at);
    return this.eventBySeq(Number(info.lastInsertRowid));
  }

  private eventBySeq(seq: number): EventRow {
    const row = this.stmts.eventBySeq.get(seq) as any;
    return { ...row, payload: JSON.parse(row.payload) };
  }

  eventsSince(sessionId: string, seq: number): EventRow[] {
    const rows = this.stmts.eventsSince.all(sessionId, seq) as any[];
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  setResume(id: string, sdkSessionId: string): void {
    this.stmts.setResume.run(sdkSessionId, id);
  }

  /** Set the session title only if it's still null. Returns true if it wrote. */
  setTitle(id: string, title: string): boolean {
    return this.stmts.setTitle.run(title, id).changes > 0;
  }

  setStatus(id: string, status: SessionStatus): void {
    this.stmts.setStatus.run(status, id);
  }

  /** Replace the per-session disabled-tools set. Empty array clears it (null). */
  setDisabledTools(id: string, tools: string[]): void {
    this.stmts.setDisabledTools.run(tools.length ? JSON.stringify(tools) : null, id);
  }

  createCron(i: { schedule: string; projectPath: string; prompt: string }): CronRow {
    const id = randomUUID();
    this.stmts.insertCron.run(id, i.schedule, i.projectPath, i.prompt, Date.now());
    return this.getCron(id)!;
  }

  getCron(id: string): CronRow | undefined {
    return this.stmts.getCron.get(id) as CronRow | undefined;
  }

  listCron(): CronRow[] {
    return this.stmts.listCron.all() as CronRow[];
  }

  listEnabledCron(): CronRow[] {
    return this.stmts.listEnabledCron.all() as CronRow[];
  }

  setCronEnabled(id: string, on: boolean): void {
    this.stmts.setCronEnabled.run(on ? 1 : 0, id);
  }

  deleteCron(id: string): void {
    this.stmts.deleteCron.run(id);
  }

  recordCronRun(id: string, sessionId: string): void {
    this.stmts.recordCronRun.run(Date.now(), sessionId, id);
  }

  createTicket(i: { title: string; body?: string; projectPath: string }): TicketRow {
    const id = randomUUID();
    this.stmts.insertTicket.run(id, i.title, i.body ?? null, i.projectPath, Date.now());
    return this.getTicket(id)!;
  }

  getTicket(id: string): TicketRow | undefined {
    return this.stmts.getTicket.get(id) as TicketRow | undefined;
  }

  listTickets(): TicketRow[] {
    return this.stmts.listTickets.all() as TicketRow[];
  }

  listTicketsByProject(projectPath: string): TicketRow[] {
    return this.stmts.listTicketsByProject.all(projectPath) as TicketRow[];
  }

  updateTicket(
    id: string,
    p: Partial<Pick<TicketRow, 'status' | 'session_id' | 'pr_url' | 'title' | 'body'>>,
  ): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of ['status', 'session_id', 'pr_url', 'title', 'body'] as const) {
      if (p[k] !== undefined) {
        sets.push(`${k} = ?`);
        vals.push(p[k]);
      }
    }
    if (!sets.length) return;
    vals.push(id);
    // Column names are a fixed allowlist above — safe to interpolate.
    this.db.prepare(`UPDATE ticket SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
}
