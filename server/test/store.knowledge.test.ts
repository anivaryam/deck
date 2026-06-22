import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('Store knowledge CRUD', () => {
  it('remembers a fact and loads it by scope', () => {
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'error-msgs', fact: 'user wants explicit user-facing error messages' });
    store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'github-account', fact: 'alpha pushes to acme-bot' });
    const alpha = store.loadScopedFacts('/p/alpha');
    expect(alpha.map((f) => f.fact).sort()).toEqual([
      'alpha pushes to acme-bot',
      'user wants explicit user-facing error messages',
    ]);
  });

  it('loadScopedFacts excludes other projects but always includes global', () => {
    store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'k', fact: 'alpha-only' });
    store.rememberFact({ scope: '/p/beta', kind: 'binding', key: 'k', fact: 'beta-only' });
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'g', fact: 'everywhere' });
    const beta = store.loadScopedFacts('/p/beta');
    const facts = beta.map((f) => f.fact);
    expect(facts).toContain('beta-only');
    expect(facts).toContain('everywhere');
    expect(facts).not.toContain('alpha-only');
  });

  it('re-remembering the same (scope,key) supersedes, never duplicates', () => {
    store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'github-account', fact: 'old: personal' });
    const updated = store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'github-account', fact: 'new: acme-bot' });
    expect(updated.fact).toBe('new: acme-bot');
    expect(updated.kind).toBe('binding');
    const facts = store.loadScopedFacts('/p/alpha');
    expect(facts.length).toBe(1);
    expect(facts[0].fact).toBe('new: acme-bot');
  });

  it('NULL-key facts coexist (free-form, never collide)', () => {
    store.rememberFact({ scope: 'global', kind: 'preference', fact: 'fact one' });
    store.rememberFact({ scope: 'global', kind: 'preference', fact: 'fact two' });
    const r = store.rememberFact({ scope: 'global', kind: 'preference', fact: 'fact three' });
    expect(r.fact).toBe('fact three');
    expect(r.id).toBeGreaterThan(0);
    expect(store.loadScopedFacts('/p/alpha').length).toBe(3);
  });

  it('forgetFact removes a fact by (scope,key) and reports whether it hit', () => {
    store.rememberFact({ scope: '/p/alpha', kind: 'rule', key: 'no-claude-md', fact: 'never commit CLAUDE.md' });
    expect(store.forgetFact('/p/alpha', 'no-claude-md')).toBe(true);
    expect(store.forgetFact('/p/alpha', 'no-claude-md')).toBe(false);
    expect(store.loadScopedFacts('/p/alpha').length).toBe(0);
  });
});

describe('Store knowledge FTS recall', () => {
  beforeEach(() => {
    store.rememberFact({ scope: '/p/alpha', kind: 'binding', key: 'stripe', fact: 'alpha wired Stripe webhooks via the CLI' });
    store.rememberFact({ scope: '/p/beta', kind: 'convention', key: 'ci', fact: 'beta runs lint on push' });
    store.rememberFact({ scope: 'global', kind: 'preference', key: 'db', fact: 'prefers SQLite FTS over vector databases' });
  });

  it('recallFacts finds a fact from ANY scope (cross-project query)', () => {
    const hits = store.recallFacts('stripe webhooks');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].fact).toContain('Stripe');
  });

  it('recallFacts matches across scope boundaries from a different project', () => {
    const hits = store.recallFacts('vector database');
    expect(hits.map((h) => h.fact).join(' ')).toContain('SQLite FTS');
  });

  it('recallFacts returns [] for an empty or blank query (no FTS syntax error)', () => {
    expect(store.recallFacts('')).toEqual([]);
    expect(store.recallFacts('   ')).toEqual([]);
  });

  it('recallFacts does not throw on punctuation-only / quote input', () => {
    expect(() => store.recallFacts('"); drop')).not.toThrow();
  });

  it('forgetFact also drops the fact from FTS (no stale recall)', () => {
    store.forgetFact('/p/alpha', 'stripe');
    expect(store.recallFacts('stripe webhooks')).toEqual([]);
  });

  it('recallFacts reflects superseded content (update trigger keeps FTS in sync)', () => {
    store.rememberFact({ scope: '/p/gamma', kind: 'binding', key: 'billing', fact: 'gamma uses Braintree' });
    expect(store.recallFacts('Braintree')).toHaveLength(1);
    store.rememberFact({ scope: '/p/gamma', kind: 'binding', key: 'billing', fact: 'gamma switched to Paddle' });
    expect(store.recallFacts('Braintree')).toEqual([]);   // old term gone from FTS
    expect(store.recallFacts('Paddle')).toHaveLength(1);   // new term indexed
  });
});
