// 003:T112 (SRS §3.8.6, FR-POSTPONE-1 to FR-POSTPONE-5, DEC-86, DEC-90; Q-1 (a) to Q-3 (a)) — the
// `sessions.postpone` schemas, the postponed status and the postponement `sessions.get` shows.
// Written before the schemas, and run red first.
//
// The caller names the enrollment, a reason and the kernel's idempotency key, and nothing of who
// asks (R-GENDER-4): the server takes the caller's sessions of that enrollment in the week. The
// reason is the participant's own text, bounded and trimmed as a cancellation request's (1 to 500
// characters, never blank). The answer is the postponement and the sessions it moved, at least
// one: none left in the week is a refusal (`CONFLICT`, its cause in `details`).
import { describe, expect, it } from 'vitest';

import { sessionStatus } from './enrollments.js';
import { idempotentProcedures, isIdempotentProcedure } from './idempotent-procedures.js';
import {
  PARTICIPANT_REASON_MAX_LENGTH,
  sessionsGetOutput,
  sessionsPostponeInput,
  sessionsPostponeOutput,
  sessionsPostponeRefusalCause,
} from './sessions.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const POSTPONEMENT = '0199d0a0-0000-7000-8000-0000000000f1';
const SESSION_A = '0199d0a0-0000-7000-8000-0000000000a1';
const SESSION_B = '0199d0a0-0000-7000-8000-0000000000a2';
const KEY = 'postpone-0199d0a0-0000-7000';

const asked = { enrollmentId: ENROLLMENT, reason: 'سفر طارئ', idempotencyKey: KEY };

describe('sessions.postpone input', () => {
  it('takes the enrollment, a reason trimmed, up to 500 characters, and the key', () => {
    expect(sessionsPostponeInput.parse({ ...asked, reason: '  سفر طارئ  ' })).toEqual(asked);
    const longest = { ...asked, reason: 'ا'.repeat(PARTICIPANT_REASON_MAX_LENGTH) };
    expect(sessionsPostponeInput.parse(longest)).toEqual(longest);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'ا'.repeat(PARTICIPANT_REASON_MAX_LENGTH + 1)],
  ])('refuses a reason %s', (_name, reason) => {
    expect(sessionsPostponeInput.safeParse({ ...asked, reason }).success).toBe(false);
  });

  it('refuses a request without its key or with an enrollment id that is not one', () => {
    const { idempotencyKey: _key, ...unkeyed } = asked;
    expect(sessionsPostponeInput.safeParse(unkeyed).success).toBe(false);
    expect(sessionsPostponeInput.safeParse({ ...asked, enrollmentId: 'enrollment' }).success).toBe(
      false,
    );
  });

  it('is a keyed procedure of the kernel, listed directly after sessions.cancellation.request', () => {
    expect(isIdempotentProcedure('sessions.postpone')).toBe(true);
    expect(idempotentProcedures.indexOf('sessions.postpone')).toBe(
      idempotentProcedures.indexOf('sessions.cancellation.request') + 1,
    );
  });
});

describe('sessions.postpone output and refusals', () => {
  const postponed = { postponementId: POSTPONEMENT, sessionIds: [SESSION_A, SESSION_B] };

  it('answers the postponement and the sessions it moved, and strips any other field', () => {
    expect(sessionsPostponeOutput.parse({ ...postponed, reason: 'not answered' })).toEqual(
      postponed,
    );
  });

  it('never answers a postponement that moved no session, or an id that is not one', () => {
    expect(sessionsPostponeOutput.safeParse({ ...postponed, sessionIds: [] }).success).toBe(false);
    expect(sessionsPostponeOutput.safeParse({ ...postponed, sessionIds: ['s1'] }).success).toBe(
      false,
    );
  });

  it('names its CONFLICT causes: the enrollment not confirmed, none left in the week, inside the interval', () => {
    expect(sessionsPostponeRefusalCause.options).toEqual([
      'enrollment_not_confirmed',
      'no_session_in_week',
      'interval_not_passed',
    ]);
  });
});

describe('the postponed session as sessions.get shows it (FR-POSTPONE-5)', () => {
  const got = {
    sessionId: SESSION_A,
    enrollmentId: ENROLLMENT,
    sequenceNumber: 3,
    localDate: '2026-11-22',
    startTimeLocal: '17:00',
    timezone: 'Africa/Cairo',
    startsAt: '2026-11-22T15:00:00.000Z',
    endsAt: '2026-11-22T15:45:00.000Z',
    lengthMinutes: 45,
    status: 'postponed',
    counterparty: { userId: SESSION_B, displayName: 'أحمد سالم', deleted: false },
    join: { opensAt: '2026-11-22T14:50:00.000Z', closesAt: '2026-11-22T15:45:00.000Z' },
    counterpartyInRoom: false,
  };
  const postponement = { by: 'teacher', reason: 'سفر طارئ', at: '2026-11-19T10:00:00.000Z' };

  it('takes `postponed` as a session status', () => {
    expect(sessionStatus.safeParse('postponed').success).toBe(true);
  });

  it('carries who postponed it, the reason and when, and parses without one', () => {
    expect(sessionsGetOutput.safeParse({ ...got, postponement }).data).toEqual({
      ...got,
      postponement,
    });
    const byStudent = { ...postponement, by: 'student' };
    expect(
      sessionsGetOutput.safeParse({ ...got, postponement: byStudent }).data?.postponement,
    ).toEqual(byStudent);
    const without = sessionsGetOutput.safeParse(got);
    expect(without.success).toBe(true);
    expect(without.data?.postponement).toBeUndefined();
  });

  it('refuses a postponement by anyone else, a blank or over-long reason, or a time not an instant', () => {
    for (const refused of [
      { ...postponement, by: 'admin' },
      { ...postponement, reason: '' },
      { ...postponement, reason: 'ا'.repeat(501) },
      { ...postponement, at: '2026-11-19' },
    ]) {
      expect(
        sessionsGetOutput.safeParse({ ...got, postponement: refused }).success,
        JSON.stringify(refused).slice(0, 40),
      ).toBe(false);
    }
  });
});
