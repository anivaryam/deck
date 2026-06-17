// server/src/config.ts
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface Config {
  token: string;
  /** First (default) projects root — where new projects are created. */
  projectsRoot: string;
  /** All projects roots to scan/resolve, in priority order. First match wins.
   *  Optional in the type so partial test fixtures stay valid; loadConfig always
   *  populates it. Consumers fall back to `[projectsRoot]` when absent. */
  projectsRoots?: string[];
  port: number;
  model: string;
  publicOrigin?: string;
  /** SDK permissionMode. Defaults to 'bypassPermissions' (the product's point: a
   *  full-power personal agent). Set DECK_PERMISSION_MODE=default to require the
   *  SDK's own permission prompts/allowlist instead. */
  permissionMode?: string;
  /** Send the auth cookie with the Secure flag. Defaults to true. Set
   *  DECK_COOKIE_SECURE=false only behind a plain-HTTP proxy that breaks the
   *  localhost secure-context exemption. */
  cookieSecure?: boolean;
}

type Env = Record<string, string | undefined>;

function localCredentialsExist(): boolean {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return fs.existsSync(path.join(dir, '.credentials.json'));
}

export function loadConfig(
  env: Env = process.env,
  opts: { credentialsExist?: boolean } = {},
): Config {
  const token = env.DECK_TOKEN;
  if (!token) throw new Error('DECK_TOKEN is required');
  if (token.length < 16) throw new Error('DECK_TOKEN must be at least 16 characters');
  if (/^change-me/i.test(token)) {
    throw new Error('DECK_TOKEN is still the example placeholder — set a real random secret (e.g. `openssl rand -hex 24`)');
  }

  const credsExist = opts.credentialsExist ?? localCredentialsExist();
  const hasEnvAuth = Boolean(
    env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_USE_BEDROCK || env.CLAUDE_CODE_USE_VERTEX,
  );
  if (!hasEnvAuth && !credsExist) {
    throw new Error(
      'No model auth: set ANTHROPIC_API_KEY (or a provider env), or log in with the Claude Code CLI',
    );
  }

  // PROJECTS_ROOTS (plural, path-delimiter-separated) lists every root to scan.
  // Falls back to the single PROJECTS_ROOT (or cwd) for backward compatibility.
  const rawRoots = env.PROJECTS_ROOTS
    ? env.PROJECTS_ROOTS.split(path.delimiter)
    : [env.PROJECTS_ROOT || process.cwd()];
  // Resolve to absolute paths and dedup, preserving priority order. Existence is
  // NOT validated here — listProjects/resolveProjectPath tolerate a missing root
  // (skip on read), so a briefly-absent root doesn't crash startup.
  const seen = new Set<string>();
  const projectsRoots: string[] = [];
  for (const r of rawRoots) {
    const trimmed = r.trim();
    if (!trimmed) continue;
    const abs = path.resolve(trimmed);
    if (seen.has(abs)) continue;
    seen.add(abs);
    projectsRoots.push(abs);
  }
  if (projectsRoots.length === 0) projectsRoots.push(path.resolve(process.cwd()));

  return {
    token,
    projectsRoot: projectsRoots[0],
    projectsRoots,
    port: Number(env.PORT || 8787),
    model: env.DECK_MODEL || 'claude-opus-4-8',
    publicOrigin: env.DECK_PUBLIC_ORIGIN,
    permissionMode: env.DECK_PERMISSION_MODE || 'bypassPermissions',
    cookieSecure: env.DECK_COOKIE_SECURE !== undefined ? env.DECK_COOKIE_SECURE !== 'false' : undefined,
  };
}
