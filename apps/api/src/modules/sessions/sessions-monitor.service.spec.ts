// T024 of specs/004-sessions/tasks.md (FR-479, FR-451, FR-439, FR-454, FR-497; R-DB-4; research
// R-322, R-323 GAP-1 and GAP-4; contracts/admin-surface.md, `sessions.monitor.list/get`) —
// `createSessionsMonitor` over a recorded store and a recorded `EnrollmentSide`:
//
//   - the list reads `enrollmentPage` (status, and the ids the date filter finds in sessions' own
//     table) one page at a time; a name search reads in batches, each twice the one before, until the
//     page is full or the rows end, a cursor only while one more match exists (the owner's decision
//     of 2026-11-10 on lane B's Q3, payments' way); each item's parties (a deleted one unnamed),
//     progress, Teacher-No-Show count and mark at `repeated_absence_flag_count`, and next session;
//   - the detail's sessions (`cancellable`, `correctable`, the make-up's original, each remedy with
//     its proposal at the enrollment's slot's start in its zone, its counter-proposal's
//     `answerClosesAt` and its `bookingRetriedUntil`), its cases, its requests, its timeline newest
//     first from both sources (at one instant, the session rows first), and `restorableUntil` for an
//     enrollment the restore could admit by its closing and its case; an enrollment no page answers
//     refused NOT_FOUND through the file's one `refusal`, with one log line.
//
// Over the real tables: `tests/db-integrity/sessions-monitor.spec.ts`.
//
// T069 (B42a lane 69, Q-69-1 (a)): the two `enrollment_event_kind` values T069's migration adds,
// `slot_released` and `slot_hold_ended`, reach the timeline and pass the procedure's output schema.
//
// T070 (FR-503; SRS FR-CANCEL-9; the note under T070, Q4 (a)): `slotHeldUntil`, the closing case's
// opening plus its kind's window, for a closing the one closing rule admits with its case open and its
// slot not released (a complaint's, a fault's, a ban's, a teacher's ban or revocation), and
// `slotReleasedAt`, the release's instant; neither for a deletion's closing, a closed case or an
// enrollment not closed.
//
// T073 (the note under T073, Q4 (a); PR #138's review, round 3, Major 1, and round 4, nit):
// `closingCaseReason` reads the closing as R-322's step 1 does (`closingOf`), so `restorableUntil`,
// `@deprecated` and answered with the hold's end, is present for every closing step 1 admits with its
// case open, a ban's and a teacher's ban's or revocation's `teacher_ended` closing included, a
// release leaving it; never for a deletion's or a gender correction's.
import { sessionsMonitorGetOutput } from '@ijazah/contracts/admin';
import { addMinutes, resolveLocalDateTime } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type {
  EnrollmentEventEntry,
  EnrollmentPage,
  EnrollmentPageFilter,
  EnrollmentPageItem,
  EnrollmentSide,
  EnrollmentTerms,
} from './enrollment-side.port.js';
import type {
  CancellationRequestRow,
  MonitoredSessionRow,
  SessionEventRow,
} from './sessions-monitor.repository.js';
import { createSessionsMonitor, type SessionsMonitorStore } from './sessions-monitor.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-11-10T12:00:00Z');
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const STUDENT = id(901);
const TEACHER = id(902);
const SLOT = id(903);
const CAIRO = 'Africa/Cairo';

const SETTINGS: Readonly<Record<string, number>> = {
  admin_list_page_size: 2,
  repeated_absence_flag_count: 5,
  dispute_window_hours: 72,
  enrollment_restore_window_days: 7,
  // T070: a ban's or a revocation's hold.
  ban_restore_window_days: 3,
};

function item(n: number, overrides: Partial<EnrollmentPageItem> = {}): EnrollmentPageItem {
  return {
    enrollmentId: id(n),
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    status: 'confirmed',
    track: 'recitation',
    sessionCount: 8,
    cancellationReason: null,
    slotReleasedAt: null,
    ...overrides,
  };
}

/** A session row, `HH:MM:SS` in Cairo (UTC+2 in November), sixty minutes long. */
function session(
  n: number,
  localDate: string,
  status: MonitoredSessionRow['status'],
  overrides: Partial<MonitoredSessionRow> = {},
): MonitoredSessionRow {
  const startsAt = new Date(
    resolveLocalDateTime({ localDate, localTime: '14:00:00', timezone: CAIRO }).startsAt,
  );
  return {
    id: id(n),
    sequenceNumber: n,
    localDate,
    startTimeLocal: '14:00:00',
    timezone: CAIRO,
    startsAt,
    endsAt: new Date(addMinutes(startsAt, 60)),
    status,
    makeupFor: null,
    remedy: null,
    ...overrides,
  };
}

