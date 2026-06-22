import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { SessionManager } from '../src/sessionManager.ts';

let store: Store;
const cfg = { token: 't', projectsRoot: '/p', port: 1, model: 'claude-opus-4-8', memoryMining: true, memoryModel: 'm' } as any;
beforeEach(() => { store = new Store(':memory:'); });

describe('sessionManager memory mining trigger', () => {
  it('calls miner.mineSession after a successful turn', async () => {
    const seen: string[] = [];
    const fakeMiner = { mineSession: async (id: string) => { seen.push(id); return 0; } } as any;
    const queryFn = () => (async function* () { /* no events → clean finish */ })();
    const mgr = new SessionManager(store, cfg, queryFn, fakeMiner);
    const s = store.create({ projectPath: '/p/a' });
    await mgr.send(s.id, 'hi');
    // mining is fire-and-forget; let the microtask flush
    await Promise.resolve();
    expect(seen).toEqual([s.id]);
  });

  it('works without a miner (optional dep)', async () => {
    const queryFn = () => (async function* () {})();
    const mgr = new SessionManager(store, cfg, queryFn);
    const s = store.create({ projectPath: '/p/a' });
    await expect(mgr.send(s.id, 'hi')).resolves.toBeUndefined();
  });

  it('a miner that throws never breaks the turn', async () => {
    const fakeMiner = { mineSession: async () => { throw new Error('boom'); } } as any;
    const queryFn = () => (async function* () {})();
    const mgr = new SessionManager(store, cfg, queryFn, fakeMiner);
    const s = store.create({ projectPath: '/p/a' });
    await expect(mgr.send(s.id, 'hi')).resolves.toBeUndefined();
  });
});
