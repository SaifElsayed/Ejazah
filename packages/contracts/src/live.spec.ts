// T063 of specs/004-sessions — the live channel's events (contracts/app-surface.md, "`live`";
// research R-324, item 4): a discriminated union on `type`, a signal carrying its ids and nothing
// else, so a field a producer adds by mistake (a message body, a name) is stripped before it is sent.
import { describe, expect, it } from 'vitest';

import { liveEvent } from './live.js';

const SESSION = '0199d0a0-0000-7000-8000-0000000051a1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e1a1';

describe('liveEvent (T063)', () => {
  it('parses each of its three members', () => {
    for (const event of [
      { type: 'session', sessionId: SESSION, enrollmentId: ENROLLMENT },
      { type: 'enrollment', enrollmentId: ENROLLMENT },
      { type: 'account' },
    ]) {
      expect(liveEvent.parse(event)).toEqual(event);
    }
  });

  it('strips every field a member does not name', () => {
    expect(
      liveEvent.parse({ type: 'enrollment', enrollmentId: ENROLLMENT, body: 'a message', name: 'x' }),
    ).toEqual({ type: 'enrollment', enrollmentId: ENROLLMENT });
    expect(liveEvent.parse({ type: 'account', userId: SESSION })).toEqual({ type: 'account' });
  });

  it('refuses an unknown type, a missing id and an id that is not one', () => {
    expect(liveEvent.safeParse({ type: 'chat', enrollmentId: ENROLLMENT }).success).toBe(false);
    expect(liveEvent.safeParse({ type: 'session', sessionId: SESSION }).success).toBe(false);
    expect(liveEvent.safeParse({ type: 'enrollment', enrollmentId: 'not an id' }).success).toBe(
      false,
    );
  });
});
