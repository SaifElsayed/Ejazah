// T019 of specs/004-sessions (FR-435; the note under T019, Q4, and its R-325 arithmetic): a lost
// room is asked of `sessions.join` again after 2, 4, 8 and 16 s, then every 30 s, and never after a
// final refusal.
import { describe, expect, it } from '@jest/globals';

import { isFinalRefusal, rejoinDelayMs } from './rejoin';

describe('rejoinDelayMs', () => {
  it('waits 2, 4, 8 and 16 s, then 30 s for every later try', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(rejoinDelayMs)).toEqual([
      2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  it('asks at 2, 6, 14, 30 and 60 s after the loss: six joins in the worst minute', () => {
    let at = 0;
    const tries = [0, 1, 2, 3, 4].map((failures) => (at += rejoinDelayMs(failures)));
    expect(tries).toEqual([2_000, 6_000, 14_000, 30_000, 60_000]);
  });
});

describe('isFinalRefusal', () => {
  it('stops at NOT_FOUND, ACCOUNT_RESTRICTED, JOIN_CLOSED and SESSION_NOT_SCHEDULED', () => {
    for (const code of [
      'NOT_FOUND',
      'ACCOUNT_RESTRICTED',
      'JOIN_CLOSED',
      'SESSION_NOT_SCHEDULED',
    ]) {
      expect(isFinalRefusal(code)).toBe(true);
    }
  });

  it('tries again after anything else: no answer, a throttle, a failure of the server', () => {
    for (const code of [undefined, 'RATE_LIMITED', 'INTERNAL', 'JOIN_NOT_OPEN']) {
      expect(isFinalRefusal(code)).toBe(false);
    }
  });
});
