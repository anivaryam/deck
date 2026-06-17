// server/test/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;

beforeEach(() => {
  store = new Store(':memory:'); // in-memory DB per test
});

describe('Store', () => {
  it('creates and reads a session with default idle status', () => {
    const s = store.create({ projectPath: '/p/alpha', title: 'Alpha' });
    expect(s.id).toMatch(/.+/);
    const got = store.get(s.id);
    expect(got?.project_path).toBe('/p/alpha');
    expect(got?.status).toBe('idle');
    expect(got?.sdk_session_id).toBeNull();
  });

  it('lists sessions newest-first', () => {
    const a = store.create({ projectPath: '/p/a' });
    const b = store.create({ projectPath: '/p/b' });
    const ids = store.list().map((s) => s.id);
    expect(ids).toEqual([b.id, a.id]);
  });

  it('appends events and reads them in seq order', () => {
    const s = store.create({ projectPath: '/p/a' });
    store.appendEvent(s.id, { sdkUuid: 'u1', type: 'assistant', payload: { text: 'hi' } });
    store.appendEvent(s.id, { sdkUuid: 'u2', type: 'result', payload: { ok: true } });
    const events = store.eventsSince(s.id, 0);
    expect(events.map((e) => e.type)).toEqual(['assistant', 'result']);
    expect(events[0].seq).toBeLessThan(events[1].seq);
    expect(events[0].payload).toEqual({ text: 'hi' });
  });

  it('eventsSince returns only events after the given seq', () => {
    const s = store.create({ projectPath: '/p/a' });
    store.appendEvent(s.id, { sdkUuid: null, type: 'assistant', payload: { n: 1 } });
    const all = store.eventsSince(s.id, 0);
    const after = store.eventsSince(s.id, all[0].seq);
    expect(after).toEqual([]);
  });

  it('setResume and setStatus persist', () => {
    const s = store.create({ projectPath: '/p/a' });
    store.setResume(s.id, 'sdk-123');
    store.setStatus(s.id, 'errored');
    const got = store.get(s.id);
    expect(got?.sdk_session_id).toBe('sdk-123');
    expect(got?.status).toBe('errored');
  });
});
