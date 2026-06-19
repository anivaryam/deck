import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { TaskRunner } from '../src/taskRunner.ts';

describe('TaskRunner', () => {
  let store: Store; let sent: Array<{id:string;prompt:string}>; let runner: TaskRunner;
  beforeEach(() => {
    store = new Store(':memory:');
    sent = [];
    const fakeManager = { send: async (id: string, prompt: string) => { sent.push({id, prompt}); } } as any;
    runner = new TaskRunner(store, fakeManager);
  });
  it('creates a task session and fires manager.send, returning the id', async () => {
    const id = runner.run({ projectPath: '/p/a', prompt: 'do x', origin: 'manual' });
    expect(typeof id).toBe('string');
    expect(store.get(id)!.kind).toBe('task');
    await new Promise(r => setTimeout(r, 0)); // let the fire-and-forget send run
    expect(sent).toEqual([{ id, prompt: 'do x' }]);
  });
  it('applies task default model/effort when the run specifies none', async () => {
    const r = new TaskRunner(store, { send: async () => {} } as any, 6, { model: 'claude-sonnet-4-5', effort: 'low' });
    const a = r.run({ projectPath: '/p/a', prompt: 'x', origin: 'cron' });
    expect(store.get(a)!.model).toBe('claude-sonnet-4-5');
    expect(store.get(a)!.effort).toBe('low');
    // An explicit per-run model/effort wins over the default.
    const b = r.run({ projectPath: '/p/a', prompt: 'y', origin: 'cron', model: 'claude-opus-4-8' });
    expect(store.get(b)!.model).toBe('claude-opus-4-8');
  });
  it('swallows manager.send rejection (recorded by manager, not thrown to caller)', async () => {
    const boom = { send: async () => { throw new Error('fail'); } } as any;
    const r2 = new TaskRunner(store, boom);
    const id = r2.run({ projectPath: '/p/a', prompt: 'x', origin: 'cron' });
    expect(typeof id).toBe('string');           // does not throw synchronously
    await new Promise(r => setTimeout(r, 0));    // unhandled rejection must not crash
  });
});