interface WorldOptions {
  readonly pages?: readonly EnrollmentPageItem[];
  readonly terms?: EnrollmentTerms | null;
  readonly sessions?: readonly MonitoredSessionRow[];
  readonly listSessions?: ReadonlyMap<string, readonly MonitoredSessionRow[]>;
  readonly counts?: ReadonlyMap<string, number>;
  readonly names?: ReadonlyMap<string, string>;
  readonly matches?: Readonly<Record<string, readonly string[]>>;
  readonly datesFound?: readonly string[];
  readonly enrollmentEvents?: readonly EnrollmentEventEntry[];
  readonly sessionEvents?: readonly SessionEventRow[];
  readonly requests?: readonly CancellationRequestRow[];
  readonly cases?: Awaited<ReturnType<SessionsMonitorStore['casesOf']>>;
  readonly disputed?: readonly string[];
}

function world(options: WorldOptions = {}) {
  const pages: { filter: EnrollmentPageFilter; cursor?: string; batchSize?: number }[] = [];
  const asked: string[] = [];
  const logged: { fields: Record<string, unknown>; message: string }[] = [];
  const all = options.pages ?? [];
  const enrollments: Pick<EnrollmentSide, 'enrollmentPage' | 'eventsOf' | 'enrollmentFor'> = {
    enrollmentPage: async (_tx, filter, cursor, batchSize): Promise<EnrollmentPage> => {
      pages.push({ filter, ...(cursor === undefined ? {} : { cursor }), ...(batchSize === undefined ? {} : { batchSize }) });
      const size = batchSize ?? SETTINGS['admin_list_page_size'] ?? 0;
      const matching = all.filter(
        (one) =>
          (filter.status === undefined || one.status === filter.status) &&
          (filter.enrollmentIds === undefined || filter.enrollmentIds.includes(one.enrollmentId)),
      );
      const start = cursor === undefined ? 0 : matching.findIndex((one) => one.enrollmentId === cursor) + 1;
      const rows = matching.slice(start, start + size + 1);
      const items = rows.slice(0, size);
      const last = items.at(-1);
      return rows.length > size && last !== undefined
        ? { items, nextCursor: last.enrollmentId }
        : { items };
    },
    eventsOf: async () => [...(options.enrollmentEvents ?? [])],
    enrollmentFor: async () =>
      options.terms === undefined
        ? {
            id: id(1),
            status: 'confirmed',
            slotId: SLOT,
            track: 'recitation',
            timezone: CAIRO,
            durationMinutes: 60,
            sessionCount: 8,
            studentUserId: STUDENT,
            teacherUserId: TEACHER,
          }
        : options.terms,
  };
  const store: SessionsMonitorStore = {
    enrollmentIdsWithSessionsBetween: async (_tx, range) => {
      asked.push(`dates ${range.from ?? '-'} ${range.to ?? '-'}`);
      return [...(options.datesFound ?? [])];
    },
    sessionsOfEnrollments: async (_tx, ids) => {
      asked.push(`sessions of ${ids.join(',')}`);
      return options.listSessions ?? new Map();
    },
    teacherNoShowCountsOf: async (_tx, ids) =>
      new Map(ids.map((one) => [one, options.counts?.get(one) ?? 0] as const)),
    namesOf: async (_tx, ids) =>
      new Map(
        ids.flatMap((one) => {
          const name = (options.names ?? new Map([[STUDENT, 'آمال'], [TEACHER, 'سارة']])).get(one);
          return name === undefined ? [] : [[one, name] as const];
        }),
      ),
    namePrefixMatches: async (_tx, candidates, typed) => {
      asked.push(`names ${typed} among ${[...candidates].sort().join(',')}`);
      return candidates.filter((one) => (options.matches?.[typed] ?? []).includes(one));
    },
    monitoredSessionsOf: async () => [...(options.sessions ?? [])],
    sessionEventsOf: async () => [...(options.sessionEvents ?? [])],
    cancellationRequestsOf: async () => [...(options.requests ?? [])],
    casesOf: async () => [...(options.cases ?? [])],
    sessionsEverDisputedAmong: async (_tx, ids) =>
      new Set(ids.filter((one) => (options.disputed ?? []).includes(one))),
    slotOf: async (_tx, slotId) => {
      asked.push(`slot ${slotId}`);
      return { startTimeLocal: '14:00:00' };
    },
  };
  const settings: SettingsReader = {
    read: async (key, schema) => {
      if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
      return schema.parse(SETTINGS[key]);
    },
  };
  const monitor = createSessionsMonitor({
    enrollments,
    settings,
    log: {
      info: (...args: unknown[]) => {
        logged.push({ fields: args[0] as Record<string, unknown>, message: args[1] as string });
      },
    } as unknown as Parameters<typeof createSessionsMonitor>[0]['log'],
    clock: async () => NOW,
    store,
  });
  return { monitor, pages, asked, logged };
}

