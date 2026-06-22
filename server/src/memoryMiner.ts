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
