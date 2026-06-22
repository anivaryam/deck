import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('Store mined_seq watermark', () => {
  it('defaults to 0 and round-trips', () => {
    const s = store.create({ projectPath: '/p/a' });
    expect(store.getMinedSeq(s.id)).toBe(0);
    store.setMinedSeq(s.id, 42);
    expect(store.getMinedSeq(s.id)).toBe(42);
  });

  it('returns 0 for an unknown session', () => {
    expect(store.getMinedSeq('nope')).toBe(0);
  });
});
