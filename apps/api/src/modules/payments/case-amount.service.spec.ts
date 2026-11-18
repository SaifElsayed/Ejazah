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
import type { CaseRecord } from '../moderation/index.js';
import type { EnrollmentSessionRow } from '../sessions/index.js';
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
}: {
  readonly found?: CaseRecord | null;
  readonly track?: ReleaseEnrollment['track'];
  readonly known?: boolean;
  readonly sessions?: readonly EnrollmentSessionRow[];
  readonly releases?: readonly ReleaseRow[];
} = {}): Fake {
  const asked: unknown[][] = [];
  return {
    asked,
    reads: {
      caseRecordOf: async (tx, caseId) => {
        asked.push(['case', tx, caseId]);
        return found;
      },
      caseOrdersOf: async (tx, enrollmentId) => {
        asked.push(['orders', tx, enrollmentId]);
        return [
          {
            paymentId: ORDER,
            paid_piasters: EGP(10_000),
            share_piasters: EGP(7_000),
            refunded_piasters: EGP(0),
          },
        ];
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
    const { reads, asked } = fake({ found: record({ reason: 'gender_correction' }) });
    expect(await caseAmount(TX, CASE, reads)).toEqual({});
    expect(asked).toEqual([['case', TX, CASE]]);
  });

  it('answers no amount for an enrollment no read returns', async () => {
    expect(await caseAmount(TX, CASE, fake({ known: false }).reads)).toEqual({});
  });
});
