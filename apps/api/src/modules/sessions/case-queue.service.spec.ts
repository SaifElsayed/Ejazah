// T035 of specs/004-sessions/tasks.md (FR-478, FR-451, FR-452; R-MONEY-6; research R-312, R-313;
// contracts/admin-surface.md, `cases.list` and `cases.get`) — `createCaseQueue` over a recorded store
// and a recorded `EnrollmentSide`:
//
//   - the list reads moderation's queue page (the open `student_suspended` cases first, then the rest
//     by their opening: moderation's order, passed through), its cursor written and read back as
//     `first:<id>` or `rest:<id>`, each row with its enrollment's Teacher-No-Show count and its mark at
//     `repeated_absence_flag_count`, a complaint with no reason;
//   - the detail: no such case, or a session dispute, refused NOT_FOUND through the file's one
//     `refusal`, one log line; the enrollment and its parties (a deleted one unnamed); a complaint's
//     text, raising and decision (read from its closing); every part of `covers` (the remedies the
//     case holds, the sessions whose `cancelled_by_admin` event names it, and for the case an
//     enrollment's end opened the sessions owed a remedy never offered and the sessions a suspension
//     case open at the end and later resolved cancelled; for a confirmed fault, the make-ups the
//     dismissed suspension case cancelled, not an earlier one's), each session once, by sequence
//     number; the payments link and no amount.
//
// Over the real tables: `tests/db-integrity/case-queue.spec.ts`.
import { casesGetOutput, casesListOutput } from '@ijazah/contracts/admin';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { CaseQueueQuery, CaseRecord, SuspensionCase } from '../moderation/index.js';
import type { CoveredSessionRow } from './case-covers.repository.js';
import { type CaseQueueStore, createCaseQueue } from './case-queue.service.js';
import type { EnrollmentPageFilter, EnrollmentPageItem, EnrollmentSide } from './enrollment-side.port.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const STUDENT = id(901);
const TEACHER = id(902);
const ENROLLMENT = id(800);
const CASE = id(500);
const OPENED = new Date('2026-11-01T10:00:00Z');

const SETTINGS: Readonly<Record<string, number>> = {
  admin_list_page_size: 2,
  repeated_absence_flag_count: 5,
};
const settings: SettingsReader = {
  read: async (key, schema) => schema.parse(SETTINGS[key]),
};

function record(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    caseId: CASE,
    kind: 'compensation_case',
    enrollmentId: ENROLLMENT,
    reason: 'admin_cancellation',
    status: 'open',
    resolution: null,
    resolutionNotes: null,
    createdAt: OPENED,
    resolvedAt: null,
    ...overrides,
  };
}

function covered(n: number, overrides: Partial<CoveredSessionRow> = {}): CoveredSessionRow {
  return { sessionId: id(n), sequenceNumber: n, status: 'cancelled_by_admin', remedy: null, ...overrides };
}

interface World {
  readonly records?: Readonly<Record<string, CaseRecord>>;
  readonly suspensions?: readonly SuspensionCase[];
  readonly ofRemedies?: readonly CoveredSessionRow[];
  /** The sessions each case's `cancelled_by_admin` events name, by case id. */
  readonly cancelledBy?: Readonly<Record<string, readonly CoveredSessionRow[]>>;
  readonly owed?: readonly CoveredSessionRow[];
  readonly names?: ReadonlyMap<string, string>;
  readonly counts?: ReadonlyMap<string, number>;
  readonly enrollment?: EnrollmentPageItem | null;
}

