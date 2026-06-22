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

  it('parses maxTurns / task model+effort / cron-min-interval / session TTL', () => {
    const cfg = loadConfig({
      ...base,
      DECK_MAX_TURNS: '25',
      DECK_TASK_MODEL: 'claude-sonnet-4-5',
      DECK_TASK_EFFORT: 'low',
      DECK_CRON_MIN_INTERVAL_SEC: '120',
      DECK_SESSION_TTL_DAYS: '3',
    });
    expect(cfg.maxTurns).toBe(25);
    expect(cfg.taskModel).toBe('claude-sonnet-4-5');
    expect(cfg.taskEffort).toBe('low');
    expect(cfg.cronMinIntervalSec).toBe(120);
    expect(cfg.sessionTtlMs).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it('rejects DECK_MAX_TURNS=0, negative, or non-integer (would disable the unattended cap)', () => {
    expect(loadConfig({ ...base, DECK_MAX_TURNS: '0' }).maxTurns).toBeUndefined();
    expect(loadConfig({ ...base, DECK_MAX_TURNS: '-5' }).maxTurns).toBeUndefined();
    expect(loadConfig({ ...base, DECK_MAX_TURNS: '2.5' }).maxTurns).toBeUndefined();
    expect(loadConfig({ ...base, DECK_MAX_TURNS: 'abc' }).maxTurns).toBeUndefined();
  });

  it('applies sane defaults when the new knobs are unset', () => {
    const cfg = loadConfig(base);
    expect(cfg.maxTurns).toBeUndefined();
    expect(cfg.taskModel).toBeUndefined();
    expect(cfg.cronMinIntervalSec).toBe(60);
    expect(cfg.sessionTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('goalMaxTurns', () => {
  it('defaults to 150 and reads DECK_GOAL_MAX_TURNS', () => {
    const base = { DECK_TOKEN: 'a-long-test-token-value-1234', ANTHROPIC_API_KEY: 'k' };
    expect(loadConfig({ ...base } as any).goalMaxTurns).toBe(150);
    expect(loadConfig({ ...base, DECK_GOAL_MAX_TURNS: '50' } as any).goalMaxTurns).toBe(50);
  });
});

describe('goalMaxIterations', () => {
  it('defaults to 3 and reads DECK_GOAL_MAX_ITERATIONS', () => {
    const base = { DECK_TOKEN: 'a-long-test-token-value-1234', ANTHROPIC_API_KEY: 'k' };
    expect(loadConfig({ ...base } as any).goalMaxIterations).toBe(3);
    expect(loadConfig({ ...base, DECK_GOAL_MAX_ITERATIONS: '7' } as any).goalMaxIterations).toBe(7);
  });
});

describe('memory mining config', () => {
  it('defaults: mining on, haiku model', () => {
    const c = loadConfig({ DECK_TOKEN: 'a-long-test-token-value-1234', PROJECTS_ROOTS: '/tmp' } as any);
    expect(c.memoryMining).toBe(true);
    expect(c.memoryModel).toBe('claude-haiku-4-5-20251001');
  });
  it('honors overrides', () => {
    const c = loadConfig({ DECK_TOKEN: 'a-long-test-token-value-1234', PROJECTS_ROOTS: '/tmp', DECK_MEMORY_MINING: 'false', DECK_MEMORY_MODEL: 'claude-sonnet-4-6' } as any);
    expect(c.memoryMining).toBe(false);
    expect(c.memoryModel).toBe('claude-sonnet-4-6');
  });
});
