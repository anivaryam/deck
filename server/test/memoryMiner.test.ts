import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { MemoryMiner } from '../src/memoryMiner.ts';

let store: Store;
const cfg = { memoryMining: true, memoryModel: 'm' } as any;
beforeEach(() => { store = new Store(':memory:'); });

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
    expect(await miner.mineSession(s.id)).toBe(1);
    const all = store.listAllKnowledge();
    expect(all.length).toBe(1);
    expect(all[0].scope).toBe('/p/alpha');
    expect(all[0].kind).toBe('binding');
    expect(all[0].source_session).toBe(s.id);
  });

  it('resolves scope=global to global', async () => {
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

  it('advances the watermark and does not re-mine', async () => {
    const s = seed();
    const miner = new MemoryMiner(store, cfg, fakeQuery(JSON.stringify([{ scope: 'project', kind: 'rule', key: 'r', fact: 'never force-push main' }])));
    await miner.mineSession(s.id);
    expect(store.getMinedSeq(s.id)).toBeGreaterThan(0);
    const before = store.listAllKnowledge().length;
    expect(await miner.mineSession(s.id)).toBe(0);
    expect(store.listAllKnowledge().length).toBe(before);
  });

  it('is a no-op when mining disabled', async () => {
    const s = seed();
    const miner = new MemoryMiner(store, { ...cfg, memoryMining: false }, fakeQuery(JSON.stringify([{ scope: 'project', kind: 'rule', key: 'r', fact: 'x' }])));
    expect(await miner.mineSession(s.id)).toBe(0);
  });

  it('tolerates malformed model output', async () => {
    const s = seed();
    const miner = new MemoryMiner(store, cfg, fakeQuery('not json at all'));
    expect(await miner.mineSession(s.id)).toBe(0);
    expect(store.getMinedSeq(s.id)).toBeGreaterThan(0);
  });

  it('parses facts even when a fact text contains a closing bracket', async () => {
    const s = seed();
    const json = JSON.stringify([{ scope: 'project', kind: 'convention', key: 'deploy', fact: 'use [Railway] for deploys' }]);
    const miner = new MemoryMiner(store, cfg, fakeQuery(json));
    expect(await miner.mineSession(s.id)).toBe(1);
    expect(store.listAllKnowledge()[0].fact).toBe('use [Railway] for deploys');
  });

  it('treats an empty key as free-form (no degenerate empty-key row)', async () => {
    const s = seed();
    const miner = new MemoryMiner(store, cfg, fakeQuery(JSON.stringify([{ scope: 'project', kind: 'rule', key: '', fact: 'free form fact' }])));
    expect(await miner.mineSession(s.id)).toBe(1);
    expect(store.listAllKnowledge()[0].key).toBeNull();
  });
});
