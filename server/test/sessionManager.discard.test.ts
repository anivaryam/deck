// server/test/sessionManager.discard.test.ts
import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.ts';
import { SessionManager, type QueryFn } from '../src/sessionManager.ts';

const cfg = { token: 'x'.repeat(16), projectsRoot: '/p', port: 1, model: 'claude-opus-4-8' };

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('SessionManager.discard', () => {
  it('aborts a running turn and suppresses the trailing cancelled event', async () => {
    const store = new Store(':memory:');
    const s = store.create({ projectPath: '/p/proj' });

    const gate = deferred();
    // Fake SDK stream: emit one assistant message, pause, then THROW on abort
    // (this is what the real SDK does when the AbortController fires).
    const queryFn: QueryFn = ((args: { options: { abortController: AbortController } }) =>
      (async function* () {
        yield { type: 'assistant', uuid: 'a1' };
        await gate.promise;
        if (args.options.abortController.signal.aborted) throw new Error('aborted');
        yield { type: 'assistant', uuid: 'a2' };
      })()) as unknown as QueryFn;

    const mgr = new SessionManager(store, cfg, queryFn);
    const turn = mgr.send(s.id, 'hello'); // do NOT await yet

    await new Promise((r) => setTimeout(r, 15)); // let user + a1 be recorded
    expect(store.eventsSince(s.id, 0).length).toBe(2); // user prompt + assistant a1
    expect(mgr.isActive(s.id)).toBe(true);

    mgr.discard(s.id); // mark deleting + abort
    gate.resolve();    // generator wakes, sees abort, throws
    await turn;        // resolves (cancel path does not rethrow)

    const events = store.eventsSince(s.id, 0);
    expect(events).toHaveLength(2); // no 'cancelled', no a2
    expect(events.some((e) => e.type === 'cancelled')).toBe(false);
    expect(mgr.isActive(s.id)).toBe(false);
  });

  it('does not permanently mute an idle session it was called on', async () => {
    const store = new Store(':memory:');
    const s = store.create({ projectPath: '/p/proj' });

    // A normal, completing fake turn.
    const queryFn: QueryFn = (() =>
      (async function* () {
        yield { type: 'assistant', uuid: 'b1' };
        yield { type: 'result', subtype: 'success', uuid: 'b2', result: 'ok' };
      })()) as unknown as QueryFn;

    const mgr = new SessionManager(store, cfg, queryFn);

    // discard with no turn in flight must NOT leave the id stuck in `deleting`.
    mgr.discard(s.id);

    await mgr.send(s.id, 'hello');

    // Events recorded normally afterward: user prompt + b1 + b2 = 3.
    expect(store.eventsSince(s.id, 0).length).toBe(3);
  });
});
