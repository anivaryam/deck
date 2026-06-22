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
  /** Per-turn agent turn ceiling (SDK maxTurns). Unset = no cap for interactive
   *  sessions; unattended task/cron runs fall back to a built-in default. Set
   *  DECK_MAX_TURNS to override both. */
  maxTurns?: number;
  /** Model for unattended task/cron runs when the run specifies none. Lets you
   *  point automation at a cheaper model than interactive chat (DECK_TASK_MODEL).
   *  Falls back to `model` when unset. */
  taskModel?: string;
  /** Reasoning effort for unattended task/cron runs when none is specified
   *  (DECK_TASK_EFFORT). Falls back to the SDK default when unset. */
  taskEffort?: string;
  /** Minimum seconds between cron fires. A schedule that would fire more often is
   *  rejected at create time (DECK_CRON_MIN_INTERVAL_SEC, default 60). Optional so
   *  partial test fixtures stay valid; consumers fall back to 60. */
  cronMinIntervalSec?: number;
  /** Auth session lifetime in ms (DECK_SESSION_TTL_DAYS, default 7). Shorter than
   *  the old hard-coded 30 days to bound the window a captured cookie stays valid.
   *  Optional so partial test fixtures stay valid; AuthSessions defaults otherwise. */
  sessionTtlMs?: number;
  /** Turn ceiling for a goal pass (DECK_GOAL_MAX_TURNS, default 150). A goal does
   *  more than a task, so it gets a higher cap than the task default of 40. */
  goalMaxTurns?: number;
  /** Default attempt cap for a goal's autonomous loop (DECK_GOAL_MAX_ITERATIONS, default 3, min 1). */
  goalMaxIterations?: number;
  /** Trust autonomous (kind='task') runs to use host tools without human approval
   *  (DECK_TRUST_AUTOMATION=true). OFF by default: cron/ticket/goal prompts derive
   *  from untrusted content (ticket bodies, repo/web data read mid-run), so an
   *  injection could drive arbitrary host code. Only set this when the server runs
   *  in a sandbox with an egress allowlist (see DECK_SANDBOX). */
  trustAutomation?: boolean;
  /** Marker asserting the process runs inside a sandbox (container/namespace with
   *  an egress allowlist) (DECK_SANDBOX=1). Purely advisory — used for the startup
   *  warning when trustAutomation is on. The actual isolation is a deployment
   *  concern; deck can't enforce it from inside the process. */
  sandboxed?: boolean;
  /** Seconds an autonomous run's sensitive tool call (Bash/Write/Edit/…) waits for
   *  a human approve/deny before defaulting to DENY (DECK_APPROVAL_TIMEOUT_SEC,
   *  default 300). 0 = deny immediately without waiting (fully unattended-safe). */
  approvalTimeoutSec?: number;
  /** Auto-extract durable facts from finished turns into the knowledge store. */
  memoryMining: boolean;
  /** Cheap model used by the memory miner. */
  memoryModel: string;
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
  // Warn (don't fail — avoid locking out an existing deploy) on a low-entropy token.
  // The token guards an internet-reachable agent with full host power; <32 chars is weak.
  if (token.length < 32) {
    console.warn('[config] DECK_TOKEN is shorter than 32 chars — use a stronger secret (e.g. `openssl rand -hex 24`)');
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
    port: Number(env.PORT || 28787),
    model: env.DECK_MODEL || 'claude-opus-4-8',
    publicOrigin: env.DECK_PUBLIC_ORIGIN,
    permissionMode: env.DECK_PERMISSION_MODE || 'bypassPermissions',
    cookieSecure: env.DECK_COOKIE_SECURE !== undefined ? env.DECK_COOKIE_SECURE !== 'false' : undefined,
    maxTurns:
      env.DECK_MAX_TURNS && Number.isInteger(Number(env.DECK_MAX_TURNS)) && Number(env.DECK_MAX_TURNS) > 0
        ? Number(env.DECK_MAX_TURNS)
        : undefined,
    taskModel: env.DECK_TASK_MODEL || undefined,
    taskEffort: env.DECK_TASK_EFFORT || undefined,
    cronMinIntervalSec:
      env.DECK_CRON_MIN_INTERVAL_SEC && Number.isFinite(Number(env.DECK_CRON_MIN_INTERVAL_SEC))
        ? Math.max(0, Number(env.DECK_CRON_MIN_INTERVAL_SEC))
        : 60,
    sessionTtlMs:
      (env.DECK_SESSION_TTL_DAYS && Number.isFinite(Number(env.DECK_SESSION_TTL_DAYS))
        ? Math.max(1, Number(env.DECK_SESSION_TTL_DAYS))
        : 7) *
      24 * 60 * 60 * 1000,
    goalMaxTurns:
      env.DECK_GOAL_MAX_TURNS && Number.isFinite(Number(env.DECK_GOAL_MAX_TURNS))
        ? Math.max(1, Number(env.DECK_GOAL_MAX_TURNS))
        : 150,
    goalMaxIterations:
      env.DECK_GOAL_MAX_ITERATIONS && Number.isFinite(Number(env.DECK_GOAL_MAX_ITERATIONS))
        ? Math.max(1, Math.floor(Number(env.DECK_GOAL_MAX_ITERATIONS)))
        : 3,
    trustAutomation: env.DECK_TRUST_AUTOMATION === 'true',
    sandboxed: env.DECK_SANDBOX === '1',
    approvalTimeoutSec:
      env.DECK_APPROVAL_TIMEOUT_SEC && Number.isFinite(Number(env.DECK_APPROVAL_TIMEOUT_SEC))
        ? Math.max(0, Number(env.DECK_APPROVAL_TIMEOUT_SEC))
        : 300,
    memoryMining: env.DECK_MEMORY_MINING !== 'false',
    memoryModel: env.DECK_MEMORY_MODEL || 'claude-haiku-4-5-20251001',
  };
}