describe('sessions.monitor.list (T024, FR-479, FR-451)', () => {
  it('reads one page, names the parties (a deleted one unnamed), and derives progress, the count, the mark and the next session', async () => {
    const sessions = new Map([
      [
        id(1),
        [
          session(1, '2026-11-03', 'done'),
          session(2, '2026-11-05', 'teacher_no_show'),
          session(3, '2026-11-17', 'scheduled'),
        ],
      ],
    ]);
    const { monitor, pages } = world({
      pages: [item(1), item(2, { status: 'cancelled' }), item(3)],
      listSessions: sessions,
      counts: new Map([
        [id(1), 5],
        [id(2), 4],
      ]),
      names: new Map([[STUDENT, 'آمال']]),
    });
    const answer = await monitor.list(tx, ADMIN, {});
    expect(pages).toEqual([{ filter: {}, batchSize: 2 }]);
    expect(answer.nextCursor).toBe(id(2));
    expect(answer.items).toEqual([
      {
        enrollmentId: id(1),
        student: { userId: STUDENT, displayName: 'آمال', deleted: false },
        teacher: { userId: TEACHER, displayName: null, deleted: true },
        status: 'confirmed',
        track: 'recitation',
        sessionCount: 8,
        completed: 1,
        remaining: 7,
        teacherNoShows: 5,
        repeatedAbsence: true,
        nextSession: {
          sessionId: id(3),
          localDate: '2026-11-17',
          startTimeLocal: '14:00',
          timezone: CAIRO,
          startsAt: '2026-11-17T12:00:00.000Z',
        },
      },
      {
        enrollmentId: id(2),
        student: { userId: STUDENT, displayName: 'آمال', deleted: false },
        teacher: { userId: TEACHER, displayName: null, deleted: true },
        status: 'cancelled',
        track: 'recitation',
        sessionCount: 8,
        completed: 0,
        remaining: 8,
        teacherNoShows: 4,
        repeatedAbsence: false,
      },
    ]);
  });

  it('passes the status and the cursor on, and turns the dates into enrollment ids from sessions’ own table', async () => {
    const { monitor, pages, asked } = world({ pages: [item(3), item(2), item(1)], datesFound: [id(1), id(3)] });
    const answer = await monitor.list(tx, ADMIN, {
      status: 'confirmed',
      from: '2026-11-01',
      to: '2026-11-30',
      cursor: id(3),
    });
    expect(asked[0]).toBe('dates 2026-11-01 2026-11-30');
    expect(pages).toEqual([
      { filter: { status: 'confirmed', enrollmentIds: [id(1), id(3)] }, cursor: id(3), batchSize: 2 },
    ]);
    expect(answer.items.map(({ enrollmentId }) => enrollmentId)).toEqual([id(1)]);
    expect(answer.nextCursor).toBeUndefined();
  });

  it('a date range with no session matches no enrollment', async () => {
    const { monitor, pages } = world({ pages: [item(1)], datesFound: [] });
    expect((await monitor.list(tx, ADMIN, { from: '2026-12-01' })).items).toEqual([]);
    expect(pages[0]?.filter).toEqual({ enrollmentIds: [] });
  });

  it('searches names in batches, each twice the one before, until one more match than the page, and cuts the cursor at the last shown', async () => {
    const students = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => id(100 + n));
    const all = students.map((student, n) => item(n + 1, { studentUserId: student }));
    // The matches: the 4th, 8th and 9th enrollments' students.
    const { monitor, pages } = world({
      pages: all,
      matches: { آم: [students[3], students[7], students[8]].filter((one) => one !== undefined) },
    });
    const answer = await monitor.list(tx, ADMIN, { student: 'آم' });
    expect(pages.map(({ batchSize, cursor }) => [batchSize, cursor])).toEqual([
      [3, undefined],
      [6, id(3)],
    ]);
    expect(answer.items.map(({ enrollmentId }) => enrollmentId)).toEqual([id(4), id(8)]);
    expect(answer.nextCursor).toBe(id(8));
  });

  it('writes no cursor when the rows end with the page not overfull, a short batch ending the scan', async () => {
    const students = [1, 2, 3, 4].map((n) => id(100 + n));
    const all = students.map((student, n) => item(n + 1, { studentUserId: student }));
    const { monitor, pages } = world({ pages: all, matches: { هـ: [students[1] ?? ''] } });
    const answer = await monitor.list(tx, ADMIN, { student: 'هـ' });
    expect(pages.map(({ batchSize }) => batchSize)).toEqual([3, 6]);
    expect(answer.items.map(({ enrollmentId }) => enrollmentId)).toEqual([id(2)]);
    expect(answer.nextCursor).toBeUndefined();
  });

  it('a student and a teacher searched together must both match, each over the batch’s own parties', async () => {
    const other = id(800);
    const { monitor, asked } = world({
      pages: [item(1), item(2, { teacherUserId: other })],
      matches: { آ: [STUDENT], س: [TEACHER] },
    });
    const answer = await monitor.list(tx, ADMIN, { student: 'آ', teacher: 'س' });
    expect(answer.items.map(({ enrollmentId }) => enrollmentId)).toEqual([id(1)]);
    expect(asked).toContain(`names آ among ${STUDENT}`);
    expect(asked).toContain(`names س among ${[TEACHER, other].sort().join(',')}`);
  });
});

