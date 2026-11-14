// T049 — the lists (FR-390 to FR-393, FR-395) over a store faked in memory: what each list asks of
// the owners' entries and what it answers. The queries themselves, ownership against real rows and
// the folded search run on the database in `tests/db-integrity/enrollment-lists.spec.ts`.
//
//   - the student's active tab is ordered by next session, those with none after, newest first,
//     in one page; the ended tab pages by enrollment id, a cursor while more remain;
//   - upcoming, completed and remaining are derived from the sessions (FR-392);
//   - the teacher's search folds the student's name through the kernel's query over the tab's own
//     students only, in both tabs (FR-391);
//   - a detail that is not the caller's answers NOT_FOUND;
//   - «اليوم» is the teacher's local day in the teacher's zone (FR-393);
//   - every session carries its id (004:T020, FR-495: the phone opens its pre-session screen), its
//     local date, local start, zone, instants and status, a disputed one `disputed` with no frozen
//     outcome beside it (R-308);
//   - a party absent from identity's names (a deleted account) is answered deleted, with no name
//     and the deprecated name empty, on every list and detail (T007, FR-426);
//   - every session carries `pendingCancellation`, sessions' read of its sessions at the read's
//     instant (004:T021, FR-456, FR-495; contracts/app-surface.md, "Phase 2's lists");
//   - every session carries `disputed`, its status `disputed` (004:T026, FR-473, FR-495).
import { addMinutes } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { EnrollmentCase } from '../moderation/index.js';
import type { DaySession, EnrollmentSessionRow, WindowDays } from '../sessions/index.js';
import {
  createEnrollmentListServices,
  type EnrollmentListsStore,
  type ListedEnrollmentRow,
  type ListParty,
  studentEnrollmentOf,
  studentEnrollmentsOf,
  teacherStudentOf,
  teacherStudentsOf,
  teacherTodayOf,
} from './enrollment-lists.service.js';

const tx = {} as Transaction;
const NOW = new Date('2026-11-10T12:00:00Z');
const CLOCK = { now: NOW, pageSize: 2 };
/** 004:T074: both restore windows, 14 days, as the seed holds them (T069). */
const WINDOWS: WindowDays = async () => 14;

const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const OTHER_STUDENT = '0199d0a0-0000-7000-8000-0000000000a2';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000b1';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000c1';
const E1 = '0199d0a0-0000-7000-8000-0000000000e1';
const E2 = '0199d0a0-0000-7000-8000-0000000000e2';
const E3 = '0199d0a0-0000-7000-8000-0000000000e3';
const E4 = '0199d0a0-0000-7000-8000-0000000000e4';

const subject = { id: SUBJECT, nameAr: 'حفظ القرآن', nameEn: 'Quran memorisation' };

function row(id: string, overrides: Partial<ListedEnrollmentRow> = {}): ListedEnrollmentRow {
  return {
    id,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    status: 'confirmed',
    snapshotSubjectId: SUBJECT,
    snapshotTrack: 'recitation',
    snapshotSessionCount: 4,
    snapshotDurationMinutes: 60,
    // 004:T074: the closing's reason and its release, read for `paused`.
    cancellationReason: null,
    slotReleasedAt: null,
    ...overrides,
  };
}

/** A session's id, by its start: one per session of the spec. */
const sessionIdOf = (startsAt: string): string =>
  `0199d0a0-0000-7000-8000-${startsAt.slice(5, 16).replace(/D/g, '').padStart(12, '0')}`;

function session(
  sequenceNumber: number,
  startsAt: string,
  status: EnrollmentSessionRow['status'] = 'scheduled',
  values: Partial<EnrollmentSessionRow> = {},
): EnrollmentSessionRow {
  return {
    id: sessionIdOf(startsAt),
    sequenceNumber,
    localDate: startsAt.slice(0, 10),
    startTimeLocal: '14:00:00',
    timezone: 'Africa/Cairo',
    startsAt: new Date(startsAt),
    endsAt: new Date(addMinutes(new Date(startsAt), 60)),
    status,
    ...values,
  };
}

const LISTED = {
  sessionId: sessionIdOf('2026-11-17T12:00:00Z'),
  sequenceNumber: 2,
  localDate: '2026-11-17',
  startTimeLocal: '14:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-11-17T12:00:00.000Z',
  endsAt: '2026-11-17T13:00:00.000Z',
  status: 'scheduled',
  pendingCancellation: false,
  disputed: false,
};

/** A live party's name as every list answers it (T007, FR-426): both fields, not deleted. */
const named = (name: string) => ({ displayName: name, displayNameOrNull: name, deleted: false });

/** A deleted party (T007, FR-426): no name, deleted, the deprecated field empty for an older phone. */
const DELETED = { displayName: '', displayNameOrNull: null, deleted: true };

interface Asked {
  readonly ended: { party: ListParty; page: unknown }[];
  readonly listed: { enrollmentId: string; party: ListParty }[];
  readonly prefix: { candidates: readonly string[]; typed: string }[];
  readonly day: { teacherUserId: string; from: string; to: string }[];
  /** 004:T021: the sessions and the instant `pendingCancellation` was read for. */
  readonly pending: { sessionIds: readonly string[]; at: string }[];
  /** 004:T074: each read of the cases, by the enrollments asked. */
  readonly cases: (readonly string[])[];
}

