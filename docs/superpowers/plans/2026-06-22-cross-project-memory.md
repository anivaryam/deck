# Cross-project learned memory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give deck a persistent, FTS-backed knowledge store so the agent auto-records durable project/global facts and every new session (interactive, cron, task, goal) is primed with them and can query facts learned in other projects.

**Architecture:** New `knowledge` table + `knowledge_fts` (FTS5 external-content) in deck's existing SQLite. Three model-callable MCP tools (`remember` / `recall` / `forget`) added to the in-process `deck` server. At session spawn, scoped facts (global + this project) are appended to the system prompt alongside a capture-policy rule. Scope keys off `project_path`, never `cwd`, so goal runs in detached worktrees still load their home project's facts.

**Tech Stack:** TypeScript, better-sqlite3 (SQLite FTS5), @anthropic-ai/claude-agent-sdk, zod, vitest.

---

## File structure

| File | Responsibility |
|------|----------------|
| `server/src/store.ts` (modify) | `knowledge` table + FTS5 + triggers in `migrate()`; prepared stmts; `rememberFact` / `recallFacts` / `forgetFact` / `loadScopedFacts`; `KnowledgeKind` / `KnowledgeRow` types. |
| `server/src/deckTools.ts` (modify) | `looksLikeSecret` guard; `rememberHandler` / `recallHandler` / `forgetHandler`; register the three tools in `buildDeckMcp`; extend `deckToolNames`. |
| `server/src/sessionManager.ts` (modify) | `CAPTURE_RULE` constant + `formatMemoryBlock`; append scoped facts + rule to `systemPrompt.append` keyed on `sess.project_path`. |
| `server/test/store.knowledge.test.ts` (create) | Store CRUD, supersede, scoping, FTS recall. |
| `server/test/deckTools.knowledge.test.ts` (create) | Secret guard, the three handlers, scope mapping. |
| `server/test/sessionManager.memory.test.ts` (create) | Injection: scoped facts land in `systemPrompt.append`, keyed on project_path not cwd. |

**Verify commands** (from memory `deck-verify-commands`): server tests run with `npm --prefix server test`. Typecheck (do NOT rely on vite build) with `npm --prefix server run typecheck` if present, else `bunx tsc --noEmit` in `server/`.

**One deliberate simplification vs. the spec** (ponytail): the spec proposed a dedicated `🧠 learned` *event row* for the trust chip. We drop it. The `remember` tool call already streams into the deck transcript as a visible tool-use block — that IS the live visibility, for free. `forget` is the correction path. No `sessionId` plumbing into `buildDeckMcp`, no soft-delete flag. `// ponytail: tool-call rendering is the chip; add a styled event row only if the raw tool block proves unclear.`

---

## Task 1: `knowledge` table + core store CRUD (no FTS yet)

**Files:**
- Modify: `server/src/store.ts` (types near line 9; `migrate()` ~line 244; `prepareStatements()` ~line 313; new methods after `deleteGoal` ~line 578)
- Test: `server/test/store.knowledge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/store.knowledge.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('Store knowledge CRUD', () => {
  it('remembers a fact and loads it by scope', () => {
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'error-msgs', fact: 'user wants explicit user-facing error messages' });
    store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'github-account', fact: 'alpha pushes to acme-bot' });
    const alpha = store.loadScopedFacts('/p/alpha');
    expect(alpha.map((f) => f.fact).sort()).toEqual([
      'alpha pushes to acme-bot',
      'user wants explicit user-facing error messages',
    ]);
  });

  it('loadScopedFacts excludes other projects but always includes global', () => {
    store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'k', fact: 'alpha-only' });
    store.rememberFact({ scope: '/p/beta', kind: 'binding', key: 'k', fact: 'beta-only' });
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'g', fact: 'everywhere' });
    const beta = store.loadScopedFacts('/p/beta');
    const facts = beta.map((f) => f.fact);
    expect(facts).toContain('beta-only');
    expect(facts).toContain('everywhere');
    expect(facts).not.toContain('alpha-only');
  });

  it('re-remembering the same (scope,key) supersedes, never duplicates', () => {
    store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'github-account', fact: 'old: personal' });
    store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'github-account', fact: 'new: acme-bot' });
    const facts = store.loadScopedFacts('/p/alpha');
    expect(facts.length).toBe(1);
    expect(facts[0].fact).toBe('new: acme-bot');
  });

  it('NULL-key facts coexist (free-form, never collide)', () => {
    store.rememberFact({ scope: 'global', kind: 'preference', fact: 'fact one' });
    store.rememberFact({ scope: 'global', kind: 'preference', fact: 'fact two' });
    expect(store.loadScopedFacts('/p/alpha').length).toBe(2);
  });

  it('forgetFact removes a fact by (scope,key) and reports whether it hit', () => {
    store.rememberFact({ scope: '/p/alpha', kind: 'rule', key: 'no-claude-md', fact: 'never commit CLAUDE.md' });
    expect(store.forgetFact('/p/alpha', 'no-claude-md')).toBe(true);
    expect(store.forgetFact('/p/alpha', 'no-claude-md')).toBe(false);
    expect(store.loadScopedFacts('/p/alpha').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- store.knowledge`
