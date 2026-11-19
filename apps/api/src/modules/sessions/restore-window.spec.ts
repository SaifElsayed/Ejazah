// T024 of specs/004-sessions/tasks.md (FR-454; research R-322, R-323 P3-25; contracts/admin-surface.md,
// `sessions.monitor.get`'s `restorableUntil`) — the restore window's end, derived and never stored
// (R-DB-4): the closing case's opening plus `enrollment_restore_window_days`, days of 24 hours (the
// owner's decision of 2026-11-10 on B37 lane B's Q7), one function T061's `window_closed` reads too.
//
// T070 (FR-503; SRS FR-CANCEL-9, DEC-69; the note under T070, Q4 (a), N4, N10, Q3 (a)): the one
// closing rule beside it. An enrollment's closing (its status, its last cancellation's reason, its
// latest end case) gives the closing's kind and its case: a complaint's (`absence_termination`), a
// fault confirmed (`student_fault_confirmed`), a ban's (`student_banned`) and a teacher's ban or
// revocation (`teacher_ended` on `cancelled` `teacher_suspended`) restorable while the case is open;
// never a deletion's or a gender correction's, nor any other. The window's setting follows the kind:
// `ban_restore_window_days` for a ban's or a revocation's.
//
// T082 (FR-513; SRS FR-CANCEL-10; the note under T082, N8): an administrator's direct end
// (`admin_ended` on `cancelled` `admin`) joins the rule, restorable while its case is open, its slot
// held through `enrollment_restore_window_days`.
import { describe, expect, it } from 'vitest';

import type { EnrollmentCase } from '../moderation/index.js';
import {
  BAN_RESTORE_WINDOW_SETTING,
  type ClosingFacts,
  closingOf,
  ENROLLMENT_RESTORE_WINDOW_SETTING,
  latestEndCaseOf,
  restorableUntil,
  type RestoreWindowSetting,
  windowSettingOf,
} from './restore-window.js';

const OPENED = new Date('2026-11-10T09:15:30Z');
const DAYS: Readonly<Record<RestoreWindowSetting, number>> = {
  enrollment_restore_window_days: 7,
  ban_restore_window_days: 3,
};
const asked: RestoreWindowSetting[] = [];
const windowDays = async (setting: RestoreWindowSetting) => {
  asked.push(setting);
  return DAYS[setting];
};

