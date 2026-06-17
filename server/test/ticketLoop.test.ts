import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { linkPrHandler, deckToolNames, buildDeckMcp } from '../src/deckTools.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('link_pr handler', () => {
  it('records a valid GitHub PR URL on the ticket', async () => {
    const tk = store.createTicket({ title: 'x', projectPath: '/p' });
    const res = await linkPrHandler(store, tk.id, { url: 'https://github.com/o/r/pull/12' });
    expect(store.getTicket(tk.id)!.pr_url).toBe('https://github.com/o/r/pull/12');
    expect(res.content[0].text).toMatch(/recorded|linked/i);
  });

  it('rejects a non-PR URL without writing', async () => {
    const tk = store.createTicket({ title: 'x', projectPath: '/p' });
    await linkPrHandler(store, tk.id, { url: 'https://example.com/foo' });
    expect(store.getTicket(tk.id)!.pr_url == null).toBe(true);
  });
});

describe('deckToolNames scoping', () => {
  it('omits link_pr when no ticketId is given', () => {
    const names = deckToolNames();
    expect(names).toContain('create_ticket');
    expect(names).not.toContain('link_pr');
  });

  it('includes link_pr when a ticketId is given', () => {
    const names = deckToolNames('ticket-1');
    expect(names).toContain('link_pr');
  });
});

describe('buildDeckMcp tool scoping', () => {
  it('omits link_pr when no ticketId is given', () => {
    const mcp = buildDeckMcp(store, '/p');
    expect(mcp).toBeTruthy();
    expect(deckToolNames()).not.toContain('link_pr');
  });

  it('includes link_pr when a ticketId is given', () => {
    const mcp = buildDeckMcp(store, '/p', 'ticket-1');
    expect(mcp).toBeTruthy();
    expect(deckToolNames('ticket-1')).toContain('link_pr');
  });
});

import { EventEmitter } from 'node:events';
import { registerTicketAutomation } from '../src/ticketAutomation.ts';

function wire(store: Store) {
  const mgr = new EventEmitter();
  registerTicketAutomation(mgr as any, store);
  return mgr;
}

describe('ticketAutomation transitions', () => {
  it('start frame → running', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const tk = s.createTicket({ title: 't', projectPath: '/p' });
    mgr.emit('task', { id: 'r1', source_kind: 'ticket', source_id: tk.id, status: 'active', result: null });
    expect(s.getTicket(tk.id)!.status).toBe('running');
  });

  it('success with pr_url → review', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const tk = s.createTicket({ title: 't', projectPath: '/p' });
    s.updateTicket(tk.id, { pr_url: 'https://github.com/o/r/pull/1' });
    mgr.emit('task', { id: 'r1', source_kind: 'ticket', source_id: tk.id, status: 'idle', result: 'success' });
    expect(s.getTicket(tk.id)!.status).toBe('review');
  });

  it('success without pr_url → done', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const tk = s.createTicket({ title: 't', projectPath: '/p' });
    mgr.emit('task', { id: 'r1', source_kind: 'ticket', source_id: tk.id, status: 'idle', result: 'success' });
    expect(s.getTicket(tk.id)!.status).toBe('done');
  });

  it('error → failed; cancelled → open', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const a = s.createTicket({ title: 'a', projectPath: '/p' });
    const b = s.createTicket({ title: 'b', projectPath: '/p' });
    mgr.emit('task', { id: 'r1', source_kind: 'ticket', source_id: a.id, status: 'errored', result: 'error' });
    mgr.emit('task', { id: 'r2', source_kind: 'ticket', source_id: b.id, status: 'idle', result: 'cancelled' });
    expect(s.getTicket(a.id)!.status).toBe('failed');
    expect(s.getTicket(b.id)!.status).toBe('open');
  });

  it('ignores non-ticket frames and merged/closed tickets', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const tk = s.createTicket({ title: 't', projectPath: '/p' });
    s.updateTicket(tk.id, { status: 'merged' });
    mgr.emit('task', { id: 'r1', source_kind: 'ticket', source_id: tk.id, status: 'idle', result: 'success' });
    expect(s.getTicket(tk.id)!.status).toBe('merged'); // not overwritten
    mgr.emit('task', { id: 'r2', source_kind: 'cron', source_id: 'c1', status: 'idle', result: 'success' }); // no throw
  });

  it('fallback: scans events for a PR URL when link_pr was not called', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const tk = s.createTicket({ title: 't', projectPath: '/p' });
    const run = s.createTask({ projectPath: '/p', prompt: 'go', origin: 'ticket', sourceKind: 'ticket', sourceId: tk.id });
    s.appendEvent(run.id, { sdkUuid: null, type: 'assistant', payload: { text: 'opened https://github.com/o/r/pull/99 done' } });
    mgr.emit('task', { id: run.id, source_kind: 'ticket', source_id: tk.id, status: 'idle', result: 'success' });
    expect(s.getTicket(tk.id)!.pr_url).toBe('https://github.com/o/r/pull/99');
    expect(s.getTicket(tk.id)!.status).toBe('review'); // fallback ran before the review/done decision
  });
});