Expected: FAIL — `store.rememberFact is not a function`.

- [ ] **Step 3: Add types**

In `server/src/store.ts`, after line 9 (`export type SessionOrigin = ...`), add:

```ts
export type KnowledgeKind = 'binding' | 'convention' | 'rule' | 'preference' | 'infra';

export interface KnowledgeRow {
  id: number;
  scope: string;            // 'global' | <project_path>
  kind: KnowledgeKind;
  key: string | null;       // natural key for supersede; NULL = free-form
  fact: string;
  source_session: string | null;
  created_at: number;
  updated_at: number;
}
```

- [ ] **Step 4: Create the table in `migrate()`**

In `server/src/store.ts`, at the end of `migrate()` (after the goal ALTERs, ~line 252, before the closing `}`), add:

```ts
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id INTEGER PRIMARY KEY,
        scope TEXT NOT NULL,
        kind TEXT NOT NULL,
        key TEXT,
        fact TEXT NOT NULL,
        source_session TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      -- Partial unique index: supersede only applies to keyed facts. NULL keys are
      -- free-form and must be allowed to coexist (SQLite treats NULLs as distinct,
      -- but a partial index makes the intent explicit and ON CONFLICT precise).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_scope_key
        ON knowledge(scope, key) WHERE key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge(scope);
    `);
```

- [ ] **Step 5: Add prepared statements**

In `server/src/store.ts`, add these fields to the `stmts!` type block (after `listRunsForSource`, ~line 156):

```ts
    upsertKnowledge: Database.Statement;
    deleteKnowledge: Database.Statement;
    loadScopedKnowledge: Database.Statement;
```

Then in `prepareStatements()`, before the closing `};` of `this.stmts = {...}` (~line 315), add:

```ts
      // ON CONFLICT targets the partial unique index (scope,key) — keyed facts
      // supersede in place; NULL-key facts always insert fresh.
      upsertKnowledge: db.prepare(
        `INSERT INTO knowledge (scope, kind, key, fact, source_session, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope, key) WHERE key IS NOT NULL
         DO UPDATE SET kind = excluded.kind, fact = excluded.fact,
                       source_session = excluded.source_session, updated_at = excluded.updated_at`,
      ),
      deleteKnowledge: db.prepare(`DELETE FROM knowledge WHERE scope = ? AND key = ?`),
      loadScopedKnowledge: db.prepare(
        `SELECT * FROM knowledge WHERE scope = 'global' OR scope = ?
         ORDER BY scope, kind, updated_at DESC`,
      ),
