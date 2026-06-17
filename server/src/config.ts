// server/src/config.ts
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface Config {
  token: string;
  projectsRoot: string;
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

  return {
    token,
    projectsRoot: path.resolve(env.PROJECTS_ROOT || process.cwd()),
    port: Number(env.PORT || 8787),
    model: env.DECK_MODEL || 'claude-opus-4-8',
    publicOrigin: env.DECK_PUBLIC_ORIGIN,
    permissionMode: env.DECK_PERMISSION_MODE || 'bypassPermissions',
    cookieSecure: env.DECK_COOKIE_SECURE !== undefined ? env.DECK_COOKIE_SECURE !== 'false' : undefined,
  };
}