function queueOver(world: World) {
  const reads: unknown[][] = [];
  const lines: unknown[] = [];
  const page = (query: CaseQueueQuery) => {
    reads.push(['caseQueuePage', query]);
    return Promise.resolve({
      rows: [
        {
          caseId: id(1),
          kind: 'compensation_case' as const,
          enrollmentId: ENROLLMENT,
          reason: 'student_suspended',
          status: 'open' as const,
          createdAt: OPENED,
          resolvedAt: null,
          first: true,
        },
        {
          caseId: id(2),
          kind: 'absence_complaint' as const,
          enrollmentId: id(801),
          reason: 'المعلم لم يحضر',
          status: 'resolved' as const,
          createdAt: OPENED,
          resolvedAt: new Date('2026-11-02T10:00:00Z'),
          first: false,
        },
      ],
      next: { first: false, caseId: id(2) },
    });
  };
  const store: CaseQueueStore = {
    caseQueuePage: (_tx, query) => page(query),
    caseRecordOf: async (_tx, caseId) => world.records?.[caseId] ?? null,
    suspensionCasesOf: async () => world.suspensions ?? [],
    teacherNoShowCountsOf: async (_tx, ids) => {
      reads.push(['counts', ids]);
      return world.counts ?? new Map();
    },
    namesOf: async () => world.names ?? new Map([[STUDENT, 'طالب'], [TEACHER, 'معلم']]),
    sessionsOfCaseRemedies: async (_tx, caseId) => {
      reads.push(['remedies', caseId]);
      return world.ofRemedies ?? [];
    },
    sessionsCancelledByCases: async (_tx, caseIds, options) => {
      reads.push(['cancelledBy', caseIds, options]);
      return caseIds.flatMap((caseId) =>
        (world.cancelledBy?.[caseId] ?? []).filter(
          (row) =>
            options.makeups === 'any' || (options.makeups === 'only') === row.sequenceNumber > 100,
        ),
      );
    },
    owedNeverOfferedOf: async (_tx, enrollmentId) => {
      reads.push(['owed', enrollmentId]);
      return world.owed ?? [];
    },
  };
  const enrollment: EnrollmentPageItem | null =
    world.enrollment === undefined
      ? {
          enrollmentId: ENROLLMENT,
          studentUserId: STUDENT,
          teacherUserId: TEACHER,
          status: 'confirmed',
          track: 'recitation',
          sessionCount: 8,
        }
      : world.enrollment;
  const enrollments: Pick<EnrollmentSide, 'enrollmentPage'> = {
    enrollmentPage: async (_tx, filter: EnrollmentPageFilter) => {
      reads.push(['enrollmentPage', filter]);
      return { items: enrollment === null ? [] : [enrollment] };
    },
  };
  const log = { info: (fields: unknown) => lines.push(fields) };
  return { queue: createCaseQueue({ enrollments, settings, log, store }), reads, lines };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown;
}

describe('cases.list (FR-478, FR-451)', () => {
  it('reads one page of admin_list_page_size in the queue’s order, each row with its count and mark', async () => {
    const { queue, reads } = queueOver({
      counts: new Map([
        [ENROLLMENT, 5],
        [id(801), 1],
      ]),
    });
    const answer = await queue.list(tx, ADMIN, { status: 'open' });
    expect(casesListOutput.parse(answer)).toEqual(answer);
    expect(answer).toEqual({
      items: [
        {
          caseId: id(1),
          kind: 'compensation_case',
          enrollmentId: ENROLLMENT,
          reason: 'student_suspended',
          status: 'open',
          openedAt: OPENED.toISOString(),
          teacherNoShows: 5,
          repeatedAbsence: true,
        },
        {
          caseId: id(2),
          kind: 'absence_complaint',
          enrollmentId: id(801),
          status: 'resolved',
          openedAt: OPENED.toISOString(),
          closedAt: '2026-11-02T10:00:00.000Z',
          teacherNoShows: 1,
          repeatedAbsence: false,
        },
      ],
      nextCursor: `rest:${id(2)}`,
    });
    expect(reads[0]).toEqual(['caseQueuePage', { status: 'open', limit: 2 }]);
    expect(reads[1]).toEqual(['counts', [ENROLLMENT, id(801)]]);
  });

  it.each([
    [`first:${id(7)}`, { first: true, caseId: id(7) }],
    [`rest:${id(7)}`, { first: false, caseId: id(7) }],
  ])('reads the cursor %s back as its position', async (cursor, after) => {
    const { queue, reads } = queueOver({});
    await queue.list(tx, ADMIN, { cursor });
    expect(reads[0]).toEqual(['caseQueuePage', { after, limit: 2 }]);
  });
});

