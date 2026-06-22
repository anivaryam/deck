# Memory miner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Problem:** The knowledge store stays empty — across 89 real sessions the model invoked `remember` only ~2× (both test calls). Capture-by-model-judgment is too sparse (the spec's named escalation trigger).

**Goal:** Auto-fill memory reliably without relying on in-turn model discipline: after each completed turn, a cheap-model pass extracts durable facts from the new transcript delta and persists them. Plus a stronger inline capture rule.

**Architecture:** A self-contained `MemoryMiner` (one responsibility: delta-transcript → facts → store). Triggered fire-and-forget from `SessionManager` on the success-finish path, so it never blocks or breaks a turn. A per-session `mined_seq` watermark makes it incremental (mine only new events) and idempotent. Reuses `looksLikeSecret` (guard) and `rememberFact`'s supersede-by-`(scope,key)` (dedup); finally populates `source_session` provenance. Extraction uses an injected query function → unit-testable with canned JSON, no network.

**Tech Stack:** TypeScript, better-sqlite3, @anthropic-ai/claude-agent-sdk, vitest.

---

## File structure

| File | Change |
|------|--------|
| `server/src/store.ts` | `session.mined_seq` column (additive) + `getMinedSeq`/`setMinedSeq` |
| `server/src/config.ts` | `memoryMining: boolean`, `memoryModel: string` |
| `server/src/memoryMiner.ts` (create) | `MemoryMiner` — delta render, extract, secret-filter, persist, watermark, in-flight guard |
| `server/src/sessionManager.ts` | optional `miner` dep + fire-and-forget call on success finish; strengthen `CAPTURE_RULE` |
| `server/src/server.ts` | construct `MemoryMiner`, pass to `SessionManager` |
| `server/test/store.minedSeq.test.ts` (create) | watermark getter/setter |
| `server/test/config.test.ts` | memory config defaults/overrides |
| `server/test/memoryMiner.test.ts` (create) | the miner (fake queryFn) |
| `server/test/sessionManager.miner.test.ts` (create) | success finish triggers miner |

**Verify:** `npm --prefix server test`; `cd server && bunx tsc --noEmit`.

---

## Task MM-1: `mined_seq` watermark in the store

**Files:** Modify `server/src/store.ts`; Test `server/test/store.minedSeq.test.ts` (create).

- [ ] **Step 1 — failing test** `server/test/store.minedSeq.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('Store mined_seq watermark', () => {
  it('defaults to 0 and round-trips', () => {
    const s = store.create({ projectPath: '/p/a' });
    expect(store.getMinedSeq(s.id)).toBe(0);
    store.setMinedSeq(s.id, 42);
    expect(store.getMinedSeq(s.id)).toBe(42);
  });

  it('returns 0 for an unknown session', () => {
    expect(store.getMinedSeq('nope')).toBe(0);
  });
});
```

- [ ] **Step 2 — run, expect FAIL** (`store.getMinedSeq is not a function`): `npm --prefix server test -- minedSeq`

- [ ] **Step 3 — additive column.** In `migrate()`, the `session` additive-columns list (`const additions: Array<[string,string]> = [...]`) — add an entry:
```ts
      ['mined_seq', `ALTER TABLE session ADD COLUMN mined_seq INTEGER NOT NULL DEFAULT 0`],
```

- [ ] **Step 4 — prepared stmts.** In the `stmts!` type block:
```ts
    getMinedSeq: Database.Statement;
    setMinedSeq: Database.Statement;
```
In `prepareStatements()`:
```ts
      getMinedSeq: db.prepare(`SELECT mined_seq FROM session WHERE id = ?`),
      setMinedSeq: db.prepare(`UPDATE session SET mined_seq = ? WHERE id = ?`),
```

- [ ] **Step 5 — methods.** After `setStatus`:
```ts
  /** Highwater seq the memory miner has already processed for a session. */
  getMinedSeq(id: string): number {
    const r = this.stmts.getMinedSeq.get(id) as { mined_seq: number } | undefined;
    return r?.mined_seq ?? 0;
  }

  setMinedSeq(id: string, seq: number): void {
    this.stmts.setMinedSeq.run(seq, id);
  }
```

- [ ] **Step 6 — run, expect PASS** (2). Then `npm --prefix server test 2>&1 | tail -3` (no regressions).