describe('sessions.monitor.get (T024, FR-479; R-323 GAP-1, GAP-4; FR-439; FR-454)', () => {
  const remedied = session(3, '2026-11-08', 'teacher_no_show', {
    remedy: {
      id: id(31),
      kind: 'makeup',
      status: 'counter_proposed',
      offeredAt: new Date('2026-11-08T20:00:00Z'),
      choiceClosesAt: new Date('2026-11-15T20:00:00Z'),
      proposedDate: '2026-11-29',
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
      counter: {
        date: '2026-11-26',
        startTimeLocal: '18:00:00',
        timezone: CAIRO,
        proposedAt: new Date('2026-11-10T09:00:00Z'),
      },
      caseId: null,
      decidedAt: null,
    },
  });
  const retried = session(4, '2026-10-25', 'both_no_show', {
    remedy: {
      id: id(41),
      kind: 'makeup',
      status: 'proposed',
      offeredAt: new Date('2026-11-02T00:00:00Z'),
      choiceClosesAt: new Date('2026-11-09T00:00:00Z'),
      proposedDate: '2026-11-15',
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
      counter: null,
      caseId: null,
      decidedAt: null,
    },
  });
  const handed = session(5, '2026-10-18', 'teacher_no_show', {
    remedy: {
      id: id(51),
      kind: 'refund',
      status: 'refund_case',
      offeredAt: new Date('2026-10-22T00:00:00Z'),
      choiceClosesAt: new Date('2026-10-29T00:00:00Z'),
      proposedDate: null,
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
      counter: null,
      caseId: id(61),
      decidedAt: new Date('2026-10-23T00:00:00Z'),
    },
  });
  const sessions = [
    session(1, '2026-11-03', 'done'),
    session(2, '2026-11-09', 'done'),
    remedied,
    retried,
    handed,
    session(6, '2026-11-09', 'disputed', { outcomeUnderDispute: 'done' }),
    session(7, '2026-11-09', 'student_no_show'),
    session(8, '2026-11-17', 'scheduled'),
    session(9, '2026-11-24', 'scheduled', { makeupFor: { sessionId: id(3), sequenceNumber: 3 } }),
  ];

  it('answers the sessions with cancellable, correctable, the make-up’s original and each remedy’s derived deadlines', async () => {
    const { monitor, asked } = world({ pages: [item(1)], sessions, disputed: [id(6), id(7)] });
    const answer = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
    expect(asked).toContain(`slot ${SLOT}`);
    const byNumber = new Map(answer.sessions.map((one) => [one.sequenceNumber, one]));
    // Session 1's window closed on 11-06; session 2's is open; 3 to 5 have remedies; 6 is disputed;
    // 7 was disputed once and resolved; 8 and 9 are scheduled.
    expect([...byNumber.values()].map(({ cancellable, correctable }) => [cancellable, correctable])).toEqual([
      [false, false],
      [false, true],
      [false, false],
      [false, false],
      [false, false],
      [false, false],
      [false, false],
      [true, false],
      [true, false],
    ]);
    expect(byNumber.get(6)?.outcomeUnderDispute).toBe('done');
    expect(byNumber.get(9)?.makeupFor).toEqual({ sessionId: id(3), sequenceNumber: 3 });
    expect(byNumber.get(1)).not.toHaveProperty('remedy');
    expect(byNumber.get(3)?.remedy).toEqual({
      remedyId: id(31),
      kind: 'makeup',
      status: 'counter_proposed',
      offeredAt: '2026-11-08T20:00:00.000Z',
      choiceClosesAt: '2026-11-15T20:00:00.000Z',
      // The enrollment's slot's start, 14:00, on the proposal's date, in the enrollment's zone.
      proposal: {
        localDate: '2026-11-29',
        startTimeLocal: '14:00',
        timezone: CAIRO,
        startsAt: '2026-11-29T12:00:00.000Z',
      },
      counter: {
        localDate: '2026-11-26',
        startTimeLocal: '18:00',
        timezone: CAIRO,
        startsAt: '2026-11-26T16:00:00.000Z',
        proposedAt: '2026-11-10T09:00:00.000Z',
        answerClosesAt: '2026-11-13T09:00:00.000Z',
      },
    });
    expect(byNumber.get(4)?.remedy).toMatchObject({
      status: 'proposed',
      bookingRetriedUntil: '2026-11-14T12:00:00.000Z',
    });
    expect(byNumber.get(5)?.remedy).toEqual({
      remedyId: id(51),
      kind: 'refund',
      status: 'refund_case',
      offeredAt: '2026-10-22T00:00:00.000Z',
      choiceClosesAt: '2026-10-29T00:00:00.000Z',
      caseId: id(61),
      decidedAt: '2026-10-23T00:00:00.000Z',
    });
  });

  it('answers the enrollment with its parties, progress, count and mark, its cases and its requests', async () => {
    const { monitor } = world({
      pages: [item(1)],
      sessions,
      counts: new Map([[id(1), 2]]),
      cases: [
        { caseId: id(61), reason: 'refund_choice', status: 'open', createdAt: new Date('2026-10-23T00:00:00Z') },
      ],
      requests: [
        {
          id: id(71),
          sessionId: id(8),
          requestedBy: 'teacher',
          reason: 'سفر',
          status: 'pending',
          createdAt: new Date('2026-11-10T08:00:00Z'),
          respondedAt: null,
        },
        {
          id: id(70),
          sessionId: id(2),
          requestedBy: 'student',
          reason: 'مرض',
          status: 'declined',
          createdAt: new Date('2026-11-08T08:00:00Z'),
          respondedAt: new Date('2026-11-08T09:00:00Z'),
        },
      ],
    });
    const answer = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
    expect(answer.enrollment).toEqual({
      enrollmentId: id(1),
      student: { userId: STUDENT, displayName: 'آمال', deleted: false },
      teacher: { userId: TEACHER, displayName: 'سارة', deleted: false },
      status: 'confirmed',
      track: 'recitation',
      sessionCount: 8,
      completed: 4,
      remaining: 4,
      teacherNoShows: 2,
      repeatedAbsence: false,
    });
    expect(answer.cases).toEqual([{ caseId: id(61), reason: 'refund_choice', status: 'open' }]);
    expect(answer.cancellationRequests).toEqual([
      {
        requestId: id(71),
        sessionId: id(8),
        requestedBy: 'teacher',
        reason: 'سفر',
        status: 'pending',
        createdAt: '2026-11-10T08:00:00.000Z',
      },
      {
        requestId: id(70),
        sessionId: id(2),
        requestedBy: 'student',
        reason: 'مرض',
        status: 'declined',
        createdAt: '2026-11-08T08:00:00.000Z',
        respondedAt: '2026-11-08T09:00:00.000Z',
      },
    ]);
  });

  it('answers the timeline newest first from both sources, with the columns each kind sets, the session rows first at one instant', async () => {
    const at = (iso: string) => new Date(iso);
    const { monitor } = world({
      pages: [item(1)],
      sessions,
      enrollmentEvents: [
        { kind: 'confirmed', occurredAt: at('2026-11-01T10:00:00Z') },
        { kind: 'cancelled', cancellationReason: 'admin', occurredAt: at('2026-11-09T10:00:00Z') },
        { kind: 'restored', occurredAt: at('2026-11-09T12:00:00Z') },
      ],
      sessionEvents: [
        {
          sessionId: id(2),
          kind: 'outcome_corrected',
          caseId: null,
          outcomeBefore: 'student_no_show',
          outcomeAfter: 'done',
          previousStartAt: null,
          occurredAt: at('2026-11-10T08:00:00Z'),
        },
        {
          sessionId: id(8),
          kind: 'cancelled_by_admin',
          caseId: id(62),
          outcomeBefore: null,
          outcomeAfter: null,
          previousStartAt: null,
          occurredAt: at('2026-11-09T10:00:00Z'),
        },
        {
          sessionId: id(1),
          kind: 'instants_reresolved',
          caseId: null,
          outcomeBefore: null,
          outcomeAfter: null,
          previousStartAt: at('2026-11-03T11:00:00Z'),
          occurredAt: at('2026-11-01T10:00:00Z'),
        },
      ],
    });
    const { events } = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
    expect(events).toEqual([
      {
        source: 'session',
        kind: 'outcome_corrected',
        sessionId: id(2),
        outcomeBefore: 'student_no_show',
        outcomeAfter: 'done',
        occurredAt: '2026-11-10T08:00:00.000Z',
      },
      { source: 'enrollment', kind: 'restored', occurredAt: '2026-11-09T12:00:00.000Z' },
      {
        source: 'session',
        kind: 'cancelled_by_admin',
        sessionId: id(8),
        caseId: id(62),
        occurredAt: '2026-11-09T10:00:00.000Z',
      },
      {
        source: 'enrollment',
        kind: 'cancelled',
        cancellationReason: 'admin',
        occurredAt: '2026-11-09T10:00:00.000Z',
      },
      {
        source: 'session',
        kind: 'instants_reresolved',
        sessionId: id(1),
        previousStartAt: '2026-11-03T11:00:00.000Z',
        occurredAt: '2026-11-01T10:00:00.000Z',
      },
      { source: 'enrollment', kind: 'confirmed', occurredAt: '2026-11-01T10:00:00.000Z' },
    ]);
  });

  it('T069: a slot_released and a slot_hold_ended row reach the timeline, and the output schema admits them', async () => {
    const { monitor } = world({
      pages: [item(1)],
      sessions,
      enrollmentEvents: [
        { kind: 'slot_released', occurredAt: new Date('2026-11-09T12:00:00Z') },
        { kind: 'slot_hold_ended', occurredAt: new Date('2026-11-10T12:00:00Z') },
      ],
    });
    const answer = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
    expect(answer.events).toEqual([
      { source: 'enrollment', kind: 'slot_hold_ended', occurredAt: '2026-11-10T12:00:00.000Z' },
      { source: 'enrollment', kind: 'slot_released', occurredAt: '2026-11-09T12:00:00.000Z' },
    ]);
    expect(sessionsMonitorGetOutput.shape.events.safeParse(answer.events).success).toBe(true);
  });

  describe('restorableUntil (FR-454, R-322)', () => {
    const opened = new Date('2026-11-06T09:00:00Z');

    it('is the open absence_termination case’s opening plus the window for a terminated_no_show enrollment', async () => {
      const { monitor } = world({
        pages: [item(1, { status: 'terminated_no_show' })],
        cases: [
          { caseId: id(60), reason: 'absence_termination', status: 'open', createdAt: opened },
        ],
      });
      const { enrollment } = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
      expect(enrollment.restorableUntil).toBe('2026-11-13T09:00:00.000Z');
    });

    it('is the open student_fault_confirmed case’s for an enrollment cancelled admin, read from its last cancellation', async () => {
      const { monitor } = world({
        pages: [item(1, { status: 'cancelled' })],
        enrollmentEvents: [
          { kind: 'cancelled', cancellationReason: 'admin', occurredAt: new Date('2026-11-06T09:00:00Z') },
        ],
        cases: [
          { caseId: id(60), reason: 'student_fault_confirmed', status: 'open', createdAt: opened },
        ],
      });
      const { enrollment } = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
      expect(enrollment.restorableUntil).toBe('2026-11-13T09:00:00.000Z');
    });

    it.each<[string, Partial<WorldOptions>]>([
      [
        'its case closed',
        {
          pages: [item(1, { status: 'terminated_no_show' })],
          cases: [
            { caseId: id(60), reason: 'absence_termination', status: 'dismissed', createdAt: opened },
          ],
        },
      ],
      [
        'a cancellation of another reason',
        {
          pages: [item(1, { status: 'cancelled' })],
          enrollmentEvents: [
            { kind: 'cancelled', cancellationReason: 'teacher_suspended', occurredAt: opened },
          ],
          cases: [
            { caseId: id(60), reason: 'student_fault_confirmed', status: 'open', createdAt: opened },
          ],
        },
      ],
      [
        'a confirmed enrollment',
        {
          pages: [item(1)],
          cases: [
            { caseId: id(60), reason: 'absence_termination', status: 'open', createdAt: opened },
          ],
        },
      ],
    ])('is absent for %s', async (_name, options) => {
      const { monitor } = world(options);
      const { enrollment } = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
      expect(enrollment).not.toHaveProperty('restorableUntil');
    });
  });

  describe('slotHeldUntil and slotReleasedAt (T070; FR-503)', () => {
    const opened = new Date('2026-11-06T09:00:00Z');
    const cancelled = (reason: 'admin' | 'teacher_suspended' | 'account_deleted') => ({
      kind: 'cancelled' as const,
      cancellationReason: reason,
      occurredAt: opened,
    });
    const open = (reason: string) => ({
      caseId: id(60),
      reason,
      status: 'open' as const,
      createdAt: opened,
    });

    it.each<[string, Partial<WorldOptions>, string]>([
      [
        'a complaint’s, the enrollment window',
        { pages: [item(1, { status: 'terminated_no_show' })], cases: [open('absence_termination')] },
        '2026-11-13T09:00:00.000Z',
      ],
      [
        'a fault’s, the enrollment window',
        {
          pages: [item(1, { status: 'cancelled' })],
          enrollmentEvents: [cancelled('admin')],
          cases: [open('student_fault_confirmed')],
        },
        '2026-11-13T09:00:00.000Z',
      ],
      [
        'a ban’s, the ban window',
        {
          pages: [item(1, { status: 'cancelled' })],
          enrollmentEvents: [cancelled('admin')],
          cases: [open('student_banned')],
        },
        '2026-11-09T09:00:00.000Z',
      ],
      [
        'a teacher’s ban or revocation, the ban window',
        {
          pages: [item(1, { status: 'cancelled' })],
          enrollmentEvents: [cancelled('teacher_suspended')],
          cases: [open('teacher_ended')],
        },
        '2026-11-09T09:00:00.000Z',
      ],
    ])('answers the hold’s end for %s', async (_name, options, until) => {
      const { monitor } = world(options);
      const answer = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
      expect(answer.enrollment.slotHeldUntil).toBe(until);
      expect(answer.enrollment).not.toHaveProperty('slotReleasedAt');
      expect(sessionsMonitorGetOutput.safeParse(answer).success).toBe(true);
    });

    it('answers the release’s instant, and no hold, once an administrator released the slot', async () => {
      const { monitor } = world({
        pages: [item(1, { status: 'cancelled' })],
        enrollmentEvents: [
          cancelled('admin'),
          { kind: 'slot_released', occurredAt: new Date('2026-11-08T10:00:00Z') },
        ],
        cases: [open('student_banned')],
      });
      const { enrollment } = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
      expect(enrollment.slotReleasedAt).toBe('2026-11-08T10:00:00.000Z');
      expect(enrollment).not.toHaveProperty('slotHeldUntil');
    });

    it.each<[string, Partial<WorldOptions>]>([
      [
        'a deletion’s closing',
        {
          pages: [item(1, { status: 'cancelled' })],
          enrollmentEvents: [cancelled('account_deleted')],
          cases: [open('teacher_ended')],
        },
      ],
      [
        'a closing whose case is closed',
        {
          pages: [item(1, { status: 'cancelled' })],
          enrollmentEvents: [cancelled('admin')],
          cases: [{ ...open('student_banned'), status: 'resolved' }],
        },
      ],
      ['a confirmed enrollment', { pages: [item(1)], cases: [open('student_banned')] }],
    ])('answers neither for %s', async (_name, options) => {
      const { monitor } = world(options);
      const { enrollment } = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
      expect(enrollment).not.toHaveProperty('slotHeldUntil');
      expect(enrollment).not.toHaveProperty('slotReleasedAt');
    });

  });

  describe('restorableUntil read as step 1 reads the closing (T073; Q4 (a))', () => {
    const opened = new Date('2026-11-06T09:00:00Z');
    const cancelled = (
      reason: 'admin' | 'teacher_suspended' | 'account_deleted' | 'gender_correction',
    ) => ({ kind: 'cancelled' as const, cancellationReason: reason, occurredAt: opened });
    const open = (reason: string) => ({
      caseId: id(60),
      reason,
      status: 'open' as const,
      createdAt: opened,
    });

    it.each<[string, Partial<WorldOptions>]>([
      [
        'a ban’s closing (cancelled admin, its student_banned case open)',
        {
          pages: [item(1, { status: 'cancelled' })],
          enrollmentEvents: [cancelled('admin')],
          cases: [open('student_banned')],
        },
      ],
      [
        'a teacher’s ban’s or revocation’s teacher_ended closing (PR #138’s review, round 4, nit)',
        {
          pages: [item(1, { status: 'cancelled' })],
          enrollmentEvents: [cancelled('teacher_suspended')],
          cases: [open('teacher_ended')],
        },
      ],
    ])('answers the hold’s end for %s, as slotHeldUntil', async (_name, options) => {
      const { monitor } = world(options);
      const answer = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
      // `ban_restore_window_days` is 3 here: the hold's end.
      expect(answer.enrollment.restorableUntil).toBe('2026-11-09T09:00:00.000Z');
      expect(answer.enrollment.slotHeldUntil).toBe('2026-11-09T09:00:00.000Z');
      expect(sessionsMonitorGetOutput.safeParse(answer).success).toBe(true);
    });

    it('keeps the hold’s end in restorableUntil after a release, the restore still admitted', async () => {
      const { monitor } = world({
        pages: [item(1, { status: 'cancelled' })],
        enrollmentEvents: [
          cancelled('admin'),
          { kind: 'slot_released', occurredAt: new Date('2026-11-08T10:00:00Z') },
        ],
        cases: [open('student_banned')],
      });
      const { enrollment } = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
      expect(enrollment.restorableUntil).toBe('2026-11-09T09:00:00.000Z');
      expect(enrollment).not.toHaveProperty('slotHeldUntil');
    });

    it.each<[string, Partial<WorldOptions>]>([
      [
        'a deletion’s closing',
        {
          pages: [item(1, { status: 'cancelled' })],
          enrollmentEvents: [cancelled('account_deleted')],
          cases: [open('teacher_ended')],
        },
      ],
      [
        'a gender correction’s closing',
        {
          pages: [item(1, { status: 'cancelled' })],
          enrollmentEvents: [cancelled('gender_correction')],
          cases: [open('student_banned')],
        },
      ],
      [
        'a ban’s closing whose case is closed',
        {
          pages: [item(1, { status: 'cancelled' })],
          enrollmentEvents: [cancelled('admin')],
          cases: [{ ...open('student_banned'), status: 'dismissed' }],
        },
      ],
    ])('answers none for %s', async (_name, options) => {
      const { monitor } = world(options);
      const { enrollment } = await monitor.get(tx, ADMIN, { enrollmentId: id(1) });
      expect(enrollment).not.toHaveProperty('restorableUntil');
    });
  });

  it('refuses an enrollment no page answers NOT_FOUND, with one log line, reading nothing more', async () => {
    const { monitor, pages, asked, logged } = world({ pages: [] });
    const thrown: unknown = await monitor.get(tx, ADMIN, { enrollmentId: id(1) }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('NOT_FOUND');
    // Logged once, here (PR #130's review, round 1, Minor 4): no second line from `onError`.
    expect(isRefusalLogged(thrown)).toBe(true);
    expect(pages).toEqual([{ filter: { enrollmentIds: [id(1)] }, batchSize: 1 }]);
    expect(asked).toEqual([]);
    expect(logged).toEqual([
      {
        fields: { adminId: ADMIN, enrollmentId: id(1), errorCode: 'NOT_FOUND', reason: 'not_found' },
        message: 'An enrollment monitor read was refused',
      },
    ]);
  });
});
