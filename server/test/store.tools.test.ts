// server/test/store.tools.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;

beforeEach(() => {
  store = new Store(':memory:');
});

describe('Store disabled_tools column', () => {
  it('persists disabled tools as a JSON array when provided to create()', () => {
    const s = store.create({ projectPath: '/p/a', disabledTools: ['Bash', 'WebFetch'] });
    expect(JSON.parse(store.get(s.id)!.disabled_tools!)).toEqual(['Bash', 'WebFetch']);
  });

  it('stores null when disabled tools omitted or empty', () => {
    const a = store.create({ projectPath: '/p/a' });
    const b = store.create({ projectPath: '/p/b', disabledTools: [] });
    expect(store.get(a.id)?.disabled_tools).toBeNull();
    expect(store.get(b.id)?.disabled_tools).toBeNull();
  });

  it('setDisabledTools replaces the set, and an empty array clears it to null', () => {
    const s = store.create({ projectPath: '/p/a' });
    store.setDisabledTools(s.id, ['Edit', 'Write']);
    expect(JSON.parse(store.get(s.id)!.disabled_tools!)).toEqual(['Edit', 'Write']);
    store.setDisabledTools(s.id, []);
    expect(store.get(s.id)?.disabled_tools).toBeNull();
  });
});
