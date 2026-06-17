// server/test/store.effort.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;

beforeEach(() => {
  store = new Store(':memory:');
});

describe('Store effort column', () => {
  it('persists effort when provided to create()', () => {
    const s = store.create({ projectPath: '/p/a', effort: 'max' });
    expect(store.get(s.id)?.effort).toBe('max');
  });

  it('stores null effort when omitted from create()', () => {
    const s = store.create({ projectPath: '/p/a' });
    expect(store.get(s.id)?.effort).toBeNull();
  });

  it('persists effort when provided to createTask()', () => {
    const t = store.createTask({ projectPath: '/p/a', prompt: 'do it', origin: 'manual', effort: 'high' });
    expect(store.get(t.id)?.effort).toBe('high');
  });

  it('stores null effort when omitted from createTask()', () => {
    const t = store.createTask({ projectPath: '/p/a', prompt: 'do it', origin: 'manual' });
    expect(store.get(t.id)?.effort).toBeNull();
  });

  it('persists model and effort together', () => {
    const s = store.create({ projectPath: '/p/a', model: 'claude-sonnet-4-6', effort: 'low' });
    const row = store.get(s.id);
    expect(row?.model).toBe('claude-sonnet-4-6');
    expect(row?.effort).toBe('low');
  });
});
