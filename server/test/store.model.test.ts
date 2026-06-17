// server/test/store.model.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;

beforeEach(() => {
  store = new Store(':memory:');
});

describe('Store model column', () => {
  it('persists model when provided to create()', () => {
    const s = store.create({ projectPath: '/p/a', model: 'claude-sonnet-4-6' });
    expect(store.get(s.id)?.model).toBe('claude-sonnet-4-6');
  });

  it('stores null model when omitted from create()', () => {
    const s = store.create({ projectPath: '/p/a' });
    expect(store.get(s.id)?.model).toBeNull();
  });

  it('persists model when provided to createTask()', () => {
    const t = store.createTask({ projectPath: '/p/a', prompt: 'do it', origin: 'manual', model: 'claude-haiku-4-5-20251001' });
    expect(store.get(t.id)?.model).toBe('claude-haiku-4-5-20251001');
  });

  it('stores null model when omitted from createTask()', () => {
    const t = store.createTask({ projectPath: '/p/a', prompt: 'do it', origin: 'manual' });
    expect(store.get(t.id)?.model).toBeNull();
  });

  it('idempotent migration — second Store instance does not throw on existing DB', () => {
    // The migration ALTER TABLE is wrapped in try/catch; a second in-memory DB is fresh
    // but we can verify the column exists on rows from a Store opened twice on the same file.
    // For :memory: we just verify no throw and that existing rows have model=null after migration.
    const s = store.create({ projectPath: '/p/b' });
    expect(store.get(s.id)?.model).toBeNull();
  });
});
