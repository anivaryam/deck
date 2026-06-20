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

describe('Store cron prompt is always a string', () => {
  it('coerces a Buffer prompt on write so it never serializes as a Buffer', () => {
    const c = store.createCron({
      schedule: '0 3 * * *',
      projectPath: '/p/a',
      // A Buffer used to bind as a BLOB → returned as {type:"Buffer",data:[...]}.
      prompt: Buffer.from('hello', 'utf8') as unknown as string,
    });
    expect(typeof c.prompt).toBe('string');
    expect(c.prompt).toBe('hello');
  });

  it('coerces a legacy BLOB prompt to a string on read', () => {
    const c = store.createCron({ schedule: '0 3 * * *', projectPath: '/p/a', prompt: 'x' });
    // Simulate a pre-fix row by writing a raw BLOB straight into the column.
    (store as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db
      .prepare('UPDATE cron SET prompt = ? WHERE id = ?')
      .run(Buffer.from('legacy', 'utf8'), c.id);
    const got = store.getCron(c.id)!;
    expect(typeof got.prompt).toBe('string');
    expect(got.prompt).toBe('legacy');
    expect(store.listCron().find((r) => r.id === c.id)!.prompt).toBe('legacy');
  });
});
