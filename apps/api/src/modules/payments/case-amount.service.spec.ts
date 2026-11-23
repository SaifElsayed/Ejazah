// 003:T110: `payments.caseAmount`'s service (`case-amount.service.ts`): the case's enrollment and
// reason read through moderation's entry, the enrollment through booking's, its sessions through
// sessions' (a disputed one by its frozen outcome, a make-up by its original), the orders and the
// releases from payments' own; an unknown case refused. The amounts are `case-amount.rules.spec.ts`'s.
// The example: a 10,000 EGP recitation package of 10 sessions, the teacher's share at 70%.
import { piasters } from '@ijazah/money';
import { addDays } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { CaseRecord, EnrollmentCase } from '../moderation/index.js';
import type { EnrollmentSessionRow } from '../sessions/index.js';
import type { CaseOrder } from './case-amount.rules.js';
import { caseAmount, type CaseAmountReads } from './case-amount.service.js';
import type { ReleaseRow } from './share-release.repository.js';
import type { ReleaseEnrollment } from './share-release.rules.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const CASE = id(1);
const ENROLLMENT = id(2);
const TEACHER = id(3);
const STUDENT = id(4);
const ORDER = id(5);
const TX = { stand: 'in' } as unknown as Transaction;
const EGP = (pounds: number) => piasters(pounds * 100);

const record = (overrides: Partial<CaseRecord> = {}): CaseRecord => ({
  caseId: CASE,
  kind: 'compensation_case',
  enrollmentId: ENROLLMENT,
  reason: 'teacher_ended',
  status: 'open',
  resolution: null,
  resolutionNotes: null,
  createdAt: new Date('2026-10-20T10:00:00Z'),
  resolvedAt: null,
  ...overrides,
});

/** Session `n` ends on 2026-10-0n at 10:00 UTC, the next day for the next. */
const FIRST_END = new Date('2026-10-01T10:00:00Z');
const session = (n: number, status: string, outcomeUnderDispute?: string): EnrollmentSessionRow =>
  ({
    id: id(100 + n),
    sequenceNumber: n,
    endsAt: new Date(addDays(FIRST_END, n - 1)),
    status,
    ...(outcomeUnderDispute === undefined ? {} : { outcomeUnderDispute }),
  }) as unknown as EnrollmentSessionRow;

const enrollment = (track: ReleaseEnrollment['track'] = 'recitation'): ReleaseEnrollment => ({
  enrollmentId: ENROLLMENT,
  teacherUserId: TEACHER,
  studentUserId: STUDENT,
  track,
  status: 'cancelled',
  sessionCount: 10,
  cancellationReason: null,
  programme: null,
});

interface Fake {
  readonly reads: CaseAmountReads;
  readonly asked: unknown[][];
}

function fake({
  found = record(),
  track = 'recitation',
  known = true,
  sessions = [
    session(1, 'done'),
    session(2, 'disputed', 'done'),
    session(3, 'teacher_no_show'),
    ...[4, 5, 6, 7, 8, 9, 10].map((n) => session(n, 'cancelled_by_admin')),
    session(11, 'done'),
  ],
  releases = [],
  orders = [
    {
      paymentId: ORDER,
      kind: 'package',
      instalmentMonth: null,
      paid_piasters: EGP(10_000),
      share_piasters: EGP(7_000),
      refunded_piasters: EGP(0),
    },
  ],
  cases = [],
  records = [],
}: {
  readonly found?: CaseRecord | null;
  readonly track?: ReleaseEnrollment['track'];
  readonly known?: boolean;
  readonly sessions?: readonly EnrollmentSessionRow[];
  readonly releases?: readonly ReleaseRow[];
  readonly orders?: readonly CaseOrder[];
  /** 006:T012: the enrollment's compensation cases, moderation's. */
  readonly cases?: readonly EnrollmentCase[];
  /** 006:T012: further cases `caseRecordOf` answers by id. */
  readonly records?: readonly CaseRecord[];
} = {}): Fake {
  const asked: unknown[][] = [];
  return {
    asked,
    reads: {
      caseRecordOf: async (tx, caseId) => {
        asked.push(['case', tx, caseId]);
        return caseId === CASE ? found : (records.find((one) => one.caseId === caseId) ?? null);
      },
      caseOrdersOf: async (tx, enrollmentId) => {
        asked.push(['orders', tx, enrollmentId]);
        return orders;
      },
      casesAmong: async (tx, ids) => {
        asked.push(['cases', tx, ids]);
        return new Map([[ENROLLMENT, cases]]);
      },
      releasesOf: async (tx, ids) => {
        asked.push(['releases', tx, ids]);
        return releases;
      },
      enrollmentsAmong: async (tx, ids) => {
        asked.push(['enrollments', tx, ids]);
        return new Map(known ? [[ENROLLMENT, enrollment(track)]] : []);
      },
      sessionsAmong: async (tx, ids) => {
        asked.push(['sessions', tx, ids]);
        return new Map([[ENROLLMENT, sessions]]);
      },
      // Session 11 makes up session 3, the teacher's absence.
      makeupsAmong: async (tx, ids) => {
        asked.push(['makeups', tx, ids]);
        return new Map([[id(111), id(103)]]);
      },
    },
  };
}

