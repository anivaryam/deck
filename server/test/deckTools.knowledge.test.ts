import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { looksLikeSecret, rememberHandler, recallHandler, forgetHandler, buildDeckMcp, deckToolNames } from '../src/deckTools.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

// Synthetic credential-shaped strings, assembled at runtime from split fragments
// so NO scanner-matchable literal exists in source. This is a secret-DETECTION
// test — the values are fake but must match the real credential shapes the guard
// looks for. Concatenation breaks the contiguous pattern push-scanners flag.
const FAKE = {
  ghpPat: 'ghp_' + 'aBc123DeF456gHi789JkL012mNo345PqR67',
  ghFineGrained: 'github_' + 'pat_11ABCDEFG0123456789_aBcDeFgHiJkLmNoPqRsT',
  openai: 'sk-' + 'abcdEFGH1234567890abcdEFGH1234567890abcd',
  openaiProj: 'sk-proj-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  anthropic: 'sk-ant-' + 'api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123',
  slackBot: 'xoxb-' + '12345678901-abcdEFGHijklMNOP',
  slackRefresh: 'xoxr-' + '12345678901-abcdEFGHijklMNOP',
  aws: 'AKIA' + 'IOSFODNN7EXAMPLE',
  jwt: 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF_ghiJKL-mnoPQR',
  pemOpenssh: '-----BEGIN OPENSSH PRIVATE ' + 'KEY-----\nb3BlbnNz',
  pemRsa: '-----BEGIN RSA PRIVATE ' + 'KEY-----',
};

describe('looksLikeSecret', () => {
  it('flags common credential shapes', () => {
    expect(looksLikeSecret(`token is ${FAKE.ghpPat}`)).toBe(true);
    expect(looksLikeSecret(FAKE.ghFineGrained)).toBe(true);
    expect(looksLikeSecret(`use ${FAKE.openai}`)).toBe(true);
    expect(looksLikeSecret(`slack ${FAKE.slackBot}`)).toBe(true);
    expect(looksLikeSecret(FAKE.aws)).toBe(true);
    expect(looksLikeSecret('password=hunter2longenoughvalue')).toBe(true);
    expect(looksLikeSecret(FAKE.jwt)).toBe(true);
    expect(looksLikeSecret(FAKE.pemOpenssh)).toBe(true);
    expect(looksLikeSecret(FAKE.pemRsa)).toBe(true);
    expect(looksLikeSecret(`refresh ${FAKE.slackRefresh}`)).toBe(true);
    expect(looksLikeSecret(`my key is ${FAKE.anthropic}`)).toBe(true);
    expect(looksLikeSecret(FAKE.openaiProj)).toBe(true);
  });

  it('does NOT flag plain reference facts', () => {
    expect(looksLikeSecret('alpha pushes to GitHub account acme-bot')).toBe(false);
    expect(looksLikeSecret('uses Supabase MCP project ref staging-xyz')).toBe(false);
    expect(looksLikeSecret('user wants explicit user-facing error messages')).toBe(false);
    expect(looksLikeSecret('typecheck = bun run typecheck')).toBe(false);
    expect(looksLikeSecret('this is a normal sentence about error handling and UX')).toBe(false);
  });
});

describe('knowledge MCP handlers', () => {
  it('rememberHandler with scope=project stores under the bound project_path', async () => {
    const res = await rememberHandler(store, '/p/alpha', { fact: 'alpha pushes to acme-bot', kind: 'binding', scope: 'project', key: 'github-account' });
    expect(res.content[0].text).toMatch(/remembered/i);
    const facts = store.loadScopedFacts('/p/alpha');
    expect(facts.length).toBe(1);
    expect(facts[0].scope).toBe('/p/alpha');
    expect(facts[0].kind).toBe('binding');
  });

  it('rememberHandler with scope=global stores globally', async () => {
    await rememberHandler(store, '/p/alpha', { fact: 'prefers SQLite FTS', kind: 'preference', scope: 'global', key: 'db' });
    expect(store.loadScopedFacts('/p/other').some((f) => f.fact === 'prefers SQLite FTS')).toBe(true);
  });

  it('rememberHandler rejects secret-shaped facts without storing', async () => {
    const res = await rememberHandler(store, '/p/alpha', { fact: `token ${FAKE.ghpPat}`, kind: 'binding', scope: 'project', key: 'tok' });
    expect(res.content[0].text).toMatch(/reference, not the secret|not stored/i);
    expect(store.loadScopedFacts('/p/alpha').length).toBe(0);
  });

  it('recallHandler finds facts from other projects', async () => {
    store.rememberFact({ scope: '/p/beta', kind: 'binding', key: 'stripe', fact: 'beta wired Stripe webhooks' });
    const res = await recallHandler(store, { query: 'stripe webhooks' });
    expect(res.content[0].text).toContain('Stripe');
  });

  it('recallHandler reports none cleanly', async () => {
    const res = await recallHandler(store, { query: 'nonexistent topic xyz' });
    expect(res.content[0].text).toBe('(no matching facts)');
  });

  it('forgetHandler removes a project-scoped fact', async () => {
    store.rememberFact({ scope: '/p/alpha', kind: 'rule', key: 'no-claude-md', fact: 'never commit CLAUDE.md' });
    const res = await forgetHandler(store, '/p/alpha', { scope: 'project', key: 'no-claude-md' });
    expect(res.content[0].text).toMatch(/forgotten/i);
    expect(store.loadScopedFacts('/p/alpha').length).toBe(0);
  });

  it('recallHandler shows the real scope path of another project (not just "project")', async () => {
    store.rememberFact({ scope: '/p/beta', kind: 'binding', key: 'stripe', fact: 'beta wired Stripe webhooks' });
    const res = await recallHandler(store, { query: 'stripe webhooks' });
    expect(res.content[0].text).toContain('/p/beta');
  });

  it('deckToolNames always includes remember/recall/forget', () => {
    expect(deckToolNames()).toEqual(expect.arrayContaining(['remember', 'recall', 'forget']));
  });

  it('buildDeckMcp builds with the knowledge tools without throwing', () => {
    expect(buildDeckMcp(store, '/p/alpha')).toBeTruthy();
  });
});
