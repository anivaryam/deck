import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { SessionManager } from '../src/sessionManager.ts';

let store: Store;
const cfg = { token: 't', projectsRoot: '/p', port: 1, model: 'claude-opus-4-8', memoryMining: false, memoryModel: 'm' } as any;
beforeEach(() => { store = new Store(':memory:'); });

function captureOptions() {
  const seen: any = {};
  const queryFn = ({ options }: any) => {
    Object.assign(seen, options);
    return (async function* () { /* no events */ })();
  };
  return { seen, queryFn };
}

describe('sessionManager memory injection', () => {
  it('appends global + this-project facts to the system prompt', async () => {
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'err', fact: 'always show clear error messages' });
    store.rememberFact({ scope: '/proj', kind: 'binding', key: 'gh', fact: 'proj pushes to acme-bot' });
    store.rememberFact({ scope: '/other', kind: 'binding', key: 'gh', fact: 'other pushes to evil-bot' });

    const { seen, queryFn } = captureOptions();
    const mgr = new SessionManager(store, cfg, queryFn);
    const s = store.create({ projectPath: '/proj' });
    await mgr.send(s.id, 'hello');

    const append: string = seen.systemPrompt.append;
    expect(append).toContain('always show clear error messages');
    expect(append).toContain('proj pushes to acme-bot');
    expect(append).not.toContain('evil-bot');
    expect(append).toContain('Learned memory');
  });

  it('scopes by project_path, not cwd (goal worktree still gets home-project facts)', async () => {
    store.rememberFact({ scope: '/proj', kind: 'rule', key: 'r', fact: 'never commit CLAUDE.md here' });
    const { seen, queryFn } = captureOptions();
    const mgr = new SessionManager(store, cfg, queryFn);
    const s = store.createTask({ projectPath: '/proj', prompt: 'p', origin: 'goal', sourceKind: 'goal', cwd: '/home/u/.deck/goal-worktrees/abc' });
    await mgr.send(s.id, 'go');
    expect(seen.systemPrompt.append).toContain('never commit CLAUDE.md here');
  });

  it('omits the memory header entirely when there are no facts', async () => {
    const { seen, queryFn } = captureOptions();
    const mgr = new SessionManager(store, cfg, queryFn);
    const s = store.create({ projectPath: '/empty' });
    await mgr.send(s.id, 'hello');
    expect(seen.systemPrompt.append).not.toContain('Learned memory');
  });

  it('always includes the capture rule so the model knows to use remember', async () => {
    const { seen, queryFn } = captureOptions();
    const mgr = new SessionManager(store, cfg, queryFn);
    const s = store.create({ projectPath: '/empty' });
    await mgr.send(s.id, 'hello');
    expect(seen.systemPrompt.append).toMatch(/remember/i);
  });
});
