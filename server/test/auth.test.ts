// server/test/auth.test.ts
import { describe, it, expect } from 'vitest';
import { safeEqual, COOKIE_NAME } from '../src/auth.ts';

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