```

- [ ] **Step 6: Add the methods**

In `server/src/store.ts`, after `deleteGoal()` (~line 578), before the class closing `}`, add:

```ts
  rememberFact(i: {
    scope: string;
    kind: KnowledgeKind;
    key?: string | null;
    fact: string;
    sourceSession?: string | null;
  }): KnowledgeRow {
    const now = Date.now();
    this.stmts.upsertKnowledge.run(
      i.scope, i.kind, i.key ?? null, String(i.fact), i.sourceSession ?? null, now, now,
    );
    // Return the canonical row (the upserted one) by scope+key when keyed; for
    // NULL-key inserts, fetch the most recent matching fact.
    const row = i.key != null
      ? this.db.prepare(`SELECT * FROM knowledge WHERE scope = ? AND key = ?`).get(i.scope, i.key)
      : this.db.prepare(`SELECT * FROM knowledge WHERE scope = ? AND key IS NULL ORDER BY id DESC LIMIT 1`).get(i.scope);
    return row as KnowledgeRow;
  }

  loadScopedFacts(projectPath: string): KnowledgeRow[] {
    return this.stmts.loadScopedKnowledge.all(projectPath) as KnowledgeRow[];
  }

  /** Remove a keyed fact. Returns true if a row was deleted. */
  forgetFact(scope: string, key: string): boolean {
    return this.stmts.deleteKnowledge.run(scope, key).changes > 0;
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm --prefix server test -- store.knowledge`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add server/src/store.ts server/test/store.knowledge.test.ts
git commit -m "feat(store): knowledge table with scoped facts + supersede"
```

---

## Task 2: FTS5 recall across all scopes

**Files:**
- Modify: `server/src/store.ts` (`migrate()` knowledge block; `prepareStatements()`; new `recallFacts`)
- Test: `server/test/store.knowledge.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `server/test/store.knowledge.test.ts`:

```ts
describe('Store knowledge FTS recall', () => {
  beforeEach(() => {
    store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'stripe', fact: 'alpha wired Stripe webhooks via the CLI' });
    store.rememberFact({ scope: '/p/beta', kind: 'convention', key: 'ci', fact: 'beta runs lint on push' });
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'db', fact: 'prefers SQLite FTS over vector databases' });
  });

  it('recallFacts finds a fact from ANY scope (cross-project query)', () => {
    const hits = store.recallFacts('stripe webhooks');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].fact).toContain('Stripe');
  });

  it('recallFacts matches across scope boundaries from a different project', () => {
    const hits = store.recallFacts('vector database');
    expect(hits.map((h) => h.fact).join(' ')).toContain('SQLite FTS');
  });

  it('recallFacts returns [] for an empty or blank query (no FTS syntax error)', () => {
    expect(store.recallFacts('')).toEqual([]);
    expect(store.recallFacts('   ')).toEqual([]);
  });

  it('recallFacts does not throw on punctuation-only / quote input', () => {
    expect(() => store.recallFacts('"); drop')).not.toThrow();
  });

  it('forgetFact also drops the fact from FTS (no stale recall)', () => {
    store.forgetFact('/p/alpha', 'stripe');
    expect(store.recallFacts('stripe webhooks')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- store.knowledge`
Expected: FAIL — `store.recallFacts is not a function`.

- [ ] **Step 3: Add the FTS table + sync triggers**

In `server/src/store.ts`, inside the knowledge `this.db.exec(...)` added in Task 1, append (still inside the same template string, after the indexes):

```sql
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
        USING fts5(fact, content='knowledge', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
        INSERT INTO knowledge_fts(rowid, fact) VALUES (new.id, new.fact);
      END;
      CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, fact) VALUES ('delete', old.id, old.fact);
      END;
      CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, fact) VALUES ('delete', old.id, old.fact);
        INSERT INTO knowledge_fts(rowid, fact) VALUES (new.id, new.fact);
      END;
```

- [ ] **Step 4: Add the recall prepared statement**

In the `stmts!` type block add:

```ts
    searchKnowledge: Database.Statement;
```

In `prepareStatements()` add (next to the other knowledge stmts):

```ts
      searchKnowledge: db.prepare(
        `SELECT k.* FROM knowledge_fts f JOIN knowledge k ON k.id = f.rowid
         WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?`,
      ),
```

- [ ] **Step 5: Add `recallFacts`**

In `server/src/store.ts`, after `forgetFact` (added in Task 1), add:

```ts
  /** Full-text search facts across ALL scopes (cross-project recall).
   *  Tokenizes free text and OR-joins quoted terms so arbitrary user input —
   *  including FTS metacharacters — can never produce a MATCH syntax error.
   *  ponytail: keyword OR-match is enough at this scale; sqlite-vec only if it misses. */
  recallFacts(query: string, limit = 10): KnowledgeRow[] {
    const terms = (query ?? '')
      .split(/\s+/)
      .map((t) => t.replace(/["*]/g, '').trim())
      .filter(Boolean)
      .map((t) => `"${t}"`);
    if (!terms.length) return [];
    return this.stmts.searchKnowledge.all(terms.join(' OR '), limit) as KnowledgeRow[];
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm --prefix server test -- store.knowledge`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 7: Commit**

```bash
git add server/src/store.ts server/test/store.knowledge.test.ts
git commit -m "feat(store): FTS5 cross-scope recall for knowledge"
```

---

## Task 3: Secret-shaped-input guard

**Files:**
- Modify: `server/src/deckTools.ts` (add exported `looksLikeSecret` near top, after `PR_URL` ~line 7)
- Test: `server/test/deckTools.knowledge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/deckTools.knowledge.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { looksLikeSecret } from '../src/deckTools.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('looksLikeSecret', () => {
  it('flags common credential shapes', () => {
    expect(looksLikeSecret('token is ghp_<fake-36char-PAT-built-at-runtime-in-test>')).toBe(true);
    expect(looksLikeSecret('github_pat_<fake-fine-grained-PAT>')).toBe(true);
    expect(looksLikeSecret('use sk-<fake-openai-style-key>')).toBe(true);
    expect(looksLikeSecret('slack xoxb-<fake-slack-token>')).toBe(true);
    expect(looksLikeSecret('AKIA<fake-aws-key-id>')).toBe(true);
    expect(looksLikeSecret('password=hunter2longenoughvalue')).toBe(true);
    expect(looksLikeSecret('eyJ<fake>.<jwt>.<token>')).toBe(true);
  });

  it('does NOT flag plain reference facts', () => {
    expect(looksLikeSecret('alpha pushes to GitHub account acme-bot')).toBe(false);
    expect(looksLikeSecret('uses Supabase MCP project ref staging-xyz')).toBe(false);
    expect(looksLikeSecret('user wants explicit user-facing error messages')).toBe(false);
    expect(looksLikeSecret('typecheck = bun run typecheck')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- deckTools.knowledge`
Expected: FAIL — `looksLikeSecret is not exported`.

- [ ] **Step 3: Implement `looksLikeSecret`**

In `server/src/deckTools.ts`, after the `PR_URL` constant (line 7), add:

```ts
/** Heuristic reject for credential-shaped text. The knowledge store must hold
 *  references ("uses GH account acme-bot"), never secrets. False positives are
 *  acceptable — the model is told to store a reference instead. */
const SECRET_PATTERNS: RegExp[] = [
  /\bghp_[A-Za-z0-9]{36}\b/,                    // GitHub classic PAT
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,           // GitHub fine-grained PAT
  /\bsk-[A-Za-z0-9]{20,}\b/,                     // OpenAI-style key
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,           // Slack token
  /\bAKIA[0-9A-Z]{16}\b/,                        // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S{6,}/i,   // assignment
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text ?? ''));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- deckTools.knowledge`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/deckTools.ts server/test/deckTools.knowledge.test.ts
git commit -m "feat(deckTools): secret-shaped-input guard for knowledge capture"
```

---

## Task 4: `remember` / `recall` / `forget` MCP tools

**Files:**
- Modify: `server/src/deckTools.ts` (handlers after `looksLikeSecret`; register tools in `buildDeckMcp` ~line 89; extend `deckToolNames` ~line 65)
- Test: `server/test/deckTools.knowledge.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `server/test/deckTools.knowledge.test.ts`:

```ts
import { rememberHandler, recallHandler, forgetHandler, buildDeckMcp, deckToolNames } from '../src/deckTools.ts';

describe('knowledge MCP handlers', () => {
  it('rememberHandler with scope=project stores under the bound project_path', async () => {
    const res = await rememberHandler(store, '/p/alpha', { fact: 'alpha pushes to acme-bot', kind: 'binding', scope: 'project', key: 'github-account' });
    expect(res.content[0].text).toMatch(/remembered/i);
    const facts = store.loadScopedFacts('/p/alpha');
    expect(facts.length).toBe(1);
    expect(facts[0].scope).toBe('/p/alpha');
    expect(facts[0].kind).toBe('binding');
  });

  it('rememberHandler with scope=global stores globally', async () => {
    await rememberHandler(store, '/p/alpha', { fact: 'prefers SQLite FTS', kind: 'preference', scope: 'global', key: 'db' });
    expect(store.loadScopedFacts('/p/other').some((f) => f.fact === 'prefers SQLite FTS')).toBe(true);
  });

  it('rememberHandler rejects secret-shaped facts without storing', async () => {
    const res = await rememberHandler(store, '/p/alpha', { fact: 'token ghp_<fake-36char-PAT-built-at-runtime-in-test>', kind: 'binding', scope: 'project', key: 'tok' });
    expect(res.content[0].text).toMatch(/reference, not the secret|not stored/i);
    expect(store.loadScopedFacts('/p/alpha').length).toBe(0);
  });

  it('recallHandler finds facts from other projects', async () => {
    store.rememberFact({ scope: '/p/beta', kind: 'binding', key: 'stripe', fact: 'beta wired Stripe webhooks' });
    const res = await recallHandler(store, { query: 'stripe webhooks' });
    expect(res.content[0].text).toContain('Stripe');
  });

  it('recallHandler reports none cleanly', async () => {
    const res = await recallHandler(store, { query: 'nonexistent topic xyz' });
    expect(res.content[0].text).toBe('(no matching facts)');
  });

  it('forgetHandler removes a project-scoped fact', async () => {
    store.rememberFact({ scope: '/p/alpha', kind: 'rule', key: 'no-claude-md', fact: 'never commit CLAUDE.md' });
    const res = await forgetHandler(store, '/p/alpha', { scope: 'project', key: 'no-claude-md' });
    expect(res.content[0].text).toMatch(/forgotten/i);
    expect(store.loadScopedFacts('/p/alpha').length).toBe(0);
  });

  it('deckToolNames always includes remember/recall/forget', () => {
    expect(deckToolNames()).toEqual(expect.arrayContaining(['remember', 'recall', 'forget']));
  });

  it('buildDeckMcp builds with the knowledge tools without throwing', () => {
    expect(buildDeckMcp(store, '/p/alpha')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- deckTools.knowledge`
Expected: FAIL — `rememberHandler is not exported`.

- [ ] **Step 3: Implement the three handlers**

In `server/src/deckTools.ts`, after `looksLikeSecret`, add (import the `KnowledgeKind` type at the top: change line 3 to `import type { Store, KnowledgeKind } from './store.ts';`):

```ts
const KNOWLEDGE_KINDS = ['binding', 'convention', 'rule', 'preference', 'infra'] as const;

/** Map the tool's 'global' | 'project' choice to an actual scope string. */
function resolveScope(scope: 'global' | 'project', projectPath: string): string {
  return scope === 'global' ? 'global' : projectPath;
}

export async function rememberHandler(
  store: Store, projectPath: string,
  args: { fact: string; kind: KnowledgeKind; scope: 'global' | 'project'; key?: string },
): Promise<ToolResult> {
  if (looksLikeSecret(args.fact)) {
    return { content: [{ type: 'text', text: 'Not stored: that looks like a credential. Record the reference, not the secret (e.g. "uses GH account acme-bot", never the token).' }] };
  }
  const row = store.rememberFact({
    scope: resolveScope(args.scope, projectPath),
    kind: args.kind,
    key: args.key ?? null,
    fact: args.fact,
  });
  return { content: [{ type: 'text', text: `Remembered (${row.kind}, ${row.scope === 'global' ? 'global' : 'this project'}): ${row.fact}` }] };
}

export async function recallHandler(
  store: Store, args: { query: string },
): Promise<ToolResult> {
  const hits = store.recallFacts(args.query);
  if (!hits.length) return { content: [{ type: 'text', text: '(no matching facts)' }] };
  const text = hits
    .map((h) => `- [${h.kind}/${h.scope === 'global' ? 'global' : 'project'}] ${h.fact}`)
    .join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function forgetHandler(
  store: Store, projectPath: string,
  args: { scope: 'global' | 'project'; key: string },
): Promise<ToolResult> {
  const hit = store.forgetFact(resolveScope(args.scope, projectPath), args.key);
  return { content: [{ type: 'text', text: hit ? `Forgotten: ${args.key}` : `No fact found for key "${args.key}" in that scope.` }] };
}
```

- [ ] **Step 4: Extend `deckToolNames`**

In `server/src/deckTools.ts`, change the `names` array in `deckToolNames` (line 66) from:

```ts
  const names = ['create_ticket', 'list_tickets'];
```

to:

```ts
  const names = ['create_ticket', 'list_tickets', 'remember', 'recall', 'forget'];
```

- [ ] **Step 5: Register the tools in `buildDeckMcp`**

In `server/src/deckTools.ts`, inside `buildDeckMcp`, append three entries to the base `tools` array (after the `list_tickets` tool object, before the `if (ticketId)` block, ~line 89):

```ts
    tool(
      'remember',
      'Record a durable fact for future sessions. Use PROACTIVELY (no user request needed) when you learn something that (1) is true beyond this session, (2) is NOT derivable from the repo/git/CLAUDE.md, and (3) would change how a future session acts. Examples: which GitHub/MCP/cloud account a project uses (binding), a build/PR/commit convention, a do/don\'t rule, a standing user preference (clear error messages, show loading/empty/error states, terse output), or an infra binding. Use scope=project for facts about THIS project only; scope=global for cross-project user preferences. NEVER store secrets/tokens/keys — store the reference (account NAME, not the credential). Capture only at stated/confirmed/observed confidence.',
      {
        fact: z.string().describe('One fact, plain language, no secrets'),
        kind: z.enum(KNOWLEDGE_KINDS).describe('binding | convention | rule | preference | infra'),
        scope: z.enum(['global', 'project']).describe('project = this project only; global = every project'),
        key: z.string().optional().describe('Stable natural key so re-recording supersedes instead of duplicating, e.g. "github-account". Omit for free-form facts.'),
      },
      async (args) => rememberHandler(store, projectPath, args as { fact: string; kind: KnowledgeKind; scope: 'global' | 'project'; key?: string }),
    ),
    tool(
      'recall',
      'Search facts learned in ANY project (including other projects) by keyword. Use when you suspect you handled something similar before — e.g. "have I set up Stripe webhooks elsewhere?".',
      { query: z.string().describe('Keywords to search learned facts') },
      async (args) => recallHandler(store, args),
    ),
    tool(
      'forget',
      'Delete a previously remembered fact by its scope and key (use when a fact is wrong or stale).',
      {
        scope: z.enum(['global', 'project']).describe('Where the fact lives'),
        key: z.string().describe('The key the fact was stored under'),
      },
      async (args) => forgetHandler(store, projectPath, args as { scope: 'global' | 'project'; key: string }),
    ),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm --prefix server test -- deckTools.knowledge`
Expected: PASS (all Task 3 + Task 4 tests).

- [ ] **Step 7: Commit**

```bash
git add server/src/deckTools.ts server/test/deckTools.knowledge.test.ts
git commit -m "feat(deckTools): remember/recall/forget knowledge tools"
```

---

## Task 5: Inject scoped facts + capture rule into the system prompt

**Files:**
- Modify: `server/src/sessionManager.ts` (add `CAPTURE_RULE` + `formatMemoryBlock` near `ARTIFACT_SYSTEM_PROMPT` ~line 25; change `systemPrompt.append` at line 160)
- Test: `server/test/sessionManager.memory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/sessionManager.memory.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { SessionManager } from '../src/sessionManager.ts';

let store: Store;
const cfg = { token: 't', projectsRoot: '/p', port: 1, model: 'claude-opus-4-8' } as any;
beforeEach(() => { store = new Store(':memory:'); });

function captureOptions() {
  const seen: any = {};
  const queryFn = ({ options }: any) => {
    Object.assign(seen, options);
    return (async function* () { /* no events */ })();
  };
  return { seen, queryFn };
}

describe('sessionManager memory injection', () => {
  it('appends global + this-project facts to the system prompt', async () => {
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'err', fact: 'always show clear error messages' });
    store.rememberFact({ scope: '/proj', kind: 'binding', key: 'gh', fact: 'proj pushes to acme-bot' });
    store.rememberFact({ scope: '/other', kind: 'binding', key: 'gh', fact: 'other pushes to evil-bot' });

    const { seen, queryFn } = captureOptions();
    const mgr = new SessionManager(store, cfg, queryFn);
    const s = store.create({ projectPath: '/proj' });
    await mgr.send(s.id, 'hello');

    const append: string = seen.systemPrompt.append;
    expect(append).toContain('always show clear error messages');
    expect(append).toContain('proj pushes to acme-bot');
    expect(append).not.toContain('evil-bot');           // other project's fact must not leak
    expect(append).toContain('Learned memory');          // header present
  });

  it('scopes by project_path, not cwd (goal worktree still gets home-project facts)', async () => {
    store.rememberFact({ scope: '/proj', kind: 'rule', key: 'r', fact: 'never commit CLAUDE.md here' });
    const { seen, queryFn } = captureOptions();
    const mgr = new SessionManager(store, cfg, queryFn);
    // Goal run: cwd is a detached worktree OUTSIDE the project, project_path is home.
    const s = store.createTask({ projectPath: '/proj', prompt: 'p', origin: 'goal', sourceKind: 'goal', cwd: '/home/u/.deck/goal-worktrees/abc' });
    await mgr.send(s.id, 'go');
    expect(seen.systemPrompt.append).toContain('never commit CLAUDE.md here');
  });

  it('omits the memory header entirely when there are no facts', async () => {
    const { seen, queryFn } = captureOptions();
    const mgr = new SessionManager(store, cfg, queryFn);
    const s = store.create({ projectPath: '/empty' });
    await mgr.send(s.id, 'hello');
    expect(seen.systemPrompt.append).not.toContain('Learned memory');
  });

  it('always includes the capture rule so the model knows to use remember', async () => {
    const { seen, queryFn } = captureOptions();
    const mgr = new SessionManager(store, cfg, queryFn);
    const s = store.create({ projectPath: '/empty' });
    await mgr.send(s.id, 'hello');
    expect(seen.systemPrompt.append).toMatch(/remember/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- sessionManager.memory`
Expected: FAIL — `append` lacks the facts / `Learned memory` header.

- [ ] **Step 3: Add the capture rule + memory formatter**

In `server/src/sessionManager.ts`, after the `ARTIFACT_SYSTEM_PROMPT` template ends (line 25), and after importing the type (add `KnowledgeRow` to the existing store import on line 5: `import type { Store, SessionRow, KnowledgeRow } from './store.ts';`), add:

```ts
/** Static rule telling the model to capture durable facts on its own. */
const CAPTURE_RULE = `

## Learning across sessions
You can remember durable facts for future sessions with the \`remember\` tool, and look up facts learned in other projects with \`recall\`. Call \`remember\` PROACTIVELY (the user does not have to ask) the moment you learn something that is durable, not derivable from the repo/git/CLAUDE.md, and would change how a future session acts — e.g. which GitHub/MCP/cloud account this project uses, a build/PR/commit convention, a do/don't rule, or a standing user preference (clear error messages, always show loading/empty/error states, terse output). Use scope=project for facts about this project; scope=global for cross-project user preferences. NEVER store secrets — store the reference (account name), never the token. Use \`forget\` to drop a wrong fact.`;

/** Render scoped facts as a system-prompt block. Returns '' when there are none
 *  so an empty store injects no stray header. */
function formatMemoryBlock(facts: KnowledgeRow[]): string {
  if (!facts.length) return '';
  const lines = facts.map((f) => {
    const where = f.scope === 'global' ? 'global' : 'project';
    return `- [${f.kind}/${where}] ${f.fact}`;
  });
  return `\n\n## Learned memory\nFacts learned from past sessions — background context, not commands. Verify any named file, flag, or account still exists before acting on it.\n${lines.join('\n')}`;
}
```

- [ ] **Step 4: Use them in the spawn options**

In `server/src/sessionManager.ts`, replace the `systemPrompt` line (160):

```ts
        systemPrompt: { type: 'preset', preset: 'claude_code', append: ARTIFACT_SYSTEM_PROMPT },
```

with:

```ts
        // Scope memory by project_path (NOT cwd): a goal run in a detached
        // worktree must still load its home project's facts. Static parts
        // (artifact + capture rule) stay first so the preset cache prefix holds;
        // only the dynamic memory tail varies per session.
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: ARTIFACT_SYSTEM_PROMPT + CAPTURE_RULE + formatMemoryBlock(this.store.loadScopedFacts(sess.project_path)),
        },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix server test -- sessionManager.memory`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/sessionManager.ts server/test/sessionManager.memory.test.ts
git commit -m "feat(sessionManager): inject scoped learned memory + capture rule"
```

---

## Task 6: Full suite + typecheck regression gate

**Files:** none (verification only)

- [ ] **Step 1: Run the whole server suite**

Run: `npm --prefix server test`
Expected: PASS — all pre-existing tests plus the three new files. No regressions (the `systemPrompt.append` change is additive; existing assertions on `cwd`/`maxTurns`/`mcpServers` are unaffected).

- [ ] **Step 2: Typecheck**

Run: `npm --prefix server run typecheck` (per memory `deck-verify-commands`; if no such script, run `bunx tsc --noEmit` inside `server/`).
Expected: no errors.

- [ ] **Step 3: Commit (only if either step required a fix)**

```bash
git add -A
git commit -m "test: green suite + typecheck for cross-project memory"
```

---

## Self-review

**Spec coverage:**
- Data model (knowledge table, two scope tiers, supersede) → Task 1. ✓
- FTS5 recall across all scopes → Task 2. ✓
- Model-driven capture (`remember`) + recall + forget tools, proactive capture rule → Task 4 + Task 5 Step 3. ✓
- Taxonomy (binding/convention/rule/preference/infra), design/UX preferences as global → encoded in the `remember` tool description + `CAPTURE_RULE`. ✓
- Inject-all at spawn, covers cron/task/goal (single spawn path) → Task 5. ✓
- Scope by `project_path` not `cwd` → Task 5 Step 4 + dedicated test. ✓
- Secrets boundary (tool description forbids + regex reject) → Task 3 + Task 4 Step 3. ✓
- Trust UX → simplified to tool-call visibility (documented deviation at top); `forget` is the correction path. ✓
- Skipped: vector DB, TTL/decay, post-session miner → not implemented, by design. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `KnowledgeKind` / `KnowledgeRow` defined in Task 1 and imported in deckTools (Task 4) and sessionManager (Task 5). Method names consistent across tasks: `rememberFact`, `recallFacts`, `forgetFact`, `loadScopedFacts`; handlers `rememberHandler`/`recallHandler`/`forgetHandler`; `looksLikeSecret`; `resolveScope`. Tool names `remember`/`recall`/`forget` match `deckToolNames`. ✓
```
