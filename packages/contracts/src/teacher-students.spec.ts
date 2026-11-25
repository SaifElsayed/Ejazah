// T049 — the teacher's lists of specs/003-booking/contracts/app-surface.md "`enrollments` and the
// teacher's lists": `teacher.students.list`, `teacher.students.get` and `teacher.today` (FR-391,
// FR-392, FR-393, FR-395). Written before the schemas, and run red first.
//
// What the teacher sees of a student is limited to what «طلابي», the enrollment and «اليوم» draw: the
// student's name, and their user id as `studentId` for the report and flag sheet (005:T021, Q-T4
// (a)), never a date of birth, a minor flag, a document, a gender-dispute history, a photo key or
// any other id (FR-395, R-HONEST-4); zod strips any field the schema does not name.
import { describe, expect, it } from 'vitest';

import { DISCOVERY_QUERY_MAX_LENGTH } from './discovery.js';
import {
  teacherStudentItem,
  teacherStudentsGetInput,
  teacherStudentsGetOutput,
  teacherStudentsListInput,
  teacherStudentsListOutput,
  teacherTodayOutput,
  teacherTodaySession,
} from './teacher-students.js';

const ids = {
  subject: '0199d0a0-0000-7000-8000-000000000051',
  student: '0199d0a0-0000-7000-8000-0000000000c2',
  enrollment: '0199d0a0-0000-7000-8000-0000000000e1',
};

const session = {
  sessionId: '0199d0a0-0000-7000-8000-000000000d03',
  sequenceNumber: 3,
  localDate: '2026-11-08',
  startTimeLocal: '17:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-11-08T15:00:00.000Z',
  endsAt: '2026-11-08T15:45:00.000Z',
  status: 'scheduled',
  pendingCancellation: false,
  disputed: false,
} as const;

const summary = {
  subject: { id: ids.subject, nameAr: 'حفظ القرآن', nameEn: 'Quran memorisation' },
  track: 'ijazah_track',
  sessionCount: 8,
  sessionDurationMinutes: 45,
} as const;

const item = {
  enrollmentId: ids.enrollment,
  student: {
    studentId: ids.student,
    displayName: 'يوسف علي',
    displayNameOrNull: 'يوسف علي',
    deleted: false,
  },
  summary,
  status: 'confirmed',
  next: session,
  last: {
    ...session,
    sessionId: '0199d0a0-0000-7000-8000-000000000d08',
    sequenceNumber: 8,
    localDate: '2026-12-13',
  },
  upcoming: 6,
  completed: 2,
  remaining: 6,
  paused: false,
} as const;

/** What R-HONEST-4 keeps from the teacher, as a leak would spell it. */
const forbidden = {
  dateOfBirth: '2012-01-01',
  isMinor: true,
  minor: true,
  documents: [{ id: ids.student }],
  genderFlags: [{ status: 'pending' }],
  disputes: [{ kind: 'session_dispute' }],
  photoKey: 'photos/1',
  userId: ids.student,
  gender: 'male',
};

