import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;

beforeEach(() => {
  store = new Store(':memory:');
});

describe('Store.updateCron', () => {
  it('updates schedule and prompt in place', () => {
    const c = store.createCron({ schedule: '0 3 * * *', projectPath: '/p/a', prompt: 'old' });
    store.updateCron(c.id, { schedule: '0 4 * * *', prompt: 'new' });
    const got = store.getCron(c.id)!;
    expect(got.schedule).toBe('0 4 * * *');
    expect(got.prompt).toBe('new');
  });

  it('updates only the provided field', () => {
    const c = store.createCron({ schedule: '0 3 * * *', projectPath: '/p/a', prompt: 'keep' });
    store.updateCron(c.id, { schedule: '*/10 * * * *' });
    const got = store.getCron(c.id)!;
    expect(got.schedule).toBe('*/10 * * * *');
    expect(got.prompt).toBe('keep');
  });

  it('is a no-op when the patch is empty', () => {
    const c = store.createCron({ schedule: '0 3 * * *', projectPath: '/p/a', prompt: 'keep' });
    store.updateCron(c.id, {});
    const got = store.getCron(c.id)!;
    expect(got.schedule).toBe('0 3 * * *');
    expect(got.prompt).toBe('keep');
  });
});