describe('cases.get (FR-478; R-312, R-313)', () => {
  it.each([
    ['no such case', {}],
    ['a session dispute', { [CASE]: record({ kind: 'session_dispute' }) }],
  ])('refuses %s NOT_FOUND, logged once with ids only', async (_name, records) => {
    const { queue, lines } = queueOver({ records });
    const refusal = await refusalOf(queue.get(tx, ADMIN, { caseId: CASE }));
    expect(refusal.code).toBe('NOT_FOUND');
    expect(isRefusalLogged(refusal)).toBe(true);
    expect(lines).toEqual([
      { adminId: ADMIN, caseId: CASE, errorCode: 'NOT_FOUND', reason: 'not_found' },
    ]);
  });

  it('answers the case, its enrollment (a deleted party unnamed), its covers and the payments link', async () => {
    const { queue } = queueOver({
      records: {
        [CASE]: record({
          status: 'resolved',
          resolution: 'compensation_ordered',
          resolutionNotes: 'أُعيد المبلغ',
          resolvedAt: new Date('2026-11-03T10:00:00Z'),
        }),
      },
      names: new Map([[TEACHER, 'معلم']]),
      counts: new Map([[ENROLLMENT, 2]]),
      ofRemedies: [
        covered(3, {
          status: 'teacher_no_show',
          remedy: { remedyId: id(33), kind: 'refund', status: 'refund_case' },
        }),
      ],
      cancelledBy: { [CASE]: [covered(1)] },
    });
    const answer = await queue.get(tx, ADMIN, { caseId: CASE });
    expect(casesGetOutput.parse(answer)).toEqual(answer);
    expect(answer).toEqual({
      case: {
        caseId: CASE,
        kind: 'compensation_case',
        enrollmentId: ENROLLMENT,
        reason: 'admin_cancellation',
        status: 'resolved',
        openedAt: OPENED.toISOString(),
        closedAt: '2026-11-03T10:00:00.000Z',
        resolution: 'compensation_ordered',
        note: 'أُعيد المبلغ',
      },
      enrollment: {
        enrollmentId: ENROLLMENT,
        student: { userId: STUDENT, displayName: null, deleted: true },
        teacher: { userId: TEACHER, displayName: 'معلم', deleted: false },
        status: 'confirmed',
        track: 'recitation',
        teacherNoShows: 2,
        repeatedAbsence: false,
      },
      covers: [
        { sessionId: id(1), sequenceNumber: 1, status: 'cancelled_by_admin' },
        {
          sessionId: id(3),
          sequenceNumber: 3,
          status: 'teacher_no_show',
          remedy: { remedyId: id(33), kind: 'refund', status: 'refund_case' },
        },
      ],
      paymentsLink: { enrollmentId: ENROLLMENT },
    });
    expect(JSON.stringify(answer)).not.toMatch(/piasters|amount|price/i);
  });

  it.each([
    ['open', 'open', null, undefined],
    ['resolved, the enrollment ended', 'resolved', 'enrollment_ended', 'end_enrollment'],
    ['resolved, the teacher suspended', 'resolved', 'party_suspended', 'suspend_teacher'],
    ['dismissed', 'dismissed', null, 'close'],
  ] as const)(
    'a complaint %s: its text, raising and decision, and no reason on the case',
    async (_name, status, resolution, decision) => {
      const { queue } = queueOver({
        records: {
          [CASE]: record({
            kind: 'absence_complaint',
            reason: 'المعلم لم يحضر ثلاث مرات',
            status,
            resolution,
            ...(status === 'open'
              ? {}
              : { resolutionNotes: 'ملاحظة', resolvedAt: new Date('2026-11-03T10:00:00Z') }),
          }),
        },
      });
      const answer = await queue.get(tx, ADMIN, { caseId: CASE });
      expect(casesGetOutput.parse(answer)).toEqual(answer);
      expect(answer.case.kind).toBe('absence_complaint');
      expect(answer.case.reason).toBeUndefined();
      expect(answer.complaint).toEqual({
        reason: 'المعلم لم يحضر ثلاث مرات',
        raisedAt: OPENED.toISOString(),
        ...(decision === undefined ? {} : { decision }),
      });
    },
  );

  it.each(['absence_termination', 'teacher_ended', 'student_banned', 'student_fault_confirmed'])(
    'the case an enrollment’s end opened (%s) covers every session owed a remedy never offered (C1, I1)',
    async (reason) => {
      const { queue, reads } = queueOver({
        records: { [CASE]: record({ reason }) },
        owed: [
          covered(2, { status: 'teacher_no_show' }),
          covered(4, { status: 'cancelled_by_agreement' }),
        ],
      });
      const answer = await queue.get(tx, ADMIN, { caseId: CASE });
      expect(answer.covers.map(({ sessionId, status }) => [sessionId, status])).toEqual([
        [id(2), 'teacher_no_show'],
        [id(4), 'cancelled_by_agreement'],
      ]);
      expect(reads).toContainEqual(['owed', ENROLLMENT]);
    },
  );

  it.each(['admin_cancellation', 'student_suspended', 'refund_choice', 'party_restricted'])(
    'a %s case covers no session owed and never offered, and reads none',
    async (reason) => {
      const { queue, reads } = queueOver({
        records: { [CASE]: record({ reason }) },
        owed: [covered(2, { status: 'teacher_no_show' })],
      });
      expect((await queue.get(tx, ADMIN, { caseId: CASE })).covers).toEqual([]);
      expect(reads.some(([read]) => read === 'owed')).toBe(false);
    },
  );

  it('a confirmed fault covers the make-ups the dismissed suspension case cancelled, not an earlier one’s (U1)', async () => {
    const dismissedHere = id(510);
    const dismissedBefore = id(509);
    const { queue } = queueOver({
      records: { [CASE]: record({ reason: 'student_fault_confirmed' }) },
      suspensions: [
        {
          caseId: dismissedBefore,
          status: 'dismissed',
          createdAt: new Date('2026-10-01T10:00:00Z'),
          resolvedAt: new Date('2026-10-05T10:00:00Z'),
        },
        {
          caseId: dismissedHere,
          status: 'dismissed',
          createdAt: new Date('2026-10-20T10:00:00Z'),
          // The dismissal's own `clock_timestamp()`, after its transaction's `now()` that the new
          // case's `created_at` holds.
          resolvedAt: new Date('2026-11-01T10:00:00.005Z'),
        },
      ],
      cancelledBy: {
        [dismissedHere]: [covered(1), covered(105)],
        [dismissedBefore]: [covered(106)],
      },
    });
    const answer = await queue.get(tx, ADMIN, { caseId: CASE });
    expect(answer.covers.map(({ sessionId }) => sessionId)).toEqual([id(105)]);
  });

  it.each([
    ['dismissed', [id(1)]],
    ['resolved', [id(1), id(105)]],
    ['open', [id(1), id(105)]],
  ] as const)(
    'a suspension case %s covers what it cancelled, a dismissed one leaving out the make-ups (T036, (c))',
    async (status, expected) => {
      const { queue } = queueOver({
        records: { [CASE]: record({ reason: 'student_suspended', status }) },
        cancelledBy: { [CASE]: [covered(1), covered(105)] },
      });
      const answer = await queue.get(tx, ADMIN, { caseId: CASE });
      expect(answer.covers.map(({ sessionId }) => sessionId)).toEqual(expected);
    },
  );

  it('the case an enrollment’s end opened covers what a suspension case open at the end, later resolved, cancelled (U2)', async () => {
    const resolvedLater = id(511);
    const resolvedBefore = id(512);
    const stillOpen = id(513);
    const { queue } = queueOver({
      records: { [CASE]: record({ reason: 'student_banned' }) },
      suspensions: [
        {
          caseId: resolvedLater,
          status: 'resolved',
          createdAt: new Date('2026-10-20T10:00:00Z'),
          resolvedAt: new Date('2026-11-05T10:00:00Z'),
        },
        {
          caseId: resolvedBefore,
          status: 'resolved',
          createdAt: new Date('2026-09-20T10:00:00Z'),
          resolvedAt: new Date('2026-10-01T10:00:00Z'),
        },
        { caseId: stillOpen, status: 'open', createdAt: new Date('2026-10-25T10:00:00Z'), resolvedAt: null },
      ],
      cancelledBy: {
        [resolvedLater]: [covered(6), covered(7)],
        [resolvedBefore]: [covered(2)],
        [stillOpen]: [covered(9)],
      },
    });
    const answer = await queue.get(tx, ADMIN, { caseId: CASE });
    expect(answer.covers.map(({ sessionId }) => sessionId)).toEqual([id(6), id(7)]);
  });

  it('lists a session several parts name once, by sequence number', async () => {
    const { queue } = queueOver({
      records: { [CASE]: record({ reason: 'teacher_ended' }) },
      ofRemedies: [covered(5, { status: 'teacher_no_show' })],
      cancelledBy: { [CASE]: [covered(8), covered(3)] },
      owed: [covered(5, { status: 'teacher_no_show' }), covered(1, { status: 'both_no_show' })],
    });
    const answer = await queue.get(tx, ADMIN, { caseId: CASE });
    expect(answer.covers.map(({ sequenceNumber }) => sequenceNumber)).toEqual([1, 3, 5, 8]);
  });
});
