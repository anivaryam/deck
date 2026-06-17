// server/src/auth.ts
import crypto from 'node:crypto';

export const COOKIE_NAME = 'deck_session';

/** Constant-time string comparison that never throws on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Server-side session registry. The cookie carries an opaque random id — never
 * the master DECK_TOKEN — so a stolen cookie can be revoked and never reveals the
 * master secret. In-memory by design: a process restart invalidates all sessions
 * (free, automatic revocation on redeploy).
 */
export class AuthSessions {
  private sessions = new Map<string, number>(); // id -> expiresAt (epoch ms)

  constructor(private ttlMs = 1000 * 60 * 60 * 24 * 30) {}

  issue(now = Date.now()): string {
    const id = crypto.randomUUID();
    this.sessions.set(id, now + this.ttlMs);
    return id;
  }

  valid(id: string | undefined, now = Date.now()): boolean {
    if (!id) return false;
    const exp = this.sessions.get(id);
    if (exp === undefined) return false;
    if (exp <= now) {
      this.sessions.delete(id);
      return false;
    }
    return true;
  }

  revoke(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }
}

/**
 * Fixed-window failure limiter, keyed by client IP. Throttles brute-force guessing
 * of the master token over the public tunnel. Successful auth resets the counter.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private max = 8, private windowMs = 60_000) {}

  blocked(key: string, now = Date.now()): boolean {
    const e = this.hits.get(key);
    if (!e) return false;
    if (e.resetAt <= now) {
      this.hits.delete(key);
      return false;
    }
    return e.count >= this.max;
  }

  fail(key: string, now = Date.now()): void {
    const e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    e.count++;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

/**
 * Exact-host Origin check. Used by both the WS upgrade and the REST CSRF guard.
 * Loopback (any port) is always allowed; otherwise the host must exactly match the
 * configured public origin. Prefix matching (the old `startsWith`) is deliberately
 * avoided — `http://127.0.0.1.evil.com` must NOT pass.
 */
export function originAllowed(origin: string | undefined, publicOrigin?: string): boolean {
  if (!origin) return false; // browsers always send Origin on WS upgrades / cross-site POSTs
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') return true;
  if (publicOrigin) {
    try {
      if (new URL(publicOrigin).host === url.host) return true;
    } catch {
      /* malformed config — fall through */
    }
  }
  return false;
}