function storeOf(
  data: {
    active?: readonly ListedEnrollmentRow[];
    ended?: readonly ListedEnrollmentRow[];
    endedStudents?: readonly string[];
    listed?: ListedEnrollmentRow | null;
    sessions?: Record<string, readonly EnrollmentSessionRow[]>;
    day?: readonly DaySession[];
    names?: Record<string, string>;
    matches?: readonly string[];
    timezone?: string | null;
    /** 004:T021: the session ids with a request pending. */
    pending?: readonly string[];
    /** 004:T028: each session's remedy status. */
    remedies?: Record<string, 'awaiting_choice' | 'proposed' | 'frozen' | 'booked'>;
    /** 004:T060: the enrollments whose complaint is open. */
    complaints?: readonly string[];
    /** 004:T074: each enrollment's compensation cases, newest first (moderation's). */
    cases?: Record<string, readonly EnrollmentCase[]>;
  } = {},
): { store: EnrollmentListsStore; asked: Asked } {
  const asked: Asked = { ended: [], listed: [], prefix: [], day: [], pending: [], cases: [] };
  const store: EnrollmentListsStore = {
    activeOfStudent: async () => data.active ?? [],
    activeOfTeacher: async () => data.active ?? [],
    endedPage: async (_tx, party, page) => {
      asked.ended.push({ party, page });
      return data.ended ?? [];
    },
    endedStudentIdsOf: async () => data.endedStudents ?? [],
    listedOf: async (_tx, enrollmentId, party) => {
      asked.listed.push({ enrollmentId, party });
      return data.listed ?? null;
    },
    teacherEnrollmentsAmong: async (_tx, _teacher, ids) =>
      (data.active ?? []).filter(({ id }) => ids.includes(id)),
    sessionsOf: async (_tx, ids) =>
      new Map(ids.flatMap((id) => (data.sessions?.[id] ? [[id, data.sessions[id]]] : []))),
    teacherDay: async (_tx, teacherUserId, window) => {
      asked.day.push({
        teacherUserId,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
      });
      return data.day ?? [];
    },
    namesOf: async (_tx, ids) =>
      new Map(ids.flatMap((id) => (data.names?.[id] ? [[id, data.names[id]]] : []))),
    subjectsOf: async (_tx, ids) => new Map(ids.map((id) => [id, { ...subject, id }])),
    namePrefixMatches: async (_tx, candidates, typed) => {
      asked.prefix.push({ candidates, typed });
      return data.matches ?? [];
    },
    timezoneOf: async () => (data.timezone === undefined ? 'Africa/Cairo' : data.timezone),
    pendingCancellationsOf: async (_tx, sessionIds, at) => {
      asked.pending.push({ sessionIds, at: at.toISOString() });
      return new Set(sessionIds.filter((id) => (data.pending ?? []).includes(id)));
    },
    remedyStatusesOf: async (_tx, sessionIds) =>
      new Map(
        sessionIds.flatMap((id) => {
          const status = data.remedies?.[id];
          return status === undefined ? [] : [[id, status] as const];
        }),
      ),
    // 004:T060.
    complaintOpenOf: async (_tx, enrollmentId) => (data.complaints ?? []).includes(enrollmentId),
    // 004:T074.
    casesAmong: async (_tx, enrollmentIds) => {
      asked.cases.push(enrollmentIds);
      return new Map(enrollmentIds.map((id) => [id, [...(data.cases?.[id] ?? [])]]));
    },
  };
  return { store, asked };
}

