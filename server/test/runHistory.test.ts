import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { TaskRunner } from '../src/taskRunner.ts';
import { Scheduler } from '../src/scheduler.ts';

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

describe('source threading', () => {
  it('taskRunner.run threads sourceKind/sourceId into the task', () => {
    const s = new Store(':memory:');
    const fakeManager = { send: async () => {} };
    const runner = new TaskRunner(s, fakeManager as any);
    const id = runner.run({ projectPath: '/p', prompt: 'x', origin: 'cron', sourceKind: 'cron', sourceId: 'c9' });
    const row = s.get(id)!;
    expect(row.source_kind).toBe('cron');
    expect(row.source_id).toBe('c9');
  });

  it('queue-full marks result=queue_full', () => {
    const s = new Store(':memory:');
    const blocking = { send: () => new Promise<void>(() => {}) }; // never resolves
    const runner = new TaskRunner(s, blocking as any, 1);
    runner.run({ projectPath: '/p', prompt: 'a', origin: 'manual' }); // fills the 1 slot
    const overflowId = runner.run({ projectPath: '/p', prompt: 'b', origin: 'manual' });
    expect(s.get(overflowId)!.result).toBe('queue_full');
  });

  it('scheduler.fireCron tags the run with the cron id', () => {
    const s = new Store(':memory:');
    const created: any[] = [];
    const runner = { run: (i: any) => { created.push(i); return 'sess1'; } };
    const sched = new Scheduler(s, runner as any);
    const c = s.createCron({ schedule: '* * * * *', projectPath: '/p', prompt: 'nightly' });
    sched.fireCron(c.id);
    expect(created[0]).toMatchObject({ origin: 'cron', sourceKind: 'cron', sourceId: c.id });
  });
});