- [ ] **Step 7 — commit:**
```bash
git add server/src/store.ts server/test/store.minedSeq.test.ts
git commit -m "feat(store): mined_seq watermark for incremental memory mining"
```

---

## Task MM-2: memory config

**Files:** Modify `server/src/config.ts`; Test `server/test/config.test.ts` (append).

- [ ] **Step 1 — failing test.** Append to `server/test/config.test.ts` (it already builds a config from an env object — mirror the existing pattern in that file; read it first to match how it calls `loadConfig`/`buildConfig`). Add:
```ts
describe('memory mining config', () => {
  it('defaults: mining on, haiku model', () => {
    const c = makeConfig({ DECK_TOKEN: 'a-long-test-token-value-1234', PROJECTS_ROOTS: '/tmp' });
    expect(c.memoryMining).toBe(true);
    expect(c.memoryModel).toBe('claude-haiku-4-5-20251001');
  });
  it('honors overrides', () => {
    const c = makeConfig({ DECK_TOKEN: 'a-long-test-token-value-1234', PROJECTS_ROOTS: '/tmp', DECK_MEMORY_MINING: 'false', DECK_MEMORY_MODEL: 'claude-sonnet-4-6' });
    expect(c.memoryMining).toBe(false);
    expect(c.memoryModel).toBe('claude-sonnet-4-6');
  });
});
```
NOTE: `makeConfig` is a placeholder — use the ACTUAL config-builder entrypoint/helper the existing tests in `config.test.ts` use (read the file; it may be `loadConfig(env)` or similar). Match it exactly.

- [ ] **Step 2 — run, expect FAIL.**

- [ ] **Step 3 — interface.** In `server/src/config.ts`, add to `interface Config`:
```ts
  /** Auto-extract durable facts from finished turns into the knowledge store. */
  memoryMining: boolean;
  /** Cheap model used by the memory miner. */
  memoryModel: string;
```

- [ ] **Step 4 — return block.** In the `return { ... }`:
```ts
    memoryMining: env.DECK_MEMORY_MINING !== 'false',
    memoryModel: env.DECK_MEMORY_MODEL || 'claude-haiku-4-5-20251001',
```

- [ ] **Step 5 — run, expect PASS.** Full suite no regressions.

- [ ] **Step 6 — commit:**
```bash
git add server/src/config.ts server/test/config.test.ts
git commit -m "feat(config): memoryMining + memoryModel"
```

---

## Task MM-3: the `MemoryMiner` module

**Files:** Create `server/src/memoryMiner.ts`, `server/test/memoryMiner.test.ts`.

