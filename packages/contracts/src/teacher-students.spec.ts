// T049 — the teacher's lists of specs/003-booking/contracts/app-surface.md "`enrollments` and the
// teacher's lists": `teacher.students.list`, `teacher.students.get` and `teacher.today` (FR-391,
// FR-392, FR-393, FR-395). Written before the schemas, and run red first.
//
// What the teacher sees of a student is limited to what «طلابي», the enrollment and «اليوم» draw: the
// student's name, never a date of birth, a minor flag, a document, a gender-dispute history, a
// photo key or an id (FR-395, R-HONEST-4); zod strips any field the schema does not name.
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
} as const;

const summary = {
  subject: { id: ids.subject, nameAr: 'حفظ القرآن', nameEn: 'Quran memorisation' },
  track: 'ijazah_track',
  sessionCount: 8,
  sessionDurationMinutes: 45,
} as const;

const item = {
  enrollmentId: ids.enrollment,
  student: { displayName: 'يوسف علي', displayNameOrNull: 'يوسف علي', deleted: false },
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
    const detail = { ...item, sessions: [session] };
    expect(teacherStudentsGetOutput.parse(detail)).toEqual(detail);
    expect(teacherStudentsListOutput.parse({ items: [item] })).toEqual({ items: [item] });
  });

  it('names the student by display name alone, and whether the account was deleted (T007)', () => {
    expect(Object.keys(teacherStudentItem.shape.student.shape)).toEqual([
      'displayName',
      'displayNameOrNull',
      'deleted',
    ]);
  });

  it('parses a student whose account was deleted: no name, and deleted (T007, FR-426)', () => {
    const gone = { ...item, student: { displayName: '', displayNameOrNull: null, deleted: true } };
    expect(teacherStudentItem.parse(gone)).toEqual(gone);
  });

  it('strips a date of birth, a minor flag, documents, a dispute history, a photo key and an id', () => {
    const leaked = { ...item, ...forbidden, student: { ...item.student, ...forbidden } };
    expect(teacherStudentItem.parse(leaked)).toEqual(item);
    expect(teacherStudentsGetOutput.parse({ ...leaked, sessions: [session] })).toEqual({
      ...item,
      sessions: [session],
    });
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
