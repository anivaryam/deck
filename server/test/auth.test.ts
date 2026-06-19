// server/test/auth.test.ts
import { describe, it, expect } from 'vitest';
import { safeEqual, COOKIE_NAME, AuthSessions } from '../src/auth.ts';

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('hunter2hunter2hunter2', 'hunter2hunter2hunter2')).toBe(true);
  });
  it('returns false for different strings of equal length', () => {
    expect(safeEqual('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb')).toBe(false);
  });
  it('returns false for different-length strings (no throw)', () => {
    expect(safeEqual('short', 'a-much-longer-secret-value')).toBe(false);
  });
  it('exposes a stable cookie name', () => {
    expect(COOKIE_NAME).toBe('deck_session');
  });
});

describe('AuthSessions', () => {
  it('expires an idle session after the TTL', () => {
    const a = new AuthSessions(1000);
    const id = a.issue(0);
    expect(a.valid(id, 500)).toBe(true);
    expect(a.valid(id, 5000)).toBe(false); // > ttl since last use
  });
  it('slides expiry on each use so active sessions persist', () => {
    const a = new AuthSessions(1000);
    const id = a.issue(0);
    expect(a.valid(id, 900)).toBe(true);   // slides to 1900
    expect(a.valid(id, 1800)).toBe(true);  // slides to 2800
    expect(a.valid(id, 2700)).toBe(true);  // still alive though > original ttl
  });
  it('revoke invalidates immediately and ttl is exposed', () => {
    const a = new AuthSessions(1000);
    const id = a.issue(0);
    a.revoke(id);
    expect(a.valid(id, 1)).toBe(false);
    expect(a.ttl).toBe(1000);
  });
});