const endCase = (
  reason: string,
  status: EnrollmentCase['status'] = 'open',
  n = 1,
): EnrollmentCase => ({
  caseId: `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
  reason,
  status,
  createdAt: OPENED,
});

const facts = (
  status: ClosingFacts['status'],
  lastCancellationReason: string | null,
  latest: EnrollmentCase | null,
): ClosingFacts => ({ status, lastCancellationReason, endCase: latest });

describe('restorableUntil (FR-454, R-322)', () => {
  it("is the case's opening plus the window's days of 24 hours", async () => {
    expect(await restorableUntil(OPENED, 'absence_termination', windowDays)).toEqual(
      new Date('2026-11-17T09:15:30Z'),
    );
  });

  it('counts 24 hours a day over a clock change', async () => {
    // Cairo leaves summer time on 2026-10-30; the window's days are an instant's, not the wall's.
    expect(
      await restorableUntil(
        new Date('2026-10-29T10:00:00Z'),
        'student_fault_confirmed',
        async () => 2,
      ),
    ).toEqual(new Date('2026-10-31T10:00:00Z'));
  });

  it('takes the ban window for a ban’s or a revocation’s closing, reading only that setting (T070)', async () => {
    asked.length = 0;
    expect(await restorableUntil(OPENED, 'student_banned', windowDays)).toEqual(
      new Date('2026-11-13T09:15:30Z'),
    );
    expect(await restorableUntil(OPENED, 'teacher_ended', windowDays)).toEqual(
      new Date('2026-11-13T09:15:30Z'),
    );
    expect(asked).toEqual([BAN_RESTORE_WINDOW_SETTING, BAN_RESTORE_WINDOW_SETTING]);
  });
});

describe('windowSettingOf (FR-503; SRS FR-CANCEL-9)', () => {
  it.each([
    ['absence_termination', ENROLLMENT_RESTORE_WINDOW_SETTING],
    ['student_fault_confirmed', ENROLLMENT_RESTORE_WINDOW_SETTING],
    ['student_banned', BAN_RESTORE_WINDOW_SETTING],
    ['teacher_ended', BAN_RESTORE_WINDOW_SETTING],
    // T082: a direct end holds its slot through the enrollment window.
    ['admin_ended', ENROLLMENT_RESTORE_WINDOW_SETTING],
    // 003:T112 (Q-C (a)): the end on a complaint against the student, as a direct end.
    ['student_complaint_ended', ENROLLMENT_RESTORE_WINDOW_SETTING],
  ] as const)('a %s closing reads %s', (kind, setting) => {
    expect(windowSettingOf(kind)).toBe(setting);
  });
});

describe('latestEndCaseOf (R-322, step 1)', () => {
  it('is the newest case of an end’s reason, the cases read newest first', () => {
    const newest = endCase('admin_cancellation', 'open', 3);
    const end = endCase('student_banned', 'open', 2);
    const older = endCase('student_fault_confirmed', 'dismissed', 1);
    expect(latestEndCaseOf([newest, end, older])).toEqual(end);
  });

  it('counts a direct end’s `admin_ended` case as an end’s (T082)', () => {
    const end = endCase('admin_ended', 'open', 2);
    expect(latestEndCaseOf([endCase('refund_choice', 'open', 3), end])).toEqual(end);
  });

  // 003:T112 (the owner's Q-C (a); DEC-69): the end on a complaint against the student is an end's.
  it('counts the end on a complaint against the student as an end’s (003:T112)', () => {
    const end = endCase('student_complaint_ended', 'open', 2);
    expect(latestEndCaseOf([endCase('refund_choice', 'open', 3), end])).toEqual(end);
  });

  it('is none when no case is an end’s', () => {
    expect(latestEndCaseOf([endCase('admin_cancellation'), endCase('refund_choice')])).toBeNull();
    expect(latestEndCaseOf([])).toBeNull();
  });
});

describe('closingOf, the one closing rule (Q4 (a), N4)', () => {
  it.each<[string, ClosingFacts, string]>([
    [
      'a complaint’s termination',
      facts('terminated_no_show', null, endCase('absence_termination')),
      'absence_termination',
    ],
    [
      'a fault confirmed',
      facts('cancelled', 'admin', endCase('student_fault_confirmed')),
      'student_fault_confirmed',
    ],
    ['a student’s ban', facts('cancelled', 'admin', endCase('student_banned')), 'student_banned'],
    [
      'a teacher’s ban or revocation',
      facts('cancelled', 'teacher_suspended', endCase('teacher_ended')),
      'teacher_ended',
    ],
    // T082 (N8): an administrator's direct end.
    ['a direct end', facts('cancelled', 'admin', endCase('admin_ended')), 'admin_ended'],
    // 003:T112 (Q-C (a); DEC-69): restorable as a direct end is.
    [
      'an end on a complaint against the student',
      facts('cancelled', 'admin', endCase('student_complaint_ended')),
      'student_complaint_ended',
    ],
  ])('admits %s while its case is open', (_name, closing, kind) => {
    expect(closingOf(closing)).toEqual({ kind, closingCase: closing.endCase, restorable: true });
  });

  it.each(['resolved', 'dismissed'] as const)(
    'keeps the kind of a closing whose case is %s, not restorable',
    (status) => {
      const closed = endCase('student_banned', status);
      expect(closingOf(facts('cancelled', 'admin', closed))).toEqual({
        kind: 'student_banned',
        closingCase: closed,
        restorable: false,
      });
    },
  );

  it.each<[string, ClosingFacts]>([
    ['a teacher’s deletion', facts('cancelled', 'account_deleted', endCase('teacher_ended'))],
    ['a student’s deletion', facts('cancelled', 'account_deleted', null)],
    ['a gender correction', facts('cancelled', 'gender_correction', endCase('teacher_ended'))],
    ['a completion', facts('completed', null, endCase('student_fault_confirmed'))],
    ['a confirmed enrollment', facts('confirmed', null, endCase('student_banned'))],
    ['an unpaid end', facts('cancelled', 'payment_expired', null)],
    ['a cancellation `admin` with no end case', facts('cancelled', 'admin', null)],
    [
      'a cancellation `admin` whose end case is a teacher’s',
      facts('cancelled', 'admin', endCase('teacher_ended')),
    ],
    [
      'a termination whose end case is a ban’s',
      facts('terminated_no_show', null, endCase('student_banned')),
    ],
    [
      'a teacher’s end whose case is a student’s',
      facts('cancelled', 'teacher_suspended', endCase('student_banned')),
    ],
    // T082: a direct end's case only on its own closing, `cancelled` `admin`.
    [
      'an `admin_ended` case on a teacher’s end',
      facts('cancelled', 'teacher_suspended', endCase('admin_ended')),
    ],
    [
      'an `admin_ended` case on a termination',
      facts('terminated_no_show', null, endCase('admin_ended')),
    ],
    [
      'an `admin_ended` case on a deletion',
      facts('cancelled', 'account_deleted', endCase('admin_ended')),
    ],
  ])('never admits %s', (_name, closing) => {
    expect(closingOf(closing)).toBeUndefined();
  });
});