describe('the student’s enrollments (FR-390, FR-392)', () => {
  it('orders the active tab by next session, those with none after it, newest first, in one page', async () => {
    const { store, asked } = storeOf({
      active: [
        row(E1),
        row(E2, { status: 'pending_payment' }),
        row(E3),
        row(E4, { status: 'pending_payment' }),
      ],
      sessions: {
        [E1]: [session(1, '2026-11-24T12:00:00Z')],
        [E3]: [session(1, '2026-11-12T12:00:00Z')],
      },
      names: { [TEACHER]: 'أحمد سالم' },
    });
    const answer = await studentEnrollmentsOf(
      tx,
      store,
      STUDENT,
      { tab: 'active' },
      CLOCK,
      WINDOWS,
    );
    expect(answer.items.map(({ enrollmentId }) => enrollmentId)).toEqual([E3, E1, E4, E2]);
    expect(answer.nextCursor).toBeUndefined();
    expect(asked.ended).toEqual([]);
  });

  it('answers each item with its teacher, its package line, its status, its sessions and its derived counts', async () => {
    const { store } = storeOf({
      active: [row(E1)],
      sessions: {
        [E1]: [
          session(1, '2026-11-10T09:00:00Z', 'done'),
          session(2, '2026-11-17T12:00:00Z'),
          session(3, '2026-11-24T12:00:00Z'),
          session(4, '2026-12-01T12:00:00Z'),
        ],
      },
      names: { [TEACHER]: 'أحمد سالم' },
    });
    const [item] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'active' }, CLOCK, WINDOWS)
    ).items;
    expect(item).toEqual({
      enrollmentId: E1,
      teacher: { teacherId: TEACHER, ...named('أحمد سالم') },
      summary: { subject, track: 'recitation', sessionCount: 4, sessionDurationMinutes: 60 },
      status: 'confirmed',
      next: LISTED,
      last: {
        ...LISTED,
        sessionId: sessionIdOf('2026-12-01T12:00:00Z'),
        sequenceNumber: 4,
        localDate: '2026-12-01',
        startsAt: '2026-12-01T12:00:00.000Z',
        endsAt: '2026-12-01T13:00:00.000Z',
      },
      upcoming: 3,
      completed: 1,
      remaining: 3,
      paused: false,
    });
  });

  it('answers an enrollment awaiting payment with no session and the whole package remaining', async () => {
    const { store } = storeOf({
      active: [row(E1, { status: 'pending_payment' })],
      names: { [TEACHER]: 'أحمد سالم' },
    });
    const [item] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'active' }, CLOCK, WINDOWS)
    ).items;
    expect(item).toMatchObject({
      status: 'pending_payment',
      upcoming: 0,
      completed: 0,
      remaining: 4,
    });
    expect(item).not.toHaveProperty('next');
    expect(item).not.toHaveProperty('last');
  });

  it('pages the ended tab by enrollment id after the cursor, one row more than the page to know more remain', async () => {
    const { store, asked } = storeOf({
      ended: [row(E4, { status: 'completed' }), row(E3, { status: 'completed' }), row(E2)],
    });
    const answer = await studentEnrollmentsOf(
      tx,
      store,
      STUDENT,
      { tab: 'ended', cursor: E1 },
      CLOCK,
      WINDOWS,
    );
    expect(asked.ended).toEqual([
      { party: { studentUserId: STUDENT }, page: { after: E1, limit: 3 } },
    ]);
    expect(answer.items.map(({ enrollmentId }) => enrollmentId)).toEqual([E4, E3]);
    expect(answer.nextCursor).toBe(E3);
  });

  it('writes no cursor on the last page of the ended tab', async () => {
    const { store } = storeOf({ ended: [row(E4, { status: 'terminated_no_show' })] });
    const answer = await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'ended' }, CLOCK, WINDOWS);
    expect(answer.items).toHaveLength(1);
    expect(answer.nextCursor).toBeUndefined();
  });

  // T007 (FR-426): a deleted account is absent from identity's names (its name erased, its row
  // left out by the client's extension), and the item says so, for the phone's stand-in.
  it('answers a deleted teacher deleted, with no name, the deprecated name empty, in both tabs', async () => {
    const { store } = storeOf({ active: [row(E1)], ended: [row(E2, { status: 'completed' })] });
    const [active] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'active' }, CLOCK, WINDOWS)
    ).items;
    expect(active?.teacher).toEqual({ teacherId: TEACHER, ...DELETED });
    const [ended] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'ended' }, CLOCK, WINDOWS)
    ).items;
    expect(ended?.teacher).toEqual({ teacherId: TEACHER, ...DELETED });
  });

  it('answers a deleted teacher deleted on the enrollment’s detail', async () => {
    const { store } = storeOf({ listed: row(E1) });
    const answer = await studentEnrollmentOf(
      tx,
      store,
      STUDENT,
      { enrollmentId: E1 },
      NOW,
      WINDOWS,
    );
    expect(answer.teacher).toEqual({ teacherId: TEACHER, ...DELETED });
  });

  it('answers the student’s own enrollment with every session, asking for it as the student’s', async () => {
    const sessions = [
      session(1, '2026-11-10T09:00:00Z', 'done'),
      session(2, '2026-11-17T12:00:00Z'),
    ];
    const { store, asked } = storeOf({
      listed: row(E1),
      sessions: { [E1]: sessions },
      names: { [TEACHER]: 'أحمد سالم' },
    });
    const answer = await studentEnrollmentOf(
      tx,
      store,
      STUDENT,
      { enrollmentId: E1 },
      NOW,
      WINDOWS,
    );
    expect(asked.listed).toEqual([{ enrollmentId: E1, party: { studentUserId: STUDENT } }]);
    expect(answer.sessions.map(({ sequenceNumber, status }) => [sequenceNumber, status])).toEqual([
      [1, 'done'],
      [2, 'scheduled'],
    ]);
    expect(answer.next).toEqual(LISTED);
  });

  it('answers each session by its id, a disputed one `disputed` with no frozen outcome (004:T020, R-308)', async () => {
    const { store } = storeOf({
      listed: row(E1),
      sessions: {
        [E1]: [
          session(1, '2026-11-03T09:00:00Z', 'disputed', {
            outcomeUnderDispute: 'student_no_show',
          }),
          session(2, '2026-11-10T09:00:00Z', 'teacher_no_show'),
        ],
      },
      names: { [TEACHER]: 'أحمد سالم' },
    });
    const answer = await studentEnrollmentOf(
      tx,
      store,
      STUDENT,
      { enrollmentId: E1 },
      NOW,
      WINDOWS,
    );
    expect(answer.sessions.map(({ sessionId, status }) => [sessionId, status])).toEqual([
      [sessionIdOf('2026-11-03T09:00:00Z'), 'disputed'],
      [sessionIdOf('2026-11-10T09:00:00Z'), 'teacher_no_show'],
    ]);
    expect(answer.sessions[0]).not.toHaveProperty('outcomeUnderDispute');
    const teacher = await teacherStudentOf(tx, store, TEACHER, { enrollmentId: E1 }, NOW, WINDOWS);
    expect(teacher.sessions.map(({ sessionId }) => sessionId)).toEqual(
      answer.sessions.map(({ sessionId }) => sessionId),
    );
    expect(teacher.sessions[0]).not.toHaveProperty('outcomeUnderDispute');
  });

  it('answers NOT_FOUND for an enrollment that is not the student’s, or none', async () => {
    const { store } = storeOf({ listed: null });
    await expect(
      studentEnrollmentOf(tx, store, STUDENT, { enrollmentId: E2 }, NOW, WINDOWS),
    ).rejects.toEqual(new DomainError('NOT_FOUND'));
  });
});