- [ ] **Step 1 — failing test** `server/test/memoryMiner.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { MemoryMiner } from '../src/memoryMiner.ts';

let store: Store;
const cfg = { memoryMining: true, memoryModel: 'm' } as any;
beforeEach(() => { store = new Store(':memory:'); });

// Fake queryFn: yields one assistant message whose text is `json`.
function fakeQuery(json: string) {
  return () => (async function* () {
    yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: json }] } };
  })();
}

function seed(projectPath = '/p/alpha') {
  const s = store.create({ projectPath });
  store.appendEvent(s.id, { sdkUuid: null, type: 'user', payload: { type: 'user_prompt', text: 'we deploy via Railway project deck-prod' } });
  store.appendEvent(s.id, { sdkUuid: null, type: 'assistant', payload: { message: { content: [{ type: 'text', text: 'noted' }] } } });
  return s;
}

describe('MemoryMiner', () => {
  it('extracts facts and persists them scoped + with provenance', async () => {
    const s = seed();
    const facts = JSON.stringify([{ scope: 'project', kind: 'binding', key: 'deploy', fact: 'deploys via Railway project deck-prod' }]);
    const miner = new MemoryMiner(store, cfg, fakeQuery(facts));
    const n = await miner.mineSession(s.id);
    expect(n).toBe(1);
    const all = store.listAllKnowledge();
    expect(all.length).toBe(1);
    expect(all[0].scope).toBe('/p/alpha');     // 'project' resolved to project_path
    expect(all[0].kind).toBe('binding');
    expect(all[0].source_session).toBe(s.id);  // provenance set
  });

  it('resolves scope=global to the global scope', async () => {
    const s = seed();
    const miner = new MemoryMiner(store, cfg, fakeQuery(JSON.stringify([{ scope: 'global', kind: 'preference', key: 'p', fact: 'user prefers terse output' }])));
    await miner.mineSession(s.id);
    expect(store.listAllKnowledge()[0].scope).toBe('global');
  });

  it('drops secret-shaped facts', async () => {
    const s = seed();
    const secret = 'ghp_' + 'aBc123DeF456gHi789JkL012mNo345PqR67';
    const miner = new MemoryMiner(store, cfg, fakeQuery(JSON.stringify([{ scope: 'project', kind: 'binding', key: 't', fact: `token is ${secret}` }])));
    expect(await miner.mineSession(s.id)).toBe(0);
    expect(store.listAllKnowledge().length).toBe(0);
  });

  it('advances the watermark and does not re-mine the same events', async () => {
    const s = seed();
    const miner = new MemoryMiner(store, cfg, fakeQuery(JSON.stringify([{ scope: 'project', kind: 'rule', key: 'r', fact: 'never force-push main' }])));
    await miner.mineSession(s.id);
    expect(store.getMinedSeq(s.id)).toBeGreaterThan(0);
    const before = store.listAllKnowledge().length;
    expect(await miner.mineSession(s.id)).toBe(0); // no new events
    expect(store.listAllKnowledge().length).toBe(before);
  });

  it('is a no-op when mining is disabled', async () => {
    const s = seed();
    const miner = new MemoryMiner(store, { ...cfg, memoryMining: false }, fakeQuery(JSON.stringify([{ scope: 'project', kind: 'rule', key: 'r', fact: 'x' }])));
    expect(await miner.mineSession(s.id)).toBe(0);
  });

  it('tolerates malformed model output (returns 0, advances watermark)', async () => {
    const s = seed();
    const miner = new MemoryMiner(store, cfg, fakeQuery('not json at all'));
    expect(await miner.mineSession(s.id)).toBe(0);
    expect(store.getMinedSeq(s.id)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2 — run, expect FAIL** (no module).

- [ ] **Step 3 — implement** `server/src/memoryMiner.ts`:

```ts
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Config } from './config.ts';
import type { Store, KnowledgeKind, EventRow } from './store.ts';
import { looksLikeSecret } from './deckTools.ts';

/** Injectable so tests pass a fake async-iterable instead of calling the model. */
export type QueryFn = (args: { prompt: string | AsyncIterable<any>; options: Record<string, unknown> }) => AsyncIterable<any>;

const KINDS = new Set<KnowledgeKind>(['binding', 'convention', 'rule', 'preference', 'infra']);
const MAX_TRANSCRIPT = 12_000;
const MIN_NEW_EVENTS = 2; // need at least a user+assistant exchange to be worth a pass

const EXTRACTION_PROMPT = `You extract durable, reusable FACTS from a coding-assistant transcript so future sessions act smarter.

Output ONLY a JSON array (no prose, no code fence). Each item:
{ "scope": "global" | "project", "kind": "binding"|"convention"|"rule"|"preference"|"infra", "key": "stable-kebab-key", "fact": "one sentence" }

Record a fact ONLY if it is (1) durable beyond this session, (2) NOT derivable from the repo/git/CLAUDE.md, and (3) would change how a future session acts. Examples worth recording:
- which GitHub/MCP/cloud account or project a repo uses (binding, scope=project)
- a build/test/PR/commit convention specific to this project (convention, scope=project)
- a do/don't rule the user stated (rule, scope=project)
- a standing user preference that applies everywhere — terse output, always show error/empty/loading states, etc. (preference, scope=global)
- an infra/env binding (infra)

scope=project for facts about THIS project; scope=global for cross-project user preferences. Give each fact a stable "key" so re-stating it later overwrites instead of duplicating. NEVER include secrets/tokens/keys — record the reference (account NAME), never the credential. Be conservative: if nothing qualifies, output []. Prefer missing a fact over recording noise.`;

interface RawFact { scope?: string; kind?: string; key?: string; fact?: string }

export class MemoryMiner {
  private inFlight = new Set<string>();
  constructor(
    private store: Store,
    private cfg: Pick<Config, 'memoryMining' | 'memoryModel'>,
    private queryFn: QueryFn = (args) => sdkQuery(args as any),
  ) {}

