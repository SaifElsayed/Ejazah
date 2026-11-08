// B35, T013's threshold (the owner's decision of 2026-11-08 on the magic-number gate): a percent of a
// length in whole seconds, rounded up to the next whole second as `evaluateAttendance` rounds its
// threshold (`Math.ceil`), so a percent reached only by a fraction of a second asks for that whole
// second. The bounds: 0 % is no time, 100 % the whole length; a length that is not whole seconds or
// is negative, and a percent below 0 or not finite, are refused.
import { describe, expect, it } from 'vitest';

import { percentOfSeconds, TimeError } from './index.js';

describe('percentOfSeconds: a percent of whole seconds, a fraction rounded up', () => {
  it('0 % is no time and 100 % the whole length', () => {
    expect(percentOfSeconds(3600, 0)).toBe(0);
    expect(percentOfSeconds(3600, 100)).toBe(3600);
    expect(percentOfSeconds(0, 70)).toBe(0);
  });

  it('a whole result is answered as it is', () => {
    expect(percentOfSeconds(3600, 70)).toBe(2520);
  });

  it('a fraction of a second is rounded up, as T013 rounds its threshold', () => {
    // 70 % of 3 601 s is 2 520.7 s.
    expect(percentOfSeconds(3601, 70)).toBe(2521);
    // 33 % of one second is 0.33 s: the whole second is asked for.
    expect(percentOfSeconds(1, 33)).toBe(1);
  });

  it('refuses a length that is negative or not whole seconds, and a percent below 0 or not finite', () => {
    expect(() => percentOfSeconds(-1, 70)).toThrow(TimeError);
    expect(() => percentOfSeconds(1.5, 70)).toThrow(TimeError);
    expect(() => percentOfSeconds(3600, -1)).toThrow(TimeError);
    expect(() => percentOfSeconds(3600, Number.NaN)).toThrow(TimeError);
    expect(() => percentOfSeconds(3600, Number.POSITIVE_INFINITY)).toThrow(TimeError);
  });
});