describe('the teacher’s students (FR-391, FR-392, FR-395)', () => {
  const NAMES = { [STUDENT]: 'يوسف علي', [OTHER_STUDENT]: 'زياد حسن' };

  it('answers the active tab by next session, each named by the student’s display name alone', async () => {
    const { store, asked } = storeOf({
      active: [row(E1), row(E2, { studentUserId: OTHER_STUDENT })],
      sessions: {
        [E1]: [session(1, '2026-11-24T12:00:00Z')],
        [E2]: [session(1, '2026-11-12T12:00:00Z')],
      },
      names: NAMES,
    });
    const answer = await teacherStudentsOf(tx, store, TEACHER, { tab: 'active' }, CLOCK, WINDOWS);
    expect(answer.items.map(({ enrollmentId, student }) => [enrollmentId, student])).toEqual([
      [E2, named('زياد حسن')],
      [E1, named('يوسف علي')],
    ]);
    expect(asked.prefix).toEqual([]);
    expect(Object.keys(answer.items[0] ?? {})).not.toContain('teacher');
  });

  it('narrows the active tab by the student’s name, folded by the kernel over the tab’s own students', async () => {
    const { store, asked } = storeOf({
      active: [row(E1), row(E2, { studentUserId: OTHER_STUDENT }), row(E3)],
      names: NAMES,
      matches: [STUDENT],
    });
    const answer = await teacherStudentsOf(
      tx,
      store,
      TEACHER,
      { tab: 'active', query: 'يوس' },
      CLOCK,
      WINDOWS,
    );
    expect(asked.prefix).toEqual([{ candidates: [STUDENT, OTHER_STUDENT], typed: 'يوس' }]);
    expect(answer.items.map(({ enrollmentId }) => enrollmentId).sort()).toEqual([E1, E3]);
  });

  it('narrows the ended tab by the student’s name over the tab’s own students, then pages', async () => {
    const { store, asked } = storeOf({
      endedStudents: [STUDENT, OTHER_STUDENT],
      matches: [OTHER_STUDENT],
      ended: [row(E2, { studentUserId: OTHER_STUDENT, status: 'completed' })],
      names: NAMES,
    });
    const answer = await teacherStudentsOf(
      tx,
      store,
      TEACHER,
      { tab: 'ended', query: 'زي', cursor: E4 },
      CLOCK,
      WINDOWS,
    );
    expect(asked.prefix).toEqual([{ candidates: [STUDENT, OTHER_STUDENT], typed: 'زي' }]);
    expect(asked.ended).toEqual([
      {
        party: { teacherUserId: TEACHER },
        page: { after: E4, limit: 3, studentUserIds: [OTHER_STUDENT] },
      },
    ]);
    expect(answer.items.map(({ enrollmentId }) => enrollmentId)).toEqual([E2]);
  });

  it('answers an empty ended tab, reading no page, when no student’s name matches', async () => {
    const { store, asked } = storeOf({ endedStudents: [STUDENT], matches: [] });
    const answer = await teacherStudentsOf(
      tx,
      store,
      TEACHER,
      { tab: 'ended', query: 'س' },
      CLOCK,
      WINDOWS,
    );
    expect(answer).toEqual({ items: [] });
    expect(asked.ended).toEqual([]);
  });

  it('answers the teacher’s own enrollment with every session, asking for it as the teacher’s', async () => {
    const { store, asked } = storeOf({
      listed: row(E1),
      sessions: { [E1]: [session(1, '2026-11-17T12:00:00Z')] },
      names: NAMES,
    });
    const answer = await teacherStudentOf(tx, store, TEACHER, { enrollmentId: E1 }, NOW, WINDOWS);
    expect(asked.listed).toEqual([{ enrollmentId: E1, party: { teacherUserId: TEACHER } }]);
    expect(answer.student).toEqual(named('يوسف علي'));
    expect(answer.sessions).toHaveLength(1);
  });

  // T007 (FR-426): a deleted student, in either tab and on the detail.
  it('answers a deleted student deleted, with no name, the deprecated name empty, in both tabs and the detail', async () => {
    const { store } = storeOf({
      active: [row(E1), row(E2, { studentUserId: OTHER_STUDENT })],
      ended: [row(E3, { studentUserId: OTHER_STUDENT, status: 'completed' })],
      listed: row(E2, { studentUserId: OTHER_STUDENT }),
      names: { [STUDENT]: 'يوسف علي' },
    });
    const active = await teacherStudentsOf(tx, store, TEACHER, { tab: 'active' }, CLOCK, WINDOWS);
    expect(
      Object.fromEntries(active.items.map(({ enrollmentId, student }) => [enrollmentId, student])),
    ).toEqual({ [E1]: named('يوسف علي'), [E2]: DELETED });
    const ended = await teacherStudentsOf(tx, store, TEACHER, { tab: 'ended' }, CLOCK, WINDOWS);
    expect(ended.items.map(({ student }) => student)).toEqual([DELETED]);
    const detail = await teacherStudentOf(tx, store, TEACHER, { enrollmentId: E2 }, NOW, WINDOWS);
    expect(detail.student).toEqual(DELETED);
  });

  it('answers NOT_FOUND for an enrollment that is not the teacher’s', async () => {
    const { store } = storeOf({ listed: null });
    await expect(
      teacherStudentOf(tx, store, TEACHER, { enrollmentId: E2 }, NOW, WINDOWS),
    ).rejects.toEqual(new DomainError('NOT_FOUND'));
  });
});

describe('«اليوم» (FR-391, FR-393)', () => {
  it('reads the teacher’s local day in the teacher’s zone: Cairo’s 9 November at 00:30 local', async () => {
    const lateEvening = new Date('2026-11-08T22:30:00Z');
    const day: DaySession[] = [
      { enrollmentId: E1, ...session(3, '2026-11-09T07:00:00Z') },
      { enrollmentId: E2, ...session(1, '2026-11-09T09:00:00Z', 'done') },
    ];
    const { store, asked } = storeOf({
      active: [row(E1), row(E2, { studentUserId: OTHER_STUDENT })],
      day,
      names: { [STUDENT]: 'يوسف علي', [OTHER_STUDENT]: 'زياد حسن' },
    });
    const answer = await teacherTodayOf(tx, store, TEACHER, lateEvening, WINDOWS);
    expect(asked.day).toEqual([
      { teacherUserId: TEACHER, from: '2026-11-08T22:00:00.000Z', to: '2026-11-09T22:00:00.000Z' },
    ]);
    expect(answer.localDate).toBe('2026-11-09');
    expect(answer.timezone).toBe('Africa/Cairo');
    expect(
      answer.sessions.map((one) => [one.enrollmentId, one.student, one.sequenceNumber, one.status]),
    ).toEqual([
      [E1, named('يوسف علي'), 3, 'scheduled'],
      [E2, named('زياد حسن'), 1, 'done'],
    ]);
    expect(answer.sessions.map(({ sessionId }) => sessionId)).toEqual([
      sessionIdOf('2026-11-09T07:00:00Z'),
      sessionIdOf('2026-11-09T09:00:00Z'),
    ]);
    expect(answer.sessions[0]).toMatchObject({
      localDate: '2026-11-09',
      startTimeLocal: '14:00',
      startsAt: '2026-11-09T07:00:00.000Z',
      summary: { subject, track: 'recitation', sessionCount: 4, sessionDurationMinutes: 60 },
    });
  });

  it('answers a deleted student of the day deleted, with no name, the deprecated name empty (T007)', async () => {
    const { store } = storeOf({
      active: [row(E1, { studentUserId: OTHER_STUDENT })],
      day: [{ enrollmentId: E1, ...session(3, '2026-11-09T07:00:00Z') }],
    });
    const answer = await teacherTodayOf(
      tx,
      store,
      TEACHER,
      new Date('2026-11-09T06:00:00Z'),
      WINDOWS,
    );
    expect(answer.sessions.map(({ student }) => student)).toEqual([DELETED]);
  });

  it('reads the day in another zone the teacher lives by', async () => {
    const { store, asked } = storeOf({ timezone: 'America/New_York' });
    const answer = await teacherTodayOf(
      tx,
      store,
      TEACHER,
      new Date('2026-11-09T03:00:00Z'),
      WINDOWS,
    );
    expect(answer.localDate).toBe('2026-11-08');
    expect(asked.day[0]).toMatchObject({ from: '2026-11-08T05:00:00.000Z' });
  });
});

