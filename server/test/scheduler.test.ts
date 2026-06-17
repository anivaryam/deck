import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { Scheduler } from '../src/scheduler.ts';

describe('Scheduler', () => {
  let store: Store; let runs: Array<{projectPath:string;prompt:string;origin:string}>; let sched: Scheduler;
  beforeEach(() => {
    store = new Store(':memory:');
    runs = [];
    const fakeRunner = { run: (i:any) => { runs.push(i); return 'sess-'+runs.length; } } as any;
    sched = new Scheduler(store, fakeRunner);
  });
  it('validates cron expressions', () => {
    expect(Scheduler.isValid('* * * * *')).toBe(true);
    expect(Scheduler.isValid('not a cron')).toBe(false);
  });
  it('fireDue runs enabled crons and records the run, skipping disabled', () => {
    const a = store.createCron({ schedule: '* * * * *', projectPath: '/p/a', prompt: 'A' });
    const b = store.createCron({ schedule: '* * * * *', projectPath: '/p/b', prompt: 'B' });
    store.setCronEnabled(b.id, false);
    sched.fireCron(a.id);                       // simulate a tick for cron a
    expect(runs).toEqual([{ projectPath: '/p/a', prompt: 'A', origin: 'cron' }]);
    expect(store.getCron(a.id)!.last_session_id).toBe('sess-1');
    sched.fireCron(b.id);                        // disabled → no run
    expect(runs.length).toBe(1);
  });
});