describe('the teacher’s inputs name what is asked for, never who asks (R-GENDER-4)', () => {
  it('strips a gender, a user id or a role it was sent', () => {
    const sent = { gender: 'female', userId: ids.student, role: 'student' };
    expect(teacherStudentsListInput.parse({ tab: 'active', ...sent })).toEqual({ tab: 'active' });
    expect(teacherStudentsGetInput.parse({ enrollmentId: ids.enrollment, ...sent })).toEqual({
      enrollmentId: ids.enrollment,
    });
  });

  it('takes the student’s name typed in either tab, trimmed and bounded as discovery’s (FR-391)', () => {
    expect(teacherStudentsListInput.parse({ tab: 'ended', query: '  يوس ' })).toEqual({
      tab: 'ended',
      query: 'يوس',
    });
    expect(teacherStudentsListInput.safeParse({ tab: 'active', query: '   ' }).success).toBe(false);
    expect(
      teacherStudentsListInput.safeParse({
        tab: 'active',
        query: 'ي'.repeat(DISCOVERY_QUERY_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(teacherStudentsListInput.parse({ tab: 'ended', cursor: ids.enrollment }).cursor).toBe(
      ids.enrollment,
    );
  });
});

describe('what the teacher is answered of a student (FR-391, FR-395, R-HONEST-4)', () => {
  it('parses a student’s enrollment with its sessions and its derived counts', () => {
    expect(teacherStudentItem.parse(item)).toEqual(item);
    const detail = { ...item, sessions: [session], ijazahRequest: null };
    expect(teacherStudentsGetOutput.parse(detail)).toEqual(detail);
    expect(teacherStudentsListOutput.parse({ items: [item] })).toEqual({ items: [item] });
  });

  // 004:T074 (FR-506; DEC-69, Q11 (a); the note under T074, Q-R7 (a)): a paused enrollment is
  // answered paused, with no reason and no session; its three counts kept. Additive (R-API-9).
  it('carries paused, required: true for a paused enrollment with no next or last session (004:T074, FR-506)', () => {
    const { paused: _paused, ...without } = item;
    expect(teacherStudentItem.safeParse(without).success).toBe(false);
    expect(teacherStudentItem.safeParse({ ...item, paused: 1 }).success).toBe(false);
    const { next: _next, last: _last, ...bare } = item;
    const paused = { ...bare, paused: true };
    expect(teacherStudentItem.parse(paused)).toEqual(paused);
    const detail = { ...paused, sessions: [], ijazahRequest: null };
    expect(teacherStudentsGetOutput.parse(detail)).toEqual(detail);
  });

  // 004:T082 (FR-513; SRS FR-CANCEL-10, DEC-68): an enrollment an administrator ended directly
  // carries the reason both parties are shown, never the internal note. Additive (R-API-9).
  it('carries endedByAdmin with the party reason only, optional (004:T082, FR-513)', () => {
    const { next: _next, last: _last, ...bare } = item;
    const ended = { ...bare, status: 'cancelled', endedByAdmin: { reason: 'انتهى الاشتراك' } };
    expect(teacherStudentItem.parse(ended)).toEqual(ended);
    expect(
      teacherStudentItem.parse({
        ...ended,
        endedByAdmin: { reason: 'انتهى الاشتراك', internalNote: 'ملاحظة داخلية' },
      }),
    ).toEqual(ended);
    expect(teacherStudentItem.parse(item)).toEqual(item);
    expect(teacherStudentItem.safeParse({ ...ended, endedByAdmin: {} }).success).toBe(false);
    const detail = { ...ended, sessions: [], ijazahRequest: null };
    expect(teacherStudentsGetOutput.parse(detail)).toEqual(detail);
  });

  it('names the student by display name alone, and whether the account was deleted (T007)', () => {
    expect(Object.keys(teacherStudentItem.shape.student.shape)).toEqual([
      'studentId',
      'displayName',
      'displayNameOrNull',
      'deleted',
    ]);
  });

  it('parses a student whose account was deleted: no name, and deleted (T007, FR-426)', () => {
    const gone = {
      ...item,
      student: { studentId: ids.student, displayName: '', displayNameOrNull: null, deleted: true },
    };
    expect(teacherStudentItem.parse(gone)).toEqual(gone);
  });

  // 005:T021 (FR-611, FR-614; the note under T021, Q-T4 (a)): the student's user id, which the
  // teacher's report and flag sheet names, on «طلابي», the enrollment and «اليوم». Required, a
  // deleted student's included: an id is no name, as a student's `teacher.teacherId` stays
  // (`enrollments.ts:123`). Additive (R-API-9).
  it('carries the student’s user id, required, a deleted student’s too (005:T021)', () => {
    expect(teacherStudentItem.parse(item).student.studentId).toBe(ids.student);
    expect(
      teacherStudentsGetOutput.parse({ ...item, sessions: [session], ijazahRequest: null }).student
        .studentId,
    ).toBe(ids.student);
    const { studentId: _absent, ...without } = item.student;
    expect(teacherStudentItem.safeParse({ ...item, student: without }).success).toBe(false);
    expect(
      teacherStudentItem.safeParse({ ...item, student: { ...item.student, studentId: 'x' } })
        .success,
    ).toBe(false);
    const day = { enrollmentId: ids.enrollment, student: item.student, summary, ...session };
    expect(teacherTodaySession.parse(day).student.studentId).toBe(ids.student);
    expect(teacherTodaySession.safeParse({ ...day, student: without }).success).toBe(false);
  });

  it('strips a date of birth, a minor flag, documents, a dispute history, a photo key and a stray id', () => {
    const leaked = { ...item, ...forbidden, student: { ...item.student, ...forbidden } };
    expect(teacherStudentItem.parse(leaked)).toEqual(item);
    expect(
      teacherStudentsGetOutput.parse({ ...leaked, sessions: [session], ijazahRequest: null }),
    ).toEqual({
      ...item,
      sessions: [session],
      ijazahRequest: null,
    });
  });

  // 005:T006 (FR-608; app-surface.md, «Enrollment reads gain»): the enrollment's ijazah request, the
  // rejection's reason included for the teacher, null without one.
  it('carries ijazahRequest with its reason, required and nullable', () => {
    const detail = { ...item, sessions: [session] };
    expect(teacherStudentsGetOutput.safeParse(detail).success).toBe(false);
    const rejected = { status: 'rejected', reason: 'سبب الرفض' } as const;
    expect(
      teacherStudentsGetOutput.parse({ ...detail, ijazahRequest: rejected }).ijazahRequest,
    ).toEqual(rejected);
  });
});

describe('«اليوم» (FR-391, FR-393)', () => {
  const today = {
    enrollmentId: ids.enrollment,
    student: item.student,
    summary,
    ...session,
  } as const;

  it('answers the teacher’s local day, its zone, and each session with its enrollment and student', () => {
    const answer = { localDate: '2026-11-08', timezone: 'Africa/Cairo', sessions: [today] };
    expect(teacherTodayOutput.parse(answer)).toEqual(answer);
    expect(teacherTodayOutput.parse({ ...answer, sessions: [] }).sessions).toEqual([]);
  });

  it('carries each session’s id, on the day and on the enrollment (004:T020, FR-495)', () => {
    const { sessionId: _sessionId, ...withoutId } = today;
    expect(teacherTodaySession.safeParse(withoutId).success).toBe(false);
    expect(teacherTodaySession.parse(today).sessionId).toBe(session.sessionId);
    const { sessionId: _also, ...bare } = session;
    expect(teacherStudentsGetOutput.safeParse({ ...item, sessions: [bare] }).success).toBe(false);
  });

  it('strips what R-HONEST-4 keeps from the teacher', () => {
    expect(
      teacherTodaySession.parse({
        ...today,
        ...forbidden,
        student: { ...today.student, ...forbidden },
      }),
    ).toEqual(today);
  });
});

// 006:T020 (B-P4's conflict check, the owner, 2026-11-25; Q-3 (a), Q-4 (a)): the teacher's reads
// carry the same optional `programme` marker, and a programme's count past the old cap of 52.
describe('006:T020: a programme’s enrollment on the teacher’s reads (Q-3 (a), Q-4 (a))', () => {
  const programme = { state: 'paused', payBy: null, payReminderFrom: null } as const;
  const ijazah = { ...item, summary: { ...summary, sessionCount: 61 } };

  it('parses a 60-session offer’s enrollment with its marker, list and detail', () => {
    expect(teacherStudentItem.parse({ ...ijazah, programme })).toEqual({ ...ijazah, programme });
    const detail = { ...ijazah, programme, sessions: [], ijazahRequest: null };
    expect(teacherStudentsGetOutput.parse(detail)).toEqual(detail);
  });

  it('leaves the marker out of a non-programme enrollment', () => {
    expect(teacherStudentItem.parse(item)).not.toHaveProperty('programme');
  });
});
