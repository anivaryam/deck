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