// 004:T021 (FR-456, FR-495; contracts/app-surface.md, "Phase 2's lists, widened additively"): each
// session's `pendingCancellation`, read from sessions' entry for the sessions the list answers, at
// the read's instant; sessions decides what is pending (a stored request, its session scheduled and
// not started).
describe('pendingCancellation (004:T021)', () => {
  const NEXT = session(2, '2026-11-17T12:00:00Z');
  const LATER = session(3, '2026-11-24T12:00:00Z');

  it('marks the student’s sessions with a request pending, in a list item and in a detail', async () => {
    const { store, asked } = storeOf({
      active: [row(E1)],
      listed: row(E1),
      sessions: { [E1]: [session(1, '2026-11-10T09:00:00Z', 'done'), NEXT, LATER] },
      names: { [TEACHER]: 'أحمد سالم' },
      pending: [NEXT.id],
    });
    const [item] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'active' }, CLOCK, WINDOWS)
    ).items;
    expect(item?.next).toEqual({ ...LISTED, pendingCancellation: true });
    expect(item?.last?.pendingCancellation).toBe(false);
    const detail = await studentEnrollmentOf(
      tx,
      store,
      STUDENT,
      { enrollmentId: E1 },
      NOW,
      WINDOWS,
    );
    expect(detail.sessions.map(({ pendingCancellation }) => pendingCancellation)).toEqual([
      false,
      true,
      false,
    ]);
    expect(asked.pending).toEqual([
      {
        sessionIds: [sessionIdOf('2026-11-10T09:00:00Z'), NEXT.id, LATER.id],
        at: NOW.toISOString(),
      },
      {
        sessionIds: [sessionIdOf('2026-11-10T09:00:00Z'), NEXT.id, LATER.id],
        at: NOW.toISOString(),
      },
    ]);
  });

  it('marks the teacher’s students’ sessions and the day’s sessions', async () => {
    const { store } = storeOf({
      active: [row(E1)],
      listed: row(E1),
      sessions: { [E1]: [NEXT, LATER] },
      day: [{ enrollmentId: E1, ...NEXT }],
      names: { [STUDENT]: 'يوسف علي' },
      pending: [NEXT.id],
    });
    const [item] = (await teacherStudentsOf(tx, store, TEACHER, { tab: 'active' }, CLOCK, WINDOWS))
      .items;
    expect(item?.next?.pendingCancellation).toBe(true);
    const detail = await teacherStudentOf(tx, store, TEACHER, { enrollmentId: E1 }, NOW, WINDOWS);
    expect(detail.sessions.map(({ pendingCancellation }) => pendingCancellation)).toEqual([
      true,
      false,
    ]);
    const today = await teacherTodayOf(tx, store, TEACHER, NOW, WINDOWS);
    expect(today.sessions.map(({ pendingCancellation }) => pendingCancellation)).toEqual([true]);
  });

  it('answers false on every session when none has a request pending', async () => {
    const { store } = storeOf({
      listed: row(E1),
      sessions: { [E1]: [NEXT, LATER] },
      names: { [TEACHER]: 'أحمد سالم' },
    });
    const detail = await studentEnrollmentOf(
      tx,
      store,
      STUDENT,
      { enrollmentId: E1 },
      NOW,
      WINDOWS,
    );
    expect(detail.sessions.every(({ pendingCancellation }) => !pendingCancellation)).toBe(true);
  });
});

// 004:T026 (FR-473, FR-495; contracts/app-surface.md, "Phase 2's lists, widened additively"): each
// session's `disputed`, its status `disputed` (sessions' `isDisputed`), joined at B37's integration.
describe('disputed (004:T026)', () => {
  it('marks a disputed session and no other: the next session in a list item, the student’s and the teacher’s details', async () => {
    const DISPUTED = session(1, '2026-11-10T09:00:00Z', 'disputed');
    const NEXT = session(2, '2026-11-17T12:00:00Z');
    const { store } = storeOf({
      active: [row(E1)],
      listed: row(E1),
      sessions: { [E1]: [DISPUTED, NEXT] },
      names: { [TEACHER]: 'أحمد سالم', [STUDENT]: 'يوسف علي' },
    });
    const [item] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'active' }, CLOCK, WINDOWS)
    ).items;
    expect(item?.next).toEqual(LISTED);
    const detail = await studentEnrollmentOf(
      tx,
      store,
      STUDENT,
      { enrollmentId: E1 },
      NOW,
      WINDOWS,
    );
    expect(detail.sessions.map(({ disputed }) => disputed)).toEqual([true, false]);
    const taught = await teacherStudentOf(tx, store, TEACHER, { enrollmentId: E1 }, NOW, WINDOWS);
    expect(taught.sessions.map(({ disputed }) => disputed)).toEqual([true, false]);
  });
});