describe('payments.caseAmount’s service', () => {
  it('reads every owner for the case’s enrollment on the call’s transaction, a disputed session by its frozen outcome and a make-up by its original', async () => {
    const { reads, asked } = fake();
    // Sessions 1, 2 (disputed, frozen done) and 11 (making up 3) taken: 3 × 1,000 and 3 × 700.
    expect(await caseAmount(TX, CASE, reads)).toEqual({
      amount: {
        cause: 'recitation_dropout',
        refund_piasters: EGP(7_000),
        release_piasters: EGP(2_100),
        refunded_piasters: EGP(0),
      },
    });
    expect(asked).toEqual(
      expect.arrayContaining([
        ['case', TX, CASE],
        ['orders', TX, ENROLLMENT],
        ['releases', TX, [ENROLLMENT]],
        ['enrollments', TX, [ENROLLMENT]],
        ['sessions', TX, [ENROLLMENT]],
        ['makeups', TX, [ENROLLMENT]],
      ]),
    );
  });

  it('counts as released on an ijazah dropout only the releases marked done', async () => {
    const release = (milestone: ReleaseRow['milestone'], markedAt: Date | null): ReleaseRow => ({
      id: id(200),
      enrollmentId: ENROLLMENT,
      teacherUserId: TEACHER,
      milestone,
      amount_piasters: EGP(1_750),
      dueAt: new Date('2026-10-10T10:00:00Z'),
      markedAt,
    });
    const { reads } = fake({
      track: 'ijazah_track',
      releases: [release('ijazah_half', new Date('2026-10-12T10:00:00Z'))],
    });
    expect(await caseAmount(TX, CASE, reads)).toEqual({
      amount: {
        cause: 'ijazah_dropout',
        total_piasters: EGP(10_000),
        held_piasters: EGP(5_250),
        platformPart_piasters: EGP(3_000),
        released_piasters: EGP(1_750),
        refunded_piasters: EGP(0),
      },
    });
    const due = fake({ track: 'ijazah_track', releases: [release('ijazah_half', null)] });
    expect(await caseAmount(TX, CASE, due.reads)).toMatchObject({
      amount: { held_piasters: EGP(7_000), released_piasters: EGP(0) },
    });
  });

  it('refuses an unknown case as NOT_FOUND, reading nothing more', async () => {
    const { reads, asked } = fake({ found: null });
    const thrown = await caseAmount(TX, CASE, reads).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('NOT_FOUND');
    expect(asked).toEqual([['case', TX, CASE]]);
  });

  it('answers no amount for a reason outside the map, reading nothing more', async () => {
    // 003:T125 (rule d): `gender_correction` now gives an amount; a reason that never does here.
    const { reads, asked } = fake({ found: record({ reason: 'makeup_refused' }) });
    expect(await caseAmount(TX, CASE, reads)).toEqual({});
    expect(asked).toEqual([['case', TX, CASE]]);
  });

  // 003:T125 (SRS DEC-104, DEC-96): a student's deletion by an administrator opens its own case,
  // `account_deleted`, read past the map as an end by the administration. Run red first.
  it('reads an `account_deleted` case as an end by the administration: 3 taken, refund 7,000 EGP, release 2,100 EGP', async () => {
    const { reads } = fake({ found: record({ reason: 'account_deleted' }) });
    expect(await caseAmount(TX, CASE, reads)).toEqual({
      amount: {
        cause: 'direct_end',
        refund_piasters: EGP(7_000),
        release_piasters: EGP(2_100),
        refunded_piasters: EGP(0),
      },
    });
  });

  it('answers no amount for an enrollment no read returns', async () => {
    expect(await caseAmount(TX, CASE, fake({ known: false }).reads)).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------
// 006:T012 (R-512, FR-729): a programme's case. The example: an offer of 40 × 250 EGP, the fee 500,
// the share 70 %; months 1 and 2 paid (1,000 EGP each), or the rest in full (9,500 EGP).

const programmeOrder = (
  n: number,
  kind: CaseOrder['kind'],
  paid: number,
  share: number,
  instalmentMonth: number | null = null,
): CaseOrder => ({
  paymentId: id(600 + n),
  kind,
  instalmentMonth,
  paid_piasters: piasters(paid),
  share_piasters: piasters(share),
  refunded_piasters: piasters(0),
});
const ASSESSMENT = programmeOrder(0, 'assessment', 50_000, 35_000);
const REST_IN_FULL = programmeOrder(1, 'rest_in_full', 950_000, 665_000);
const SUSPENSION_CASE = id(20);

/** Session `n`, its month when it is an offer session (k + 1 in month ⌈k ÷ 4⌉ for the first 8). */
const programmeSession = (n: number, status: string): EnrollmentSessionRow =>
  ({
    ...session(n, status),
    ...(n === 1 ? {} : { programmeMonth: n <= 5 ? 1 : 2 }),
  }) as unknown as EnrollmentSessionRow;

describe('payments.caseAmount’s service on a programme (006:T012)', () => {
  it('hands the rules each session’s programme month: by months, refund 3 × 250 EGP and release 350 + 5 × 175 EGP', async () => {
    const { reads } = fake({
      found: record({ reason: 'student_complaint_ended' }),
      track: 'ijazah_track',
      orders: [
        ASSESSMENT,
        programmeOrder(2, 'instalment', 100_000, 70_000, 1),
        programmeOrder(3, 'instalment', 100_000, 70_000, 2),
      ],
      sessions: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
        programmeSession(n, n <= 6 ? 'done' : 'cancelled_by_admin'),
      ),
    });
    expect(await caseAmount(TX, CASE, reads)).toEqual({
      amount: {
        cause: 'student_complaint_close',
        refund_piasters: piasters(75_000),
        release_piasters: piasters(122_500),
        refunded_piasters: piasters(0),
      },
    });
  });

  const suspended = (notes: string, reason = 'teacher_suspended') =>
    fake({
      found: record({ reason: 'admin_ended' }),
      track: 'ijazah_track',
      orders: [ASSESSMENT, REST_IN_FULL],
      cases: [
        { caseId: CASE, reason: 'admin_ended', status: 'open', createdAt: new Date('2026-10-20') },
        {
          caseId: SUSPENSION_CASE,
          reason,
          status: 'resolved',
          createdAt: new Date('2026-10-10'),
        },
      ],
      records: [
        record({
          caseId: SUSPENSION_CASE,
          reason,
          status: 'resolved',
          resolution: 'compensation_ordered',
          resolutionNotes: notes,
        }),
      ],
    });

  it('an administrator’s end that covered the programme’s teacher_suspended case shows the whole of every order (DEC-85)', async () => {
    const { reads, asked } = suspended('ended_meanwhile');
    expect(await caseAmount(TX, CASE, reads)).toEqual({
      amount: {
        cause: 'ijazah_dropout',
        total_piasters: piasters(1_000_000),
        held_piasters: piasters(700_000),
        platformPart_piasters: piasters(300_000),
        released_piasters: piasters(0),
        refunded_piasters: piasters(0),
      },
    });
    expect(asked).toEqual(
      expect.arrayContaining([
        ['cases', TX, [ENROLLMENT]],
        ['case', TX, SUSPENSION_CASE],
      ]),
    );
  });

  // 003:T125 (SRS DEC-104; an approved rewrite of T012's placeholders): outside the dropout set, the
  // end is the student's stop.
  it('an administrator’s end after the teacher’s reinstatement closed the suspension is the student’s stop (T125)', async () => {
    expect(await caseAmount(TX, CASE, suspended('reinstated').reads)).toMatchObject({
      amount: { cause: 'direct_end' },
    });
  });

  it('an administrator’s direct end of a programme never suspended is the student’s stop (T125)', async () => {
    const { reads } = fake({
      found: record({ reason: 'admin_ended' }),
      track: 'ijazah_track',
      orders: [ASSESSMENT, REST_IN_FULL],
    });
    expect(await caseAmount(TX, CASE, reads)).toMatchObject({ amount: { cause: 'direct_end' } });
  });
});
