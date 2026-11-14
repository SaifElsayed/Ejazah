// T082 of specs/004-sessions (FR-513; SRS FR-CANCEL-10, DEC-68; admin-surface.md,
// `sessions.endEnrollment`) — the administrator's direct end of an enrollment: its input (a reason
// both parties are shown, 1 to 500 characters and not blank; an internal note, optional, at most
// 500; the slot held or released, held by default; the administrator's key), its output (no
// amount, R-MONEY-6), its two `CONFLICT` causes, the `admin_ended` case reason added to the closed
// list, and (Q-O1 (a)) the monitor's `enrollmentRestoreWindowDays`. Each case run red first.
import { describe, expect, it } from 'vitest';

import { isIdempotentProcedure } from '../idempotent-procedures.js';
import {
  compensationCaseReason,
  enrollmentEndRefusalCause,
  enrollmentEndSlot,
  monitorEnrollment,
  sessionsEndEnrollmentInput,
  sessionsEndEnrollmentOutput,
} from './sessions.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const CASE = '0199d0a0-0000-7000-8000-0000000000c1';
const KEY = 'end-attempt-0000000001';

const asked = { enrollmentId: ENROLLMENT, partyReason: 'انتهى الاشتراك', idempotencyKey: KEY };

describe('sessions.endEnrollment input (FR-513)', () => {
  it('holds the slot by default, and keeps the internal note when given', () => {
    expect(sessionsEndEnrollmentInput.parse(asked)).toEqual({ ...asked, slot: 'hold' });
    expect(
      sessionsEndEnrollmentInput.parse({ ...asked, internalNote: 'ملاحظة', slot: 'release' }),
    ).toEqual({ ...asked, internalNote: 'ملاحظة', slot: 'release' });
  });

  it('takes a party reason of 1 to 500 characters, never a blank one', () => {
    expect(
      sessionsEndEnrollmentInput.safeParse({ ...asked, partyReason: 'x'.repeat(500) }).success,
    ).toBe(true);
    for (const partyReason of ['', '   ', 'x'.repeat(501)]) {
      expect(
        sessionsEndEnrollmentInput.safeParse({ ...asked, partyReason }).success,
        JSON.stringify(partyReason.length),
      ).toBe(false);
    }
    const { partyReason: _missing, ...without } = asked;
    expect(sessionsEndEnrollmentInput.safeParse(without).success).toBe(false);
  });

  it('takes an internal note of at most 500 characters', () => {
    expect(
      sessionsEndEnrollmentInput.safeParse({ ...asked, internalNote: 'x'.repeat(500) }).success,
    ).toBe(true);
    expect(
      sessionsEndEnrollmentInput.safeParse({ ...asked, internalNote: 'x'.repeat(501) }).success,
    ).toBe(false);
  });

  it('refuses another slot choice, a malformed key and an id that is not one', () => {
    expect(sessionsEndEnrollmentInput.safeParse({ ...asked, slot: 'keep' }).success).toBe(false);
    expect(
      sessionsEndEnrollmentInput.safeParse({ ...asked, idempotencyKey: 'short' }).success,
    ).toBe(false);
    const { idempotencyKey: _key, ...unkeyed } = asked;
    expect(sessionsEndEnrollmentInput.safeParse(unkeyed).success).toBe(false);
    expect(sessionsEndEnrollmentInput.safeParse({ ...asked, enrollmentId: 'e1' }).success).toBe(
      false,
    );
  });

  it('is keyed: the scope is a keyed procedure', () => {
    expect(isIdempotentProcedure('sessions.endEnrollment')).toBe(true);
  });
});

describe('sessions.endEnrollment output and refusals (FR-513, R-MONEY-6)', () => {
  const ended = { enrollmentId: ENROLLMENT, caseId: CASE, slot: 'release', cancelledSessions: 3 };

  it('answers the enrollment, the case, the slot and the sessions cancelled, never an amount', () => {
    expect(sessionsEndEnrollmentOutput.parse(ended)).toEqual(ended);
    expect(sessionsEndEnrollmentOutput.parse({ ...ended, amountPiasters: 120_000 })).toEqual(ended);
    expect(Object.keys(sessionsEndEnrollmentOutput.shape)).toEqual([
      'enrollmentId',
      'caseId',
      'slot',
      'cancelledSessions',
    ]);
    expect(sessionsEndEnrollmentOutput.safeParse({ ...ended, cancelledSessions: -1 }).success).toBe(
      false,
    );
  });

  it('names the two slot choices and the two CONFLICT causes', () => {
    expect(enrollmentEndSlot.options).toEqual(['hold', 'release']);
    expect(enrollmentEndRefusalCause.options).toEqual([
      'enrollment_not_confirmed',
      'complaint_open',
    ]);
  });
});

describe('the admin_ended case and the monitor (FR-513; Q-O1 (a))', () => {
  it('adds admin_ended to the closed list of case reasons, at its end', () => {
    expect(compensationCaseReason.options.at(-1)).toBe('admin_ended');
    expect(compensationCaseReason.options).toHaveLength(16);
  });

  it('answers enrollmentRestoreWindowDays on the monitor enrollment, a whole positive number', () => {
    const enrollment = {
      enrollmentId: ENROLLMENT,
      student: { userId: '0199d0a0-0000-7000-8000-0000000000a1', displayName: 'أ', deleted: false },
      teacher: { userId: '0199d0a0-0000-7000-8000-0000000000a2', displayName: 'ب', deleted: false },
      status: 'cancelled',
      track: 'recitation',
      sessionCount: 8,
      completed: 2,
      remaining: 6,
      teacherNoShows: 0,
      repeatedAbsence: false,
      enrollmentRestoreWindowDays: 14,
    };
    expect(monitorEnrollment.parse(enrollment)).toEqual(enrollment);
    const { enrollmentRestoreWindowDays: _days, ...without } = enrollment;
    expect(monitorEnrollment.safeParse(without).success).toBe(false);
    for (const days of [0, 1.5]) {
      expect(
        monitorEnrollment.safeParse({ ...enrollment, enrollmentRestoreWindowDays: days }).success,
      ).toBe(false);
    }
  });
});