// The follow-up under 004:T021 (PR #131's review, round 2; the owner's decision of 2026-11-10): the
// lists read `pendingCancellation`, and `sessionProgress` beside it, at the database's clock on the
// read's transaction, as `sessions.get` and every decision path do, never the process clock: around
// the start, a list must not show pending what every path refuses `CANCELLATION_EXPIRED`.
describe('the lists’ instant is the database’s clock on the read’s transaction (004:T021’s follow-up)', () => {
  // A session starting long after the process clock; the database's clock is at its end, so it has
  // started (its request expired) and is over (no longer next).
  const STARTS = '2099-01-01T10:00:00Z';
  const AT_END = new Date('2099-01-01T11:00:00Z');
  const FAR = session(1, STARTS);

  function services() {
    const { store, asked } = storeOf({
      active: [row(E1)],
      listed: row(E1),
      sessions: { [E1]: [FAR] },
      day: [{ enrollmentId: E1, ...FAR }],
      names: { [TEACHER]: 'أحمد سالم', [STUDENT]: 'يوسف علي' },
      pending: [FAR.id],
    });
    const clocked: Transaction[] = [];
    const lists = createEnrollmentListServices({
      database: { $transaction: async (work: (tx: Transaction) => unknown) => work(tx) } as never,
      settings: { read: async (_key, schema) => schema.parse(2) },
      clock: async (on: Transaction) => {
        clocked.push(on);
        return AT_END;
      },
      store,
    });
    return { lists, asked, clocked };
  }

  it('reads every list’s and detail’s pendingCancellation at the database’s clock, never the process clock', async () => {
    const { lists, asked, clocked } = services();
    await lists.enrollments(STUDENT, { tab: 'active' });
    await lists.enrollment(STUDENT, { enrollmentId: E1 });
    await lists.students(TEACHER, { tab: 'active' });
    await lists.student(TEACHER, { enrollmentId: E1 });
    await lists.today(TEACHER);
    expect(asked.pending.map(({ at }) => at)).toEqual(Array(5).fill(AT_END.toISOString()));
    expect(clocked).toEqual(Array(5).fill(tx));
  });

  it('feeds sessionProgress the same instant: a session the database’s clock has seen end is no longer next', async () => {
    const { lists } = services();
    const [item] = (await lists.enrollments(STUDENT, { tab: 'active' })).items;
    expect(item?.next).toBeUndefined();
    expect(item?.last?.sessionId).toBe(FAR.id);
  });
});

// 004:T028 (FR-495; contracts/app-surface.md, "Phase 2's lists, widened additively"): each session's
// `remedyStatus`, sessions' read of its remedy through its entry (R-API-6), absent when it has none
// (or a lapsed one, which sessions never answers).
describe('remedyStatus (004:T028)', () => {
  // The highest sequence number, so it is the item's `last`: a make-up's place, made up for later.
  const OWED = session(3, '2026-11-10T09:00:00Z', 'teacher_no_show');
  const NEXT = session(2, '2026-11-17T12:00:00Z');

  it('marks a session with a remedy by its status, on a list item, a detail and the day, and leaves the others without it', async () => {
    const { store } = storeOf({
      active: [row(E1)],
      listed: row(E1),
      sessions: { [E1]: [OWED, NEXT] },
      day: [{ enrollmentId: E1, ...OWED }],
      names: { [TEACHER]: 'أحمد سالم', [STUDENT]: 'يوسف علي' },
      remedies: { [OWED.id]: 'awaiting_choice' },
    });
    const [item] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'active' }, CLOCK, WINDOWS)
    ).items;
    expect(item?.last?.remedyStatus).toBe('awaiting_choice');
    expect(item?.next).toEqual(LISTED);
    const detail = await studentEnrollmentOf(
      tx,
      store,
      STUDENT,
      { enrollmentId: E1 },
      NOW,
      WINDOWS,
    );
    expect(detail.sessions.map(({ remedyStatus }) => remedyStatus)).toEqual([
      'awaiting_choice',
      undefined,
    ]);
    const taught = await teacherStudentOf(tx, store, TEACHER, { enrollmentId: E1 }, NOW, WINDOWS);
    expect(taught.sessions[0]?.remedyStatus).toBe('awaiting_choice');
    const today = await teacherTodayOf(tx, store, TEACHER, NOW, WINDOWS);
    expect(today.sessions[0]?.remedyStatus).toBe('awaiting_choice');
  });
});

describe('complaintOpen (004:T060, FR-452)', () => {
  it('answers the enrollment’s detail complaintOpen while its complaint is open, read through moderation’s entry', async () => {
    const open = storeOf({ listed: row(E1), names: { [TEACHER]: 'أحمد سالم' }, complaints: [E1] });
    expect(
      (await studentEnrollmentOf(tx, open.store, STUDENT, { enrollmentId: E1 }, NOW, WINDOWS))
        .complaintOpen,
    ).toBe(true);
    const none = storeOf({ listed: row(E1), names: { [TEACHER]: 'أحمد سالم' }, complaints: [E2] });
    expect(
      (await studentEnrollmentOf(tx, none.store, STUDENT, { enrollmentId: E1 }, NOW, WINDOWS))
        .complaintOpen,
    ).toBe(false);
  });
});

