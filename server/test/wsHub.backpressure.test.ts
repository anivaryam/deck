// server/test/wsHub.backpressure.test.ts
import { describe, it, expect } from 'vitest';
import { shouldDropFrame, MAX_BUFFERED } from '../src/wsHub.ts';

describe('shouldDropFrame (backpressure)', () => {
  const over = MAX_BUFFERED + 1;
  const under = MAX_BUFFERED - 1;

  it('never drops when the buffer is within the cap', () => {
    expect(shouldDropFrame('assistant', under)).toBe(false);
    expect(shouldDropFrame('result', under)).toBe(false);
    expect(shouldDropFrame('result', MAX_BUFFERED)).toBe(false);
  });

  it('drops large live STREAM frames once the buffer is over the cap', () => {
    expect(shouldDropFrame('assistant', over)).toBe(true);
    expect(shouldDropFrame('user', over)).toBe(true); // tool results can be huge
    expect(shouldDropFrame('system', over)).toBe(true);
  });

  it('NEVER drops the turn-ending frames that clear the client busy/Stop state', () => {
    // These are the only live signals that flip the client out of "busy".
    // Dropping one strands the Stop button after the turn ends, because the
    // authoritative `ready` re-sync only happens on (re)connect.
    expect(shouldDropFrame('result', over)).toBe(false);
    expect(shouldDropFrame('cancelled', over)).toBe(false);
    expect(shouldDropFrame('error', over)).toBe(false);
  });

  it('NEVER drops session lifecycle control frames', () => {
    expect(shouldDropFrame('ready', over)).toBe(false);
    expect(shouldDropFrame('deleted', over)).toBe(false);
  });

  it('drops unknown / missing frame types under backpressure', () => {
    expect(shouldDropFrame(undefined, over)).toBe(true);
    expect(shouldDropFrame(null, over)).toBe(true);
    expect(shouldDropFrame(123, over)).toBe(true);
  });
});
