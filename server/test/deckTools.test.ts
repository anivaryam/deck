import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { createTicketHandler, listTicketsHandler, buildDeckMcp } from '../src/deckTools.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('deck ticket tools', () => {
  it('createTicketHandler files a ticket bound to the given project', async () => {
    const res = await createTicketHandler(store, '/p/alpha', { title: 'Fix gap X', body: 'details' });
    expect(res.content[0].text).toMatch(/Created ticket/);
    const all = store.listTickets();
    expect(all.length).toBe(1);
    expect(all[0].title).toBe('Fix gap X');
    expect(all[0].project_path).toBe('/p/alpha');
    expect(all[0].status).toBe('open');
  });

  it('listTicketsHandler returns only the bound project, with statuses', async () => {
    store.createTicket({ title: 'A', projectPath: '/p/alpha' });
    store.createTicket({ title: 'B', projectPath: '/p/other' });
    const res = await listTicketsHandler(store, '/p/alpha');
    expect(res.content[0].text).toContain('A');
    expect(res.content[0].text).not.toContain('B');
  });

  it('listTicketsHandler reports none cleanly', async () => {
    const res = await listTicketsHandler(store, '/p/empty');
    expect(res.content[0].text).toBe('(none)');
  });

  it('buildDeckMcp constructs an MCP server config without throwing', () => {
    const server = buildDeckMcp(store, '/p/alpha');
    expect(server).toBeTruthy();
  });
});