// 004:T074 (FR-506; DEC-69, Q11 (a); the note under T074, Q-O1 (a), Q-R7 (a), N3, N4): an enrollment
// paused by a teacher's suspension (`confirmed`, its `teacher_suspended` case open), or closed by a
// ban or a revocation while its slot is held (the one closing rule's `student_banned` or
// `teacher_ended` closing, its case open, `slot_released_at` NULL, the read's instant before
// `restorableUntil`), is answered `paused: true` with no session: no `next`, no `last`, the detail's
// `sessions` empty, the three counts kept, the tab and the status unchanged. Every other enrollment
// is `paused: false`. The cases are read through moderation's `compensationCasesAmong` once per read;
// «اليوم» leaves a paused enrollment's sessions out.
describe('paused (004:T074, FR-506)', () => {
  /** A case opened five days before NOW: its ban window (14 days) still running. */
  const OPENED = new Date('2026-11-05T12:00:00Z');
  /** A case opened 20 days before NOW: its window over. */
  const LONG_AGO = new Date('2026-10-21T12:00:00Z');
  const caseOf = (
    caseId: string,
    reason: string,
    status: EnrollmentCase['status'] = 'open',
    createdAt = OPENED,
  ): EnrollmentCase => ({ caseId, reason, status, createdAt });
  const C1 = '0199d0a0-0000-7000-8000-0000000000f1';
  const C2 = '0199d0a0-0000-7000-8000-0000000000f2';
  const C3 = '0199d0a0-0000-7000-8000-0000000000f3';
  const C4 = '0199d0a0-0000-7000-8000-0000000000f4';
  const DONE = session(1, '2026-11-03T12:00:00Z', 'done');
  const CANCELLED = session(2, '2026-11-17T12:00:00Z', 'cancelled_by_admin');
  const LATER = session(3, '2026-11-24T12:00:00Z', 'cancelled_by_admin');
  const SESSIONS = [DONE, CANCELLED, LATER];
  // Sessions still scheduled, so a paused item's missing next and last are the rule's, not the data's.
  const AHEAD = [DONE, session(2, '2026-11-17T12:00:00Z'), session(3, '2026-11-24T12:00:00Z')];
  const banned = (id: string, values: Partial<ListedEnrollmentRow> = {}) =>
    row(id, { status: 'cancelled', cancellationReason: 'admin', ...values });

  it('answers a confirmed enrollment with an open teacher_suspended case paused, no next or last, its counts kept; another not paused; the cases read once', async () => {
    const { store, asked } = storeOf({
      active: [row(E1), row(E2)],
      sessions: { [E1]: AHEAD, [E2]: [session(1, '2026-11-17T12:00:00Z')] },
      names: { [TEACHER]: 'أحمد سالم' },
      cases: { [E1]: [caseOf(C1, 'teacher_suspended')] },
    });
    const { items } = await studentEnrollmentsOf(
      tx,
      store,
      STUDENT,
      { tab: 'active' },
      CLOCK,
      WINDOWS,
    );
    const byId = new Map(items.map((item) => [item.enrollmentId, item]));
    const paused = byId.get(E1);
    expect(paused).toMatchObject({ status: 'confirmed', paused: true, completed: 1 });
    expect(paused).not.toHaveProperty('next');
    expect(paused).not.toHaveProperty('last');
    expect(paused?.upcoming).toBe(2);
    expect(paused?.remaining).toBe(3);
    expect(byId.get(E2)).toMatchObject({ paused: false, next: { sequenceNumber: 1 } });
    expect(asked.cases).toEqual([[E1, E2]]);
  });

  it('answers a closed teacher_suspended case, or another open case, not paused', async () => {
    const { store } = storeOf({
      active: [row(E1), row(E2)],
      sessions: { [E1]: SESSIONS, [E2]: SESSIONS },
      names: { [TEACHER]: 'أحمد سالم' },
      cases: {
        [E1]: [caseOf(C1, 'teacher_suspended', 'resolved')],
        [E2]: [caseOf(C2, 'student_suspended')],
      },
    });
    const { items } = await studentEnrollmentsOf(
      tx,
      store,
      STUDENT,
      { tab: 'active' },
      CLOCK,
      WINDOWS,
    );
    expect(items.map(({ paused }) => paused)).toEqual([false, false]);
    expect(items.every((item) => item.last !== undefined)).toBe(true);
  });

  it('on the ended tab: a ban’s held closing paused; its window over, its slot released or an absence’s held closing not paused', async () => {
    const { store, asked } = storeOf({
      ended: [
        banned(E4),
        banned(E3, { slotReleasedAt: new Date('2026-11-06T12:00:00Z') }),
        banned(E2),
        row(E1, { status: 'terminated_no_show' }),
      ],
      sessions: { [E1]: SESSIONS, [E2]: SESSIONS, [E3]: SESSIONS, [E4]: SESSIONS },
      names: { [TEACHER]: 'أحمد سالم' },
      cases: {
        [E4]: [caseOf(C4, 'student_banned')],
        [E3]: [caseOf(C3, 'student_banned')],
        [E2]: [caseOf(C2, 'student_banned', 'open', LONG_AGO)],
        [E1]: [caseOf(C1, 'absence_termination')],
      },
    });
    const { items } = await studentEnrollmentsOf(
      tx,
      store,
      STUDENT,
      { tab: 'ended' },
      { now: NOW, pageSize: 4 },
      WINDOWS,
    );
    expect(items.map(({ enrollmentId, status, paused }) => [enrollmentId, status, paused])).toEqual(
      [
        [E4, 'cancelled', true],
        [E3, 'cancelled', false],
        [E2, 'cancelled', false],
        [E1, 'terminated_no_show', false],
      ],
    );
    expect(items[0]).not.toHaveProperty('last');
    expect(items[1]).toHaveProperty('last');
    expect(asked.cases).toEqual([[E4, E2]]);
  });

  it('answers a ban’s closing whose case was closed not paused', async () => {
    const { store } = storeOf({
      ended: [banned(E1)],
      sessions: { [E1]: SESSIONS },
      names: { [TEACHER]: 'أحمد سالم' },
      cases: { [E1]: [caseOf(C1, 'student_banned', 'resolved')] },
    });
    const [item] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'ended' }, CLOCK, WINDOWS)
    ).items;
    expect(item).toMatchObject({ paused: false, last: { sequenceNumber: 3 } });
  });

  it('answers a fault’s held closing (cancelled admin, student_fault_confirmed open) not paused: only a ban’s or a revocation’s', async () => {
    const { store } = storeOf({
      ended: [banned(E1)],
      sessions: { [E1]: SESSIONS },
      names: { [TEACHER]: 'أحمد سالم' },
      cases: { [E1]: [caseOf(C1, 'student_fault_confirmed')] },
    });
    const [item] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'ended' }, CLOCK, WINDOWS)
    ).items;
    expect(item).toMatchObject({ paused: false, last: { sequenceNumber: 3 } });
  });

  it('reads the window of the closing’s kind: a ban’s held closing paused until the case’s opening plus ban_restore_window_days, then not', async () => {
    const settingsAsked: string[] = [];
    const windows: WindowDays = async (setting) => {
      settingsAsked.push(setting);
      return 3;
    };
    const { store } = storeOf({
      ended: [banned(E1)],
      sessions: { [E1]: SESSIONS },
      names: { [TEACHER]: 'أحمد سالم' },
      cases: { [E1]: [caseOf(C1, 'student_banned')] },
    });
    // Opened 5 days before NOW: a 3 days' window over, a 14 days' still running.
    const [over] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'ended' }, CLOCK, windows)
    ).items;
    expect(over?.paused).toBe(false);
    expect(settingsAsked).toEqual(['ban_restore_window_days']);
    const [held] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'ended' }, CLOCK, WINDOWS)
    ).items;
    expect(held?.paused).toBe(true);
  });

  it('after a lift: the enrollment confirmed again, its ban case dismissed, not paused', async () => {
    const { store } = storeOf({
      active: [row(E1)],
      sessions: { [E1]: [...SESSIONS, session(4, '2026-12-01T12:00:00Z')] },
      names: { [TEACHER]: 'أحمد سالم' },
      cases: { [E1]: [caseOf(C1, 'student_banned', 'dismissed')] },
    });
    const [item] = (
      await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'active' }, CLOCK, WINDOWS)
    ).items;
    expect(item).toMatchObject({ paused: false, next: { sequenceNumber: 4 } });
  });

  it('answers the student’s detail of a paused enrollment with no session, its complaint still read', async () => {
    const { store } = storeOf({
      listed: banned(E1),
      sessions: { [E1]: SESSIONS },
      names: { [TEACHER]: 'أحمد سالم' },
      complaints: [E1],
      cases: { [E1]: [caseOf(C1, 'student_banned')] },
    });
    const detail = await studentEnrollmentOf(
      tx,
      store,
      STUDENT,
      { enrollmentId: E1 },
      NOW,
      WINDOWS,
    );
    expect(detail).toMatchObject({ paused: true, sessions: [], complaintOpen: true, completed: 1 });
    expect(detail).not.toHaveProperty('next');
  });

  it('answers the teacher a student’s ban held paused in the ended tab and the detail, and a teacher’s ban or revocation (teacher_ended) the same way', async () => {
    const { store, asked } = storeOf({
      ended: [
        banned(E2),
        row(E1, { status: 'cancelled', cancellationReason: 'teacher_suspended' }),
      ],
      listed: banned(E2),
      sessions: { [E1]: SESSIONS, [E2]: AHEAD },
      names: { [STUDENT]: 'يوسف علي' },
      cases: {
        [E2]: [caseOf(C2, 'student_banned')],
        [E1]: [caseOf(C1, 'teacher_ended')],
      },
    });
    const ended = await teacherStudentsOf(
      tx,
      store,
      TEACHER,
      { tab: 'ended' },
      { now: NOW, pageSize: 4 },
      WINDOWS,
    );
    expect(ended.items.map(({ enrollmentId, paused }) => [enrollmentId, paused])).toEqual([
      [E2, true],
      [E1, true],
    ]);
    expect(ended.items.every((item) => item.last === undefined)).toBe(true);
    const detail = await teacherStudentOf(tx, store, TEACHER, { enrollmentId: E2 }, NOW, WINDOWS);
    expect(detail).toMatchObject({ paused: true, sessions: [], upcoming: 2 });
    expect(asked.cases).toEqual([[E2, E1], [E2]]);
  });

  it('answers the teacher’s active tab with a paused enrollment paused, and every other not', async () => {
    const { store } = storeOf({
      active: [row(E1), row(E2, { studentUserId: OTHER_STUDENT })],
      sessions: { [E1]: SESSIONS, [E2]: SESSIONS },
      names: { [STUDENT]: 'يوسف علي', [OTHER_STUDENT]: 'زياد حسن' },
      cases: { [E1]: [caseOf(C1, 'teacher_suspended')] },
    });
    const { items } = await teacherStudentsOf(
      tx,
      store,
      TEACHER,
      { tab: 'active' },
      CLOCK,
      WINDOWS,
    );
    expect(
      Object.fromEntries(items.map(({ enrollmentId, paused }) => [enrollmentId, paused])),
    ).toEqual({ [E1]: true, [E2]: false });
  });

  it('leaves a paused enrollment’s sessions out of «اليوم», reading the cases once', async () => {
    const day: DaySession[] = [
      { enrollmentId: E1, ...session(3, '2026-11-09T07:00:00Z', 'cancelled_by_admin') },
      { enrollmentId: E2, ...session(1, '2026-11-09T09:00:00Z') },
    ];
    const { store, asked } = storeOf({
      active: [row(E1), row(E2, { studentUserId: OTHER_STUDENT })],
      day,
      names: { [STUDENT]: 'يوسف علي', [OTHER_STUDENT]: 'زياد حسن' },
      cases: { [E1]: [caseOf(C1, 'teacher_suspended')] },
    });
    const answer = await teacherTodayOf(
      tx,
      store,
      TEACHER,
      new Date('2026-11-09T06:00:00Z'),
      WINDOWS,
    );
    expect(answer.sessions.map(({ enrollmentId }) => enrollmentId)).toEqual([E2]);
    expect(asked.cases).toEqual([[E1, E2]]);
  });

  it('reads no case when no enrollment of the read could be paused (awaiting payment, completed)', async () => {
    const { store, asked } = storeOf({
      active: [row(E1, { status: 'pending_payment' })],
      ended: [row(E2, { status: 'completed' })],
      names: { [TEACHER]: 'أحمد سالم' },
    });
    const active = await studentEnrollmentsOf(
      tx,
      store,
      STUDENT,
      { tab: 'active' },
      CLOCK,
      WINDOWS,
    );
    const ended = await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'ended' }, CLOCK, WINDOWS);
    expect([...active.items, ...ended.items].map(({ paused }) => paused)).toEqual([false, false]);
    expect(asked.cases).toEqual([]);
  });
});
