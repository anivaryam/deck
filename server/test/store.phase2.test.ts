import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let s: Store;
beforeEach(() => { s = new Store(':memory:'); });

describe('Store phase2', () => {
  it('createTask makes a session with kind=task + prompt + origin', () => {
    const t = s.createTask({ projectPath: '/p/a', prompt: 'do x', origin: 'manual' });
    const got = s.get(t.id)!;
    expect(got.kind).toBe('task');
    expect(got.prompt).toBe('do x');
    expect(got.origin).toBe('manual');
    expect(got.status).toBe('idle');
  });

  it('listTasks returns only kind=task, newest first; chat sessions excluded', () => {
    s.create({ projectPath: '/p/chat' });               // kind defaults to 'chat'
    const t1 = s.createTask({ projectPath: '/p/a', prompt: 'a', origin: 'manual' });
    const t2 = s.createTask({ projectPath: '/p/b', prompt: 'b', origin: 'cron' });
    const tasks = s.listTasks();
    expect(tasks.map(t => t.id)).toEqual([t2.id, t1.id]);
    expect(tasks.every(t => t.kind === 'task')).toBe(true);
  });

  it('listSessions("chat") excludes tasks', () => {
    s.create({ projectPath: '/p/chat' });
    s.createTask({ projectPath: '/p/a', prompt: 'a', origin: 'manual' });
    expect(s.listSessions('chat').every(r => r.kind === 'chat')).toBe(true);
  });

  it('cron CRUD + recordCronRun', () => {
    const c = s.createCron({ schedule: '* * * * *', projectPath: '/p/a', prompt: 'tick' });
    expect(c.enabled).toBe(1);
    s.setCronEnabled(c.id, false);
    expect(s.getCron(c.id)!.enabled).toBe(0);
    s.recordCronRun(c.id, 'sess-1');
    const after = s.getCron(c.id)!;
    expect(after.last_session_id).toBe('sess-1');
    expect(typeof after.last_run_at).toBe('number');
    s.deleteCron(c.id);
    expect(s.getCron(c.id)).toBeUndefined();
    expect(s.listCron()).toEqual([]);
  });

  it('ticket CRUD + run linkage', () => {
    const tk = s.createTicket({ title: 'Fix bug', body: 'details', projectPath: '/p/a' });
    expect(tk.status).toBe('open');
    s.updateTicket(tk.id, { status: 'running', session_id: 'sess-9' });
    s.updateTicket(tk.id, { pr_url: 'http://pr/1', status: 'done' });
    const got = s.getTicket(tk.id)!;
    expect(got.status).toBe('done');
    expect(got.session_id).toBe('sess-9');
    expect(got.pr_url).toBe('http://pr/1');
    expect(s.listTickets().length).toBe(1);
  });

  it('migration is safe on a fresh db and exposes default kind=chat for create()', () => {
    const c = s.create({ projectPath: '/p/x' });
    expect(s.get(c.id)!.kind).toBe('chat');
  });
});
