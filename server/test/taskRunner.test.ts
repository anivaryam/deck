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
  it('swallows manager.send rejection (recorded by manager, not thrown to caller)', async () => {
    const boom = { send: async () => { throw new Error('fail'); } } as any;
    const r2 = new TaskRunner(store, boom);
    const id = r2.run({ projectPath: '/p/a', prompt: 'x', origin: 'cron' });
    expect(typeof id).toBe('string');           // does not throw synchronously
    await new Promise(r => setTimeout(r, 0));    // unhandled rejection must not crash
  });
});
