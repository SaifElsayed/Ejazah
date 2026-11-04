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
//   - every session carries its local date, local start, zone, instants and status.
import { addMinutes } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { EnrollmentSessionRow, DaySession } from '../sessions/index.js';
import {
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
    ...overrides,
  };
}

function session(
  sequenceNumber: number,
  startsAt: string,
  status: EnrollmentSessionRow['status'] = 'scheduled',
): EnrollmentSessionRow {
  return {
    sequenceNumber,
    localDate: startsAt.slice(0, 10),
    startTimeLocal: '14:00:00',
    timezone: 'Africa/Cairo',
    startsAt: new Date(startsAt),
    endsAt: new Date(addMinutes(new Date(startsAt), 60)),
    status,
  };
}

const LISTED = {
  sequenceNumber: 2,
  localDate: '2026-11-17',
  startTimeLocal: '14:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-11-17T12:00:00.000Z',
  endsAt: '2026-11-17T13:00:00.000Z',
  status: 'scheduled',
};

interface Asked {
  readonly ended: { party: ListParty; page: unknown }[];
  readonly listed: { enrollmentId: string; party: ListParty }[];
  readonly prefix: { candidates: readonly string[]; typed: string }[];
  readonly day: { teacherUserId: string; from: string; to: string }[];
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
  } = {},
): { store: EnrollmentListsStore; asked: Asked } {
  const asked: Asked = { ended: [], listed: [], prefix: [], day: [] };
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
    const answer = await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'active' }, CLOCK);
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
    const [item] = (await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'active' }, CLOCK)).items;
    expect(item).toEqual({
      enrollmentId: E1,
      teacher: { teacherId: TEACHER, displayName: 'أحمد سالم' },
      summary: { subject, track: 'recitation', sessionCount: 4, sessionDurationMinutes: 60 },
      status: 'confirmed',
      next: LISTED,
      last: {
        ...LISTED,
        sequenceNumber: 4,
        localDate: '2026-12-01',
        startsAt: '2026-12-01T12:00:00.000Z',
        endsAt: '2026-12-01T13:00:00.000Z',
      },
      upcoming: 3,
      completed: 1,
      remaining: 3,
    });
  });

  it('answers an enrollment awaiting payment with no session and the whole package remaining', async () => {
    const { store } = storeOf({
      active: [row(E1, { status: 'pending_payment' })],
      names: { [TEACHER]: 'أحمد سالم' },
    });
    const [item] = (await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'active' }, CLOCK)).items;
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
    );
    expect(asked.ended).toEqual([
      { party: { studentUserId: STUDENT }, page: { after: E1, limit: 3 } },
    ]);
    expect(answer.items.map(({ enrollmentId }) => enrollmentId)).toEqual([E4, E3]);
    expect(answer.nextCursor).toBe(E3);
  });

  it('writes no cursor on the last page of the ended tab', async () => {
    const { store } = storeOf({ ended: [row(E4, { status: 'terminated_no_show' })] });
    const answer = await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'ended' }, CLOCK);
    expect(answer.items).toHaveLength(1);
    expect(answer.nextCursor).toBeUndefined();
  });

  it('names a deleted teacher with no name rather than failing', async () => {
    const { store } = storeOf({ active: [row(E1)] });
    const [item] = (await studentEnrollmentsOf(tx, store, STUDENT, { tab: 'active' }, CLOCK)).items;
    expect(item?.teacher).toEqual({ teacherId: TEACHER, displayName: '' });
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
    const answer = await studentEnrollmentOf(tx, store, STUDENT, { enrollmentId: E1 }, NOW);
    expect(asked.listed).toEqual([{ enrollmentId: E1, party: { studentUserId: STUDENT } }]);
    expect(answer.sessions.map(({ sequenceNumber, status }) => [sequenceNumber, status])).toEqual([
      [1, 'done'],
      [2, 'scheduled'],
    ]);
    expect(answer.next).toEqual(LISTED);
  });

  it('answers NOT_FOUND for an enrollment that is not the student’s, or none', async () => {
    const { store } = storeOf({ listed: null });
    await expect(
      studentEnrollmentOf(tx, store, STUDENT, { enrollmentId: E2 }, NOW),
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
    const answer = await teacherStudentsOf(tx, store, TEACHER, { tab: 'active' }, CLOCK);
    expect(answer.items.map(({ enrollmentId, student }) => [enrollmentId, student])).toEqual([
      [E2, { displayName: 'زياد حسن' }],
      [E1, { displayName: 'يوسف علي' }],
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
    const answer = await teacherStudentsOf(tx, store, TEACHER, { tab: 'ended', query: 'س' }, CLOCK);
    expect(answer).toEqual({ items: [] });
    expect(asked.ended).toEqual([]);
  });

  it('answers the teacher’s own enrollment with every session, asking for it as the teacher’s', async () => {
    const { store, asked } = storeOf({
      listed: row(E1),
      sessions: { [E1]: [session(1, '2026-11-17T12:00:00Z')] },
      names: NAMES,
    });
    const answer = await teacherStudentOf(tx, store, TEACHER, { enrollmentId: E1 }, NOW);
    expect(asked.listed).toEqual([{ enrollmentId: E1, party: { teacherUserId: TEACHER } }]);
    expect(answer.student).toEqual({ displayName: 'يوسف علي' });
    expect(answer.sessions).toHaveLength(1);
  });

  it('answers NOT_FOUND for an enrollment that is not the teacher’s', async () => {
    const { store } = storeOf({ listed: null });
    await expect(teacherStudentOf(tx, store, TEACHER, { enrollmentId: E2 }, NOW)).rejects.toEqual(
      new DomainError('NOT_FOUND'),
    );
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
    const answer = await teacherTodayOf(tx, store, TEACHER, lateEvening);
    expect(asked.day).toEqual([
      { teacherUserId: TEACHER, from: '2026-11-08T22:00:00.000Z', to: '2026-11-09T22:00:00.000Z' },
    ]);
    expect(answer.localDate).toBe('2026-11-09');
    expect(answer.timezone).toBe('Africa/Cairo');
    expect(
      answer.sessions.map((one) => [one.enrollmentId, one.student, one.sequenceNumber, one.status]),
    ).toEqual([
      [E1, { displayName: 'يوسف علي' }, 3, 'scheduled'],
      [E2, { displayName: 'زياد حسن' }, 1, 'done'],
    ]);
    expect(answer.sessions[0]).toMatchObject({
      localDate: '2026-11-09',
      startTimeLocal: '14:00',
      startsAt: '2026-11-09T07:00:00.000Z',
      summary: { subject, track: 'recitation', sessionCount: 4, sessionDurationMinutes: 60 },
    });
  });

  it('reads the day in another zone the teacher lives by', async () => {
    const { store, asked } = storeOf({ timezone: 'America/New_York' });
    const answer = await teacherTodayOf(tx, store, TEACHER, new Date('2026-11-09T03:00:00Z'));
    expect(answer.localDate).toBe('2026-11-08');
    expect(asked.day[0]).toMatchObject({ from: '2026-11-08T05:00:00.000Z' });
  });
});