  /** Mine new events for a session into the knowledge store. Returns facts stored.
   *  Safe to call fire-and-forget; never throws to the caller. */
  async mineSession(sessionId: string): Promise<number> {
    if (!this.cfg.memoryMining) return 0;
    if (this.inFlight.has(sessionId)) return 0;
    this.inFlight.add(sessionId);
    try {
      const sess = this.store.get(sessionId);
      if (!sess) return 0;
      const from = this.store.getMinedSeq(sessionId);
      const events = this.store.eventsSince(sessionId, from);
      if (!events.length) return 0;
      const latest = events[events.length - 1].seq;
      if (events.length < MIN_NEW_EVENTS) { this.store.setMinedSeq(sessionId, latest); return 0; }

      const transcript = renderTranscript(events);
      if (!transcript.trim()) { this.store.setMinedSeq(sessionId, latest); return 0; }

      let stored = 0;
      try {
        const facts = await this.extract(transcript);
        for (const f of facts) {
          if (!f.fact || looksLikeSecret(f.fact)) continue;
          const kind = (f.kind ?? '') as KnowledgeKind;
          if (!KINDS.has(kind)) continue;
          const scope = f.scope === 'global' ? 'global' : sess.project_path;
          this.store.rememberFact({ scope, kind, key: f.key ?? null, fact: f.fact, sourceSession: sessionId });
          stored++;
        }
      } catch { /* extraction/model failure must not break mining */ }

      this.store.setMinedSeq(sessionId, latest); // advance even on 0 so we never re-scan
      return stored;
    } catch {
      return 0;
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  private async extract(transcript: string): Promise<RawFact[]> {
    let text = '';
    for await (const msg of this.queryFn({
      prompt: transcript,
      options: {
        model: this.cfg.memoryModel,
        maxTurns: 1,
        systemPrompt: EXTRACTION_PROMPT,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    })) {
      if (msg?.type === 'assistant') {
        for (const b of msg?.message?.content ?? []) {
          if (b?.type === 'text' && typeof b.text === 'string') text += b.text;
        }
      }
    }
    return parseFacts(text);
  }
}

/** Compact transcript: user prompts + assistant text + tool names. Skips bulky
 *  tool outputs. Keeps the most recent MAX_TRANSCRIPT chars. */
export function renderTranscript(events: EventRow[]): string {
  const lines: string[] = [];
  for (const e of events) {
    const p: any = e.payload;
    if (e.type === 'user' && p?.type === 'user_prompt' && p.text) {
      lines.push(`USER: ${p.text}`);
    } else if (e.type === 'assistant') {
      for (const b of p?.message?.content ?? []) {
        if (b?.type === 'text' && b.text) lines.push(`ASSISTANT: ${b.text}`);
        else if (b?.type === 'tool_use' && b.name) lines.push(`ASSISTANT used ${b.name}`);
      }
    }
  }
  const joined = lines.join('\n');
  return joined.length > MAX_TRANSCRIPT ? joined.slice(joined.length - MAX_TRANSCRIPT) : joined;
}

/** Parse a JSON array of facts from model text, tolerating fences/prose. */
export function parseFacts(text: string): RawFact[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(arr) ? (arr as RawFact[]) : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4 — run, expect PASS** (6 tests). NOTE: confirm `EventRow` is exported from store.ts and that `appendEvent` accepts `{sdkUuid,type,payload}` — read store.ts to verify the exact `appendEvent`/`AppendInput` shape and `EventRow` export before finalizing; adjust the test seed + import if the shape differs.

- [ ] **Step 5 — commit:**
```bash
git add server/src/memoryMiner.ts server/test/memoryMiner.test.ts
git commit -m "feat(server): MemoryMiner — extract durable facts from finished turns"
```

---

## Task MM-4: wire the miner + strengthen the rule

**Files:** Modify `server/src/sessionManager.ts`, `server/src/server.ts`; Test `server/test/sessionManager.miner.test.ts` (create).

- [ ] **Step 1 — failing test** `server/test/sessionManager.miner.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { SessionManager } from '../src/sessionManager.ts';

let store: Store;
const cfg = { token: 't', projectsRoot: '/p', port: 1, model: 'claude-opus-4-8' } as any;
beforeEach(() => { store = new Store(':memory:'); });

describe('sessionManager memory mining trigger', () => {
  it('calls miner.mineSession after a successful turn', async () => {
    const seen: string[] = [];
    const fakeMiner = { mineSession: async (id: string) => { seen.push(id); return 0; } } as any;
    const queryFn = () => (async function* () { /* no events → clean finish */ })();
    const mgr = new SessionManager(store, cfg, queryFn, fakeMiner);
    const s = store.create({ projectPath: '/p/a' });
    await mgr.send(s.id, 'hi');
    expect(seen).toEqual([s.id]);
  });

  it('works without a miner (optional dep)', async () => {
    const queryFn = () => (async function* () {})();
    const mgr = new SessionManager(store, cfg, queryFn);
    const s = store.create({ projectPath: '/p/a' });
    await expect(mgr.send(s.id, 'hi')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2 — run, expect FAIL** (4th ctor arg ignored → `seen` empty).

- [ ] **Step 3 — constructor.** In `server/src/sessionManager.ts`, extend the constructor (currently `(private store, private cfg, private queryFn = ...)`) with an optional miner. Add an import:
```ts
import type { MemoryMiner } from './memoryMiner.ts';
```
Constructor:
```ts
  constructor(
    private store: Store,
    private cfg: Config,
    private queryFn: QueryFn = (args) => sdkQuery(args as any),
    private miner?: MemoryMiner,
  ) {
    super();
  }
```
(Read the actual constructor — it extends EventEmitter and may have more setup; preserve it.)

- [ ] **Step 4 — trigger on success.** In `send()`, right AFTER the success-path `this.store.setStatus(sessionId, 'idle');` (the one followed by the `if (sess.kind === 'task') { finishRun(...,'success') }`), add a fire-and-forget mine:
```ts
        // Auto-mine durable facts from this turn into memory. Fire-and-forget —
        // mining must never block or break a turn.
        void this.miner?.mineSession(sessionId).catch(() => {});
```

- [ ] **Step 5 — strengthen CAPTURE_RULE.** In the `CAPTURE_RULE` template, append one forceful line before the closing backtick:
```
\n\nWhen in doubt about a durable, project-specific fact (an account, a convention, a rule, a stated preference), record it — a missed fact is a missed chance to be smarter next time.
```

- [ ] **Step 6 — wire in server.ts.** In `server/src/server.ts`, after `const store = ...` and before/après `const manager = new SessionManager(store, config);`, construct the miner and pass it:
```ts
  const miner = new MemoryMiner(store, config);
  const manager = new SessionManager(store, config, undefined, miner);
```
Add the import at top: `import { MemoryMiner } from './memoryMiner.ts';`.
NOTE: passing `undefined` as the 3rd arg keeps the default `queryFn` (sdkQuery). Confirm the constructor's default param triggers on `undefined`.

- [ ] **Step 7 — run, expect PASS.** Then full server suite + `bunx tsc --noEmit` clean.

- [ ] **Step 8 — commit:**
```bash
git add server/src/sessionManager.ts server/src/server.ts server/test/sessionManager.miner.test.ts
git commit -m "feat(server): trigger memory miner on turn finish; strengthen capture rule"
```

---

## Task MM-5: verify gate + live check

- [ ] **Step 1:** `npm --prefix server test 2>&1 | tail -4` → all pass.
- [ ] **Step 2:** `cd server && bunx tsc --noEmit` → clean.
- [ ] **Step 3 (controller does this live):** after merge + server restart, have a real session state a durable fact, then confirm `sqlite3 server/claude-deck.sqlite "SELECT scope,kind,fact,source_session FROM knowledge"` shows a mined row with `source_session` set.

---

## Self-review

- Reliability fix (miner) → MM-3 + MM-4. ✓
- Better architecture: isolated module, injected queryFn (testable, no network), incremental watermark, fire-and-forget (never breaks a turn), reuses secret guard + supersede dedup, populates provenance. ✓
- Stronger rule → MM-4 step 5. ✓
- Cost control: delta-only, MIN_NEW_EVENTS gate, in-flight guard, cheap model, transcript cap. ✓
- Names consistent: `mineSession`/`getMinedSeq`/`setMinedSeq`/`memoryMining`/`memoryModel`/`MemoryMiner`/`renderTranscript`/`parseFacts`. ✓
- `// ponytail: delta + cheap model + fire-and-forget. Add batching/queue only if mining cost shows up.`
```
