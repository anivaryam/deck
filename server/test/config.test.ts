// server/test/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.ts';

const base = {
  DECK_TOKEN: 'a-sufficiently-long-secret-value',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  PROJECTS_ROOT: '/tmp/projects',
  PORT: '9000',
  DECK_MODEL: 'claude-opus-4-8',
};

describe('loadConfig', () => {
  it('loads a valid config', () => {
    const cfg = loadConfig(base);
    expect(cfg.token).toBe(base.DECK_TOKEN);
    expect(cfg.projectsRoot).toBe('/tmp/projects');
    expect(cfg.port).toBe(9000);
    expect(cfg.model).toBe('claude-opus-4-8');
  });

  it('throws when DECK_TOKEN is missing', () => {
    expect(() => loadConfig({ ...base, DECK_TOKEN: undefined })).toThrow(/DECK_TOKEN/);
  });

  it('throws when DECK_TOKEN is too short', () => {
    expect(() => loadConfig({ ...base, DECK_TOKEN: 'short' })).toThrow(/16/);
  });

  it('throws when no model auth is present', () => {
    const env = { ...base, ANTHROPIC_API_KEY: undefined } as Record<string, string | undefined>;
    expect(() => loadConfig(env, { credentialsExist: false })).toThrow(/model auth/);
  });

  it('accepts a local credential as fallback model auth', () => {
    const env = { ...base, ANTHROPIC_API_KEY: undefined } as Record<string, string | undefined>;
    const cfg = loadConfig(env, { credentialsExist: true });
    expect(cfg.token).toBe(base.DECK_TOKEN);
  });

  it('defaults projectsRoots to the single PROJECTS_ROOT', () => {
    const cfg = loadConfig(base);
    expect(cfg.projectsRoots).toEqual(['/tmp/projects']);
    expect(cfg.projectsRoot).toBe('/tmp/projects');
  });

  it('parses PROJECTS_ROOTS into an ordered, deduped list (first is the default root)', () => {
    const env = { ...base, PROJECTS_ROOTS: '/tmp/projects:/tmp/tools:/tmp/projects' };
    const cfg = loadConfig(env);
    expect(cfg.projectsRoots).toEqual(['/tmp/projects', '/tmp/tools']);
    expect(cfg.projectsRoot).toBe('/tmp/projects');
  });

  it('ignores empty segments in PROJECTS_ROOTS', () => {
    const env = { ...base, PROJECTS_ROOTS: '/tmp/projects::/tmp/tools:' };
    const cfg = loadConfig(env);
    expect(cfg.projectsRoots).toEqual(['/tmp/projects', '/tmp/tools']);
  });
});
