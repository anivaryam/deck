// server/test/store.deleteSession.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;

beforeEach(() => {
  store = new Store(':memory:');
});

describe('Store.deleteSession', () => {
  it('removes the session row and all its events', () => {
    const s = store.create({ projectPath: '/tmp/proj' });
    store.appendEvent(s.id, { sdkUuid: null, type: 'user', payload: { text: 'hi' } });
    store.appendEvent(s.id, { sdkUuid: null, type: 'assistant', payload: { text: 'yo' } });
    expect(store.get(s.id)).toBeDefined();
    expect(store.eventsSince(s.id, 0)).toHaveLength(2);

    store.deleteSession(s.id);

    expect(store.get(s.id)).toBeUndefined();
    expect(store.eventsSince(s.id, 0)).toHaveLength(0);
  });

  it('does not touch other sessions', () => {
    const keep = store.create({ projectPath: '/tmp/keep' });
    const drop = store.create({ projectPath: '/tmp/drop' });
    store.appendEvent(keep.id, { sdkUuid: null, type: 'user', payload: {} });
    store.appendEvent(drop.id, { sdkUuid: null, type: 'user', payload: {} });

    store.deleteSession(drop.id);

    expect(store.get(keep.id)).toBeDefined();
    expect(store.eventsSince(keep.id, 0)).toHaveLength(1);
  });

  it('is a no-op on an unknown id', () => {
    expect(() => store.deleteSession('does-not-exist')).not.toThrow();
  });
});
