// server/test/sessionManager.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { SessionManager, BusyError } from '../src/sessionManager.ts';

const cfg = { token: 'x'.repeat(16), projectsRoot: '/p', port: 1, model: 'claude-opus-4-8', memoryMining: false, memoryModel: 'm' };

// A fake query() that yields an init message then an assistant message then a result.
function fakeQuery() {
  return async function* () {
    yield { type: 'system', subtype: 'init', session_id: 'sdk-abc', uuid: 'u0' };
    yield { type: 'assistant', uuid: 'u1', message: { content: [{ type: 'text', text: 'hello' }] } };
    yield { type: 'result', subtype: 'success', uuid: 'u2', result: 'hello' };
  };
}

describe('SessionManager', () => {
  let store: Store;
  let mgr: SessionManager;

  beforeEach(() => {
    store = new Store(':memory:');
    // queryFn ignores its args and returns the fake async iterable
    mgr = new SessionManager(store, cfg, () => fakeQuery()());
  });

  it('captures the resume id, persists every message, and emits events', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    const seen: string[] = [];
    mgr.on('event', (ev) => seen.push(ev.type));

    await mgr.send(s.id, 'hi there');

    // user prompt + 3 sdk messages all emitted
    expect(seen).toContain('user');
    expect(seen).toContain('assistant');
    expect(seen).toContain('result');

    // resume id captured
    expect(store.get(s.id)?.sdk_session_id).toBe('sdk-abc');
    // status returned to idle
    expect(store.get(s.id)?.status).toBe('idle');
    // events persisted (user + system + assistant + result = 4)
    expect(store.eventsSince(s.id, 0).length).toBe(4);
  });

  it('records run outcome for task sessions but leaves chat sessions untouched', async () => {
    const chat = store.create({ projectPath: '/p/alpha' });
    await mgr.send(chat.id, 'hi');
    expect(store.get(chat.id)?.result == null).toBe(true);
    expect(store.get(chat.id)?.ended_at == null).toBe(true);

    const task = store.createTask({ projectPath: '/p/alpha', prompt: 'go', origin: 'manual' });
    await mgr.send(task.id, 'go');
    expect(store.get(task.id)?.result).toBe('success');
    expect(typeof store.get(task.id)?.ended_at).toBe('number');
  });

  it('auto-titles a session from its first prompt and never clobbers it', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    expect(store.get(s.id)?.title).toBeNull();

    await mgr.send(s.id, '  Fix the   login bug\nin auth middleware  ');
    expect(store.get(s.id)?.title).toBe('Fix the login bug in auth middleware');

    // a later prompt must not overwrite the established title
    await mgr.send(s.id, 'now do something else entirely');
    expect(store.get(s.id)?.title).toBe('Fix the login bug in auth middleware');
  });

  it('truncates a long first prompt to ~60 chars with an ellipsis', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    await mgr.send(s.id, 'a'.repeat(200));
    const title = store.get(s.id)?.title ?? '';
    expect(title.length).toBeLessThanOrEqual(58);
    expect(title.endsWith('…')).toBe(true);
  });

  it('rejects a concurrent send with BusyError', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    // a query that never finishes until we let it
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slowMgr = new SessionManager(store, cfg, () =>
      (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-1', uuid: 'a' };
        await gate;
        yield { type: 'result', subtype: 'success', uuid: 'b', result: 'done' };
      })(),
    );
    const turn = slowMgr.send(s.id, 'first');
    await new Promise((r) => setTimeout(r, 5)); // let it start
    expect(slowMgr.isActive(s.id)).toBe(true);
    await expect(slowMgr.send(s.id, 'second')).rejects.toBeInstanceOf(BusyError);
    release();
    await turn;
    expect(slowMgr.isActive(s.id)).toBe(false);
  });

  it('records an error event and sets errored status when the query throws', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    const boomMgr = new SessionManager(store, cfg, () =>
      (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-2', uuid: 'a' };
        throw new Error('cli exploded');
      })(),
    );
    await expect(boomMgr.send(s.id, 'go')).rejects.toThrow(/cli exploded/);
    expect(store.get(s.id)?.status).toBe('errored');
    const types = store.eventsSince(s.id, 0).map((e) => e.type);
    expect(types).toContain('error');
  });

  it('cancel() aborts an active turn: emits cancelled event, status idle, isActive false', async () => {
    const s = store.create({ projectPath: '/p/alpha' });

    // A fake that blocks waiting on the abort signal, then throws when aborted
    const cancelMgr = new SessionManager(store, cfg, (args) =>
      (async function* () {
        const signal = (args.options.abortController as AbortController).signal;
        yield { type: 'system', subtype: 'init', session_id: 'sdk-cancel', uuid: 'c0' };
        // block until aborted
        await new Promise<void>((_, rej) =>
          signal.addEventListener('abort', () => rej(new Error('aborted'))),
        );
        yield { type: 'result', uuid: 'c1', result: 'never' };
      })(),
    );

    const turnPromise = cancelMgr.send(s.id, 'long work');
    // let the generator reach the blocking await
    await new Promise((r) => setTimeout(r, 5));
    expect(cancelMgr.isActive(s.id)).toBe(true);

    const wasCancelled = cancelMgr.cancel(s.id);
    expect(wasCancelled).toBe(true);

    // send() should resolve (not reject) after cancel
    await expect(turnPromise).resolves.toBeUndefined();

    expect(cancelMgr.isActive(s.id)).toBe(false);
    expect(store.get(s.id)?.status).toBe('idle');
    const types = store.eventsSince(s.id, 0).map((e) => e.type);
    expect(types).toContain('cancelled');
    expect(types).not.toContain('errored');
  });

  it('cancel() returns false when session is not active', () => {
    const s = store.create({ projectPath: '/p/alpha' });
    expect(mgr.cancel(s.id)).toBe(false);
  });

  it('passes session model to queryFn options when set', async () => {
    const s = store.create({ projectPath: '/p/alpha', model: 'claude-sonnet-4-6' });
    let capturedModel: unknown;
    const modelMgr = new SessionManager(store, cfg, (args) => {
      capturedModel = args.options.model;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-m', uuid: 'm0' };
        yield { type: 'result', uuid: 'm1', result: 'ok' };
      })();
    });
    await modelMgr.send(s.id, 'hi');
    expect(capturedModel).toBe('claude-sonnet-4-6');
  });

  it('passes session effort to queryFn options when set', async () => {
    const s = store.create({ projectPath: '/p/alpha', effort: 'xhigh' });
    let capturedEffort: unknown;
    const effortMgr = new SessionManager(store, cfg, (args) => {
      capturedEffort = args.options.effort;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-e', uuid: 'e0' };
        yield { type: 'result', uuid: 'e1', result: 'ok' };
      })();
    });
    await effortMgr.send(s.id, 'hi');
    expect(capturedEffort).toBe('xhigh');
  });

  it('omits effort for chat when session effort is null and cfg.chatEffort is empty', async () => {
    const s = store.create({ projectPath: '/p/alpha' }); // no effort
    let captured: Record<string, unknown> | undefined;
    const effortMgr = new SessionManager(store, { ...cfg, chatEffort: '' }, (args) => {
      captured = args.options;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-e2', uuid: 'f0' };
        yield { type: 'result', uuid: 'f1', result: 'ok' };
      })();
    });
    await effortMgr.send(s.id, 'hi');
    expect(captured && 'effort' in captured).toBe(false);
  });

  it('defaults interactive chat effort to xhigh when the session sets none', async () => {
    const s = store.create({ projectPath: '/p/alpha' }); // chat, no effort
    let captured: unknown;
    const effortMgr = new SessionManager(store, cfg, (args) => {
      captured = args.options.effort;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-cd', uuid: 'g0' };
        yield { type: 'result', uuid: 'g1', result: 'ok' };
      })();
    });
    await effortMgr.send(s.id, 'hi');
    expect(captured).toBe('xhigh');
  });

  it('does not default effort for task runs (only chat)', async () => {
    const t = store.createTask({ projectPath: '/p/alpha', prompt: 'go', origin: 'cron' }); // no effort
    let captured: Record<string, unknown> | undefined;
    const effortMgr = new SessionManager(store, cfg, (args) => {
      captured = args.options;
      return (async function* () {
        yield { type: 'result', uuid: 'h1', result: 'ok' };
      })();
    });
    await effortMgr.send(t.id, 'go');
    expect(captured && 'effort' in captured).toBe(false);
  });

  it('passes disallowedTools to queryFn options when the session disables tools', async () => {
    const s = store.create({ projectPath: '/p/alpha', disabledTools: ['Bash', 'WebFetch'] });
    let captured: unknown;
    const mgr2 = new SessionManager(store, cfg, (args) => {
      captured = args.options.disallowedTools;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-t', uuid: 't0' };
        yield { type: 'result', uuid: 't1', result: 'ok' };
      })();
    });
    await mgr2.send(s.id, 'hi');
    expect(captured).toEqual(['Bash', 'WebFetch']);
  });

  it('omits disallowedTools when the session disables nothing', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    let opts: Record<string, unknown> | undefined;
    const mgr2 = new SessionManager(store, cfg, (args) => {
      opts = args.options;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-t2', uuid: 'u0' };
        yield { type: 'result', uuid: 'u1', result: 'ok' };
      })();
    });
    await mgr2.send(s.id, 'hi');
    expect(opts && 'disallowedTools' in opts).toBe(false);
  });

  it('tolerates a malformed disabled_tools value (no throw, no gating)', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    // simulate corruption directly through the update path with a non-array via setDisabledTools-bypass:
    // setDisabledTools always writes valid JSON, so force a bad value by re-creating with a raw write.
    (store as unknown as { db: { prepare: (q: string) => { run: (...a: unknown[]) => void } } }).db
      .prepare('UPDATE session SET disabled_tools = ? WHERE id = ?')
      .run('not json', s.id);
    let opts: Record<string, unknown> | undefined;
    const mgr2 = new SessionManager(store, cfg, (args) => {
      opts = args.options;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-t3', uuid: 'v0' };
        yield { type: 'result', uuid: 'v1', result: 'ok' };
      })();
    });
    await mgr2.send(s.id, 'hi');
    expect(opts && 'disallowedTools' in opts).toBe(false);
  });

  it('passes the artifact-delivery system prompt to queryFn', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    let capturedOptions: Record<string, unknown> | undefined;
    const promptMgr = new SessionManager(store, cfg, (args) => {
      capturedOptions = args.options;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-sp', uuid: 'sp0' };
        yield { type: 'result', uuid: 'sp1', result: 'ok' };
      })();
    });
    await promptMgr.send(s.id, 'hi');
    const sp = capturedOptions?.systemPrompt as { type: string; preset: string; append: string };
    expect(sp.type).toBe('preset');
    expect(sp.preset).toBe('claude_code');
    expect(sp.append).toContain('.deck-artifacts');
    expect(sp.append).toContain('/api/file/');
    expect(sp.append).toContain('![');
  });

  it('caps unattended task runs with a default maxTurns but leaves chat uncapped', async () => {
    const oneResult = () => (async function* () { yield { type: 'result', uuid: 'r', result: 'ok' }; })();
    const task = store.createTask({ projectPath: '/p/a', prompt: 'go', origin: 'cron' });
    const chat = store.create({ projectPath: '/p/a' });

    let taskOpts: Record<string, unknown> | undefined;
    await new SessionManager(store, cfg, (a) => { taskOpts = a.options; return oneResult(); }).send(task.id, 'go');
    expect(taskOpts?.maxTurns).toBe(40);

    let chatOpts: Record<string, unknown> | undefined;
    await new SessionManager(store, cfg, (a) => { chatOpts = a.options; return oneResult(); }).send(chat.id, 'hi');
    expect(chatOpts?.maxTurns).toBeUndefined();
  });

  it('honours an explicit cfg.maxTurns for interactive sessions', async () => {
    let opts: Record<string, unknown> | undefined;
    const chat = store.create({ projectPath: '/p/a' });
    const m = new SessionManager(store, { ...cfg, maxTurns: 12 }, (args) => { opts = args.options; return (async function* () { yield { type: 'result', uuid: 'r', result: 'ok' }; })(); });
    await m.send(chat.id, 'hi');
    expect(opts?.maxTurns).toBe(12);
  });

  it('falls back to cfg.model when session model is null', async () => {
    const s = store.create({ projectPath: '/p/alpha' }); // no model
    let capturedModel: unknown;
    const modelMgr = new SessionManager(store, cfg, (args) => {
      capturedModel = args.options.model;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-m2', uuid: 'n0' };
        yield { type: 'result', uuid: 'n1', result: 'ok' };
      })();
    });
    await modelMgr.send(s.id, 'hi');
    expect(capturedModel).toBe('claude-opus-4-8'); // cfg.model
  });

  it('text-only send() passes a string prompt to queryFn (no images path unchanged)', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    let capturedPrompt: unknown;
    const captureMgr = new SessionManager(store, cfg, (args) => {
      capturedPrompt = args.prompt;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-str', uuid: 's0' };
        yield { type: 'result', uuid: 's1', result: 'ok' };
      })();
    });
    await captureMgr.send(s.id, 'plain text');
    expect(typeof capturedPrompt).toBe('string');
    expect(capturedPrompt).toBe('plain text');
  });

  it('send() with images records user_prompt event with images count and passes async iterable to queryFn', async () => {
    const s = store.create({ projectPath: '/p/alpha' });

    const images = [
      { media_type: 'image/png', data: 'abc123' },
      { media_type: 'image/jpeg', data: 'def456' },
    ];

    let capturedPrompt: unknown;
    const imageMgr = new SessionManager(store, cfg, (args) => {
      capturedPrompt = args.prompt;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-img', uuid: 'i0' };
        yield { type: 'result', uuid: 'i1', result: 'ok' };
      })();
    });

    await imageMgr.send(s.id, 'what is in this image?', images);

    // The prompt passed to queryFn must NOT be a string
    expect(typeof capturedPrompt).not.toBe('string');

    // Drain the first yielded message from the async iterable
    const iterable = capturedPrompt as AsyncIterable<any>;
    const iter = iterable[Symbol.asyncIterator]();
    // Note: the generator was already consumed by send() — we capture before it runs.
    // Re-create a fresh iterable for the test by checking the captured prompt type.
    // Since send() already drained it, we verify via event log and type check only.
    // (The iterable is a one-shot generator consumed by send() internally.)

    // Verify user_prompt event has images count = 2
    const events = store.eventsSince(s.id, 0);
    const userEvent = events.find((e) => e.type === 'user');
    expect(userEvent).toBeDefined();
    expect((userEvent!.payload as any).images).toBe(2);
    expect((userEvent!.payload as any).text).toBe('what is in this image?');

    // base64 data NOT stored in event log
    expect(JSON.stringify(userEvent!.payload)).not.toContain('abc123');
  });

  it('send() with images builds correct content blocks (verified via fresh iterable)', async () => {
    const s = store.create({ projectPath: '/p/alpha' });

    const images = [{ media_type: 'image/png', data: 'base64imgdata' }];

    // Capture the prompt by intercepting before consumption
    let capturedPrompt: string | AsyncIterable<any> | undefined;
    const imageMgr = new SessionManager(store, cfg, (args) => {
      capturedPrompt = args.prompt;
      // Return a minimal iterable (don't drain capturedPrompt here)
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-img2', uuid: 'j0' };
        yield { type: 'result', uuid: 'j1', result: 'ok' };
      })();
    });

    // We need to capture the prompt BEFORE send() drains it.
    // Since queryFn is called synchronously within send(), capturedPrompt is set
    // before the generator is drained. But once set, send() will drain it.
    // So we verify structural properties by constructing the same generator inline.
    // Instead, use a trick: wrap the iterable to spy on its values.
    let firstYieldedMsg: any;
    const spyMgr = new SessionManager(store, cfg, (args) => {
      // Wrap the prompt iterable to capture what gets yielded
      const originalPrompt = args.prompt;
      return (async function* () {
        if (typeof originalPrompt !== 'string') {
          for await (const msg of originalPrompt) {
            firstYieldedMsg = msg;
          }
        }
        yield { type: 'system', subtype: 'init', session_id: 'sdk-img3', uuid: 'k0' };
        yield { type: 'result', uuid: 'k1', result: 'ok' };
      })();
    });

    const s2 = store.create({ projectPath: '/p/alpha' });
    await spyMgr.send(s2.id, 'describe this', images);

    // The first yielded message must be an SDKUserMessage with image block
    expect(firstYieldedMsg).toBeDefined();
    expect(firstYieldedMsg.type).toBe('user');
    expect(firstYieldedMsg.parent_tool_use_id).toBeNull();
    expect(firstYieldedMsg.message.role).toBe('user');

    const content: any[] = firstYieldedMsg.message.content;
    expect(Array.isArray(content)).toBe(true);

    // Should have a text block
    const textBlock = content.find((b: any) => b.type === 'text');
    expect(textBlock).toBeDefined();
    expect(textBlock.text).toBe('describe this');

    // Should have an image block
    const imageBlock = content.find((b: any) => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock.source.type).toBe('base64');
    expect(imageBlock.source.media_type).toBe('image/png');
    expect(imageBlock.source.data).toBe('base64imgdata');
  });

  it('retries a transient (529) failure with resume, then finishes idle', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    const calls: any[] = [];
    const m = new SessionManager(store, { ...cfg, retryBaseMs: 0 }, (args) => {
      calls.push(args);
      const n = calls.length;
      return (async function* () {
        if (n === 1) {
          yield { type: 'system', subtype: 'init', session_id: 'sdk-r', uuid: 'a' };
          throw Object.assign(new Error('Overloaded'), { status: 529 });
        }
        yield { type: 'result', subtype: 'success', uuid: 'b', result: 'ok' };
      })();
    });
    await m.send(s.id, 'go');
    expect(calls.length).toBe(2);
    expect(store.get(s.id)?.status).toBe('idle');
    const types = store.eventsSince(s.id, 0).map((e) => e.type);
    expect(types).toContain('retry');
    expect(types).not.toContain('error');
    // 2nd attempt resumed the session and continued (not the original prompt)
    expect(calls[1].options.resume).toBe('sdk-r');
    expect(typeof calls[1].prompt).toBe('string');
    expect(calls[1].prompt).not.toBe('go');
  });

  it('gives up after maxTransientRetries and records an error', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    let calls = 0;
    const m = new SessionManager(store, { ...cfg, retryBaseMs: 0, maxTransientRetries: 2 }, () => {
      calls++;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-x', uuid: 'a' };
        throw Object.assign(new Error('502 Bad Gateway'), { status: 502 });
      })();
    });
    await expect(m.send(s.id, 'go')).rejects.toThrow(/502/);
    expect(calls).toBe(3); // initial + 2 retries
    expect(store.get(s.id)?.status).toBe('errored');
  });

  it('does not retry a non-transient error (fails fast)', async () => {
    const s = store.create({ projectPath: '/p/alpha' });
    let calls = 0;
    const m = new SessionManager(store, { ...cfg, retryBaseMs: 0 }, () => {
      calls++;
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sdk-nt', uuid: 'a' };
        throw Object.assign(new Error('invalid request: bad schema'), { status: 400 });
      })();
    });
    await expect(m.send(s.id, 'go')).rejects.toThrow(/invalid request/);
    expect(calls).toBe(1); // no retry
    expect(store.get(s.id)?.status).toBe('errored');
  });
});
