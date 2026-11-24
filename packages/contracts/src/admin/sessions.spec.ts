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
  enrollmentEndCause,
  enrollmentEndRefusalCause,
  enrollmentEndSlot,
  monitorEnrollment,
  restoreRefusalCause,
  sessionsEndEnrollmentInput,
  sessionsEndEnrollmentOutput,
  telemetry,
  timelineEvent,
  timelineEventKind,
} from './sessions.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const CASE = '0199d0a0-0000-7000-8000-0000000000c1';
const KEY = 'end-attempt-0000000001';

const asked = { enrollmentId: ENROLLMENT, partyReason: 'انتهى الاشتراك', idempotencyKey: KEY };

describe('sessions.endEnrollment input (FR-513)', () => {
  it('holds the slot by default, and keeps the internal note when given', () => {
    // 003:T112 (Q-4 (a); rule d): the end's cause defaults to today's, `admin_ended`.
    expect(sessionsEndEnrollmentInput.parse(asked)).toEqual({
      ...asked,
      slot: 'hold',
      cause: 'admin_ended',
    });
    expect(
      sessionsEndEnrollmentInput.parse({ ...asked, internalNote: 'ملاحظة', slot: 'release' }),
    ).toEqual({ ...asked, internalNote: 'ملاحظة', slot: 'release', cause: 'admin_ended' });
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
    // 005:T014 (rule d): `gender_correction` follows it, additively (R-API-9); 003:T112 (rule d):
    // `student_complaint_ended` after that.
    // 003:T125 (rule d): `account_deleted` follows them, additively (R-API-9).
    expect(compensationCaseReason.options.at(-4)).toBe('admin_ended');
    expect(compensationCaseReason.options).toHaveLength(19);
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

// 005:T014 (B47; FR-616, FR-617; research R-409): the correction's case and the restore's new
// step-3 cause, each added at its enum's end (R-API-9). Written before the enums, run red first.
describe('005:T014: gender_correction and gender_mismatch', () => {
  it('adds gender_correction to the case reasons, at the end', () => {
    // 003:T112 (rule d): `student_complaint_ended` follows it, additively (R-API-9); 003:T125 (rule
    // d): `account_deleted` after that.
    expect(compensationCaseReason.options.at(-3)).toBe('gender_correction');
    expect(compensationCaseReason.parse('gender_correction')).toBe('gender_correction');
  });

  it('adds gender_mismatch to the restore refusal causes, at the end, keeping refunded before it', () => {
    // 006:T003 (rule d): `programme_enrollment` follows it, additively (R-API-9).
    expect(restoreRefusalCause.options.slice(-3, -1)).toEqual(['refunded', 'gender_mismatch']);
    expect(restoreRefusalCause.options.at(-1)).toBe('programme_enrollment');
    expect(restoreRefusalCause.options).toHaveLength(11);
  });
});

// 003:T112 (SRS FR-POSTPONE-6, DEC-90; Q-4 (a)): the teacher complains by a report, and the
// administrator's direct end on it is a close on a complaint against the student. The end takes
// that cause, `admin_ended` by default (today's end), and opens its case as
// `student_complaint_ended`, added at the reasons' end (R-API-9). Written before the schemas, run
// red first.
describe('003:T112: the end on a complaint against the student', () => {
  it('adds student_complaint_ended to the case reasons, at the end', () => {
    // 003:T125 (rule d): `account_deleted` follows it, additively (R-API-9).
    expect(compensationCaseReason.options.at(-2)).toBe('student_complaint_ended');
  });

  it('names the end’s two causes: today’s end and a complaint against the student', () => {
    // 003:T125 (rule d): `teacher_ended` follows them, additively (R-API-9).
    expect(enrollmentEndCause.options.slice(0, 2)).toEqual([
      'admin_ended',
      'student_complaint_ended',
    ]);
  });

  it('takes the complaint’s cause on the end', () => {
    expect(
      sessionsEndEnrollmentInput.parse({ ...asked, cause: 'student_complaint_ended' }),
    ).toEqual({ ...asked, slot: 'hold', cause: 'student_complaint_ended' });
  });

  // The coordinator's Q2 (a), 2026-11-19: `session_event_kind` gains `postponed`, and the monitor's
  // timeline parses it.
  it('adds postponed to the timeline’s event kinds, at the end', () => {
    const row = {
      source: 'session',
      kind: 'postponed',
      sessionId: '0199d0a0-0000-7000-8000-0000000000a1',
      occurredAt: '2026-11-19T10:00:00.000Z',
    };
    // 006:T003 (rule d): the programme's four enrollment event kinds follow it, additively (R-API-9),
    // then 004:T084's `encryption_failed` (R1b; a test broken by an approved change).
    expect(timelineEventKind.options.at(-6)).toBe('postponed');
    expect(timelineEvent.safeParse(row).success).toBe(true);
  });

  // 004:T084 (SRS DEC-105; ERD §15 rule 84): an `encryption_failed` row carries the side whose phone
  // could not encrypt, which the monitor's timeline shows; additive (R-API-9).
  it('carries the side that could not encrypt on the timeline (T084)', () => {
    const row = {
      source: 'session',
      kind: 'encryption_failed',
      sessionId: '0199d0a0-0000-7000-8000-0000000000a1',
      occurredAt: '2026-11-23T10:00:00.000Z',
    };
    for (const party of ['student', 'teacher'] as const) {
      expect(timelineEvent.parse({ ...row, party })).toEqual({ ...row, party });
    }
    expect(timelineEvent.safeParse({ ...row, party: 'admin' }).success).toBe(false);
  });

  it('refuses any other cause', () => {
    for (const cause of ['student_banned', 'account_deleted', '']) {
      expect(sessionsEndEnrollmentInput.safeParse({ ...asked, cause }).success, cause).toBe(false);
    }
  });
});

// 003:T125 (SRS DEC-104, DEC-96; Q-1 (a)): the direct end names who stopped, `teacher_ended` added at
// the causes' end beside today's (the student's stop, still the default) and the complaint's; a
// student's deletion by an administrator opens its own case, `account_deleted`, added at the
// reasons' end (R-API-9). Written before the enums, run red first.
describe('003:T125: who stopped, and the deletion’s case', () => {
  it('adds teacher_ended to the end’s causes, at the end, the student’s stop still the default', () => {
    expect(enrollmentEndCause.options).toEqual([
      'admin_ended',
      'student_complaint_ended',
      'teacher_ended',
    ]);
    expect(sessionsEndEnrollmentInput.parse({ ...asked, cause: 'teacher_ended' })).toEqual({
      ...asked,
      slot: 'hold',
      cause: 'teacher_ended',
    });
    expect(sessionsEndEnrollmentInput.parse(asked).cause).toBe('admin_ended');
  });

  it('adds account_deleted to the case reasons, at the end', () => {
    expect(compensationCaseReason.options.at(-1)).toBe('account_deleted');
    expect(compensationCaseReason.parse('account_deleted')).toBe('account_deleted');
  });
});

// 004:T084 (SRS DEC-105; the owner's Q-C1-2 (a), 2026-11-23): a dispute's evidence lists the session's
// encryption failures, each with its side and its time, beside the telemetry; additive (R-API-9).
describe('004:T084: the encryption failures in the session’s record', () => {
  const record = {
    sessionId: '0199d0a0-0000-7000-8000-0000000000a1',
    schedule: {
      localDate: '2026-11-23',
      startTimeLocal: '09:00',
      timezone: 'Africa/Cairo',
      startsAt: '2026-11-23T07:00:00.000Z',
      endsAt: '2026-11-23T08:00:00.000Z',
    },
    status: 'scheduled',
    events: [],
    intervals: { student: [], teacher: [], together: [] },
    simultaneousSeconds: 0,
    joined: { student: false, teacher: false },
    outages: [],
  };

  it('carries each failure’s side and time', () => {
    const encryptionFailures = [
      { party: 'teacher', occurredAt: '2026-11-23T07:01:00.000Z' },
      { party: 'student', occurredAt: '2026-11-23T07:02:00.000Z' },
    ];
    expect(telemetry.parse({ ...record, encryptionFailures }).encryptionFailures).toEqual(
      encryptionFailures,
    );
  });

  it('refuses a side that is neither party', () => {
    expect(
      telemetry.safeParse({
        ...record,
        encryptionFailures: [{ party: 'room', occurredAt: '2026-11-23T07:01:00.000Z' }],
      }).success,
    ).toBe(false);
  });
});
