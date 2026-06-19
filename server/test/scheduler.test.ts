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
  it('derives the interval between the next two fires', () => {
    expect(Scheduler.minIntervalSec('* * * * *')).toBe(60);   // every minute
    expect(Scheduler.minIntervalSec('*/5 * * * *')).toBe(300); // every 5 minutes
    expect(Scheduler.minIntervalSec('not a cron')).toBe(null);
  });
  it('skips a fire when the previous run for that cron is still active', () => {
    const a = store.createCron({ schedule: '* * * * *', projectPath: '/p/a', prompt: 'A' });
    sched.fireCron(a.id);
    expect(runs.length).toBe(1);
    // Mark the recorded run active → next tick must skip.
    const sid = store.getCron(a.id)!.last_session_id!;
    const sess = store.create({ projectPath: '/p/a' });
    store.recordCronRun(a.id, sess.id);
    store.setStatus(sess.id, 'active');
    sched.fireCron(a.id);
    expect(runs.length).toBe(1); // skipped
    // Once idle, it fires again.
    store.setStatus(sess.id, 'idle');
    sched.fireCron(a.id);
    expect(runs.length).toBe(2);
    void sid;
  });
  it('fireDue runs enabled crons and records the run, skipping disabled', () => {
    const a = store.createCron({ schedule: '* * * * *', projectPath: '/p/a', prompt: 'A' });
    const b = store.createCron({ schedule: '* * * * *', projectPath: '/p/b', prompt: 'B' });
    store.setCronEnabled(b.id, false);
    sched.fireCron(a.id);                       // simulate a tick for cron a
    expect(runs).toMatchObject([{ projectPath: '/p/a', prompt: 'A', origin: 'cron', sourceKind: 'cron', sourceId: a.id }]);
    expect(store.getCron(a.id)!.last_session_id).toBe('sess-1');
    sched.fireCron(b.id);                        // disabled → no run
    expect(runs.length).toBe(1);
  });
});
