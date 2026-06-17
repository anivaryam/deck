import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('run history store', () => {
  it('createTask persists source_kind/source_id', () => {
    const t = store.createTask({ projectPath: '/p', prompt: 'x', origin: 'cron', sourceKind: 'cron', sourceId: 'c1' });
    const row = store.get(t.id)!;
    expect(row.source_kind).toBe('cron');
    expect(row.source_id).toBe('c1');
    expect(row.ended_at == null).toBe(true);
    expect(row.result == null).toBe(true);
  });

  it('createTask without source leaves columns null', () => {
    const t = store.createTask({ projectPath: '/p', prompt: 'x', origin: 'manual' });
    const row = store.get(t.id)!;
    expect(row.source_kind == null).toBe(true);
    expect(row.source_id == null).toBe(true);
  });

  it('finishRun sets ended_at and result', () => {
    const t = store.createTask({ projectPath: '/p', prompt: 'x', origin: 'manual' });
    store.finishRun(t.id, 'success');
    const row = store.get(t.id)!;
    expect(row.result).toBe('success');
    expect(typeof row.ended_at).toBe('number');
  });

  it('listRunsForSource filters by source and orders newest-first', () => {
    const a = store.createTask({ projectPath: '/p', prompt: 'a', origin: 'cron', sourceKind: 'cron', sourceId: 'c1' });
    const b = store.createTask({ projectPath: '/p', prompt: 'b', origin: 'cron', sourceKind: 'cron', sourceId: 'c1' });
    store.createTask({ projectPath: '/p', prompt: 'c', origin: 'cron', sourceKind: 'cron', sourceId: 'OTHER' });
    const runs = store.listRunsForSource('cron', 'c1');
    expect(runs.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('listRunsForSource respects the limit', () => {
    for (let i = 0; i < 5; i++) store.createTask({ projectPath: '/p', prompt: `${i}`, origin: 'ticket', sourceKind: 'ticket', sourceId: 't1' });
    expect(store.listRunsForSource('ticket', 't1', 3)).toHaveLength(3);
  });
});
