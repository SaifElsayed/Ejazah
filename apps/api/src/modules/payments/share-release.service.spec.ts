// 003:T105: the due sweep of the releases of a teacher's share (`share-release.service.ts`), over an
// in-memory world whose insert behaves as `ON CONFLICT DO NOTHING` on (enrollment, milestone), as
// rule 62 makes the real one. The worked example: a 10,000 EGP recitation package of 10 sessions, the
// share at 70% (7,000 EGP, 700,000 piasters); the dispute window 72 hours. The race of two sweeps at
// once on the real table is `tests/db-integrity/share-release-race.spec.ts`.
import { piasters } from '@ijazah/money';
import { addDays } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import { runOnceAndTwice } from '../../jobs/double-run.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { EnrollmentSessionRow } from '../sessions/index.js';
import type { DueRelease, ReleaseRow, ShareOrderRow } from './share-release.repository.js';
import type { ReleaseEnrollment } from './share-release.rules.js';
import {
  createShareReleaseSweep,
  type ReleaseReads,
  releaseReads,
  releasesAmong,
} from './share-release.service.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TEACHER = id(900);
const NOW = new Date('2026-12-01T00:00:00Z');

const settings: SettingsReader = {
  read: async (key, schema) => schema.parse({ dispute_window_hours: 72 }[key]),
};

/** Ten sessions of an enrollment, every one delivered, the last ending on 2026-10-10. */
const sessionsOf = (enrollmentId: string): EnrollmentSessionRow[] =>
  Array.from({ length: 10 }, (_, index) => ({
    id: `${enrollmentId.slice(0, -3)}${String(index).padStart(3, '0')}`,
    sequenceNumber: index + 1,
    localDate: '2026-10-01',
    startTimeLocal: '10:00:00',
    timezone: 'Africa/Cairo',
    startsAt: new Date(addDays(new Date('2026-10-01T09:00:00Z'), index)),
    endsAt: new Date(addDays(new Date('2026-10-01T10:00:00Z'), index)),
    status: 'done',
  })) as unknown as EnrollmentSessionRow[];

interface World {
  readonly orders: ShareOrderRow[];
  readonly enrollments: Map<string, ReleaseEnrollment>;
  readonly rows: ReleaseRow[];
  readonly lines: unknown[][];
  readonly errors: unknown[][];
  readonly failOn?: string;
}

/** `count` completed recitation enrollments, each with one paid order of a 700,000 share. */
function world(count: number, failOn?: number): World {
  const orders: ShareOrderRow[] = [];
  const enrollments = new Map<string, ReleaseEnrollment>();
  for (let n = 1; n <= count; n += 1) {
    const enrollmentId = id(100 + n);
    orders.push({
      paymentId: id(200 + n),
      enrollmentId,
      kind: 'package',
      paid_piasters: piasters(1_000_000),
      share_piasters: piasters(700_000),
      sharePercent: 70,
      halfPercent: null,
      refunded_piasters: piasters(0),
    });
    enrollments.set(enrollmentId, {
      enrollmentId,
      teacherUserId: TEACHER,
      studentUserId: id(300 + n),
      track: 'recitation',
      status: 'completed',
      sessionCount: 10,
      cancellationReason: null,
      programme: null,
    });
  }
  return {
    orders,
    enrollments,
    rows: [],
    lines: [],
    errors: [],
    ...(failOn === undefined ? {} : { failOn: id(100 + failOn) }),
  };
}

/** The orders of `ids`, each enrollment's in id order, as payments' `shareOrdersOf` answers them. */
function ordersByEnrollment(
  orders: readonly ShareOrderRow[],
  ids: readonly string[],
): ReadonlyMap<string, readonly ShareOrderRow[]> {
  const byEnrollment = new Map<string, ShareOrderRow[]>();
  for (const order of orders.toSorted((a, b) => a.paymentId.localeCompare(b.paymentId))) {
    if (!ids.includes(order.enrollmentId)) continue;
    byEnrollment.set(order.enrollmentId, [...(byEnrollment.get(order.enrollmentId) ?? []), order]);
  }
  return byEnrollment;
}

function sweepOver(w: World, pageSize = 2) {
  const reads: ReleaseReads = {
    shareOrdersOf: async (_tx, ids) => ordersByEnrollment(w.orders, ids),
    releasesOf: async (_tx, ids) => w.rows.filter((row) => ids.includes(row.enrollmentId)),
    enrollmentsAmong: async (_tx, ids) =>
      new Map([...w.enrollments].filter(([enrollmentId]) => ids.includes(enrollmentId))),
    sessionsAmong: async (_tx, ids) => new Map(ids.map((one) => [one, sessionsOf(one)])),
    casesAmong: async (_tx, ids) => new Map(ids.map((one) => [one, []])),
    openMattersAmong: async () => new Set(),
    makeupsAmong: async () => new Map(),
  };
  const insert = async (_tx: Transaction, releases: readonly DueRelease[]) => {
    const written: ReleaseRow[] = [];
    for (const release of releases) {
      if (release.enrollmentId === w.failOn) throw new Error('the database refused');
      const taken = w.rows.some(
        (row) => row.enrollmentId === release.enrollmentId && row.milestone === release.milestone,
      );
      if (taken) continue;
      const row = { ...release, id: id(500 + w.rows.length), markedAt: null };
      w.rows.push(row);
      written.push(row);
    }
    return written;
  };
  return createShareReleaseSweep({
    transactions: { run: (work) => work({} as Transaction) },
    settings,
    log: {
      info: (...line: unknown[]) => void w.lines.push(line),
      error: (...line: unknown[]) => void w.errors.push(line),
    },
    pageSize,
    report: () => undefined,
    clock: async () => NOW,
    reads,
    insert,
    ordersAfter: async (_tx, after, take) =>
      w.orders.filter((o) => after === undefined || o.paymentId > after).slice(0, take),
  });
}

describe('the share release sweep (003:T105)', () => {
  it('writes each due release once, across pages, with its amount and when it fell due', async () => {
    const w = world(3);
    const run = await sweepOver(w).run();

    expect(run.failed).toEqual([]);
    expect(run.written).toHaveLength(3);
    expect(
      w.rows.map(({ enrollmentId, milestone, amount_piasters, dueAt }) => ({
        enrollmentId,
        milestone,
        amount_piasters,
        dueAt: dueAt.toISOString(),
      })),
    ).toEqual(
      [1, 2, 3].map((n) => ({
        enrollmentId: id(100 + n),
        milestone: 'recitation_end',
        amount_piasters: 700_000,
        dueAt: '2026-10-13T10:00:00.000Z',
      })),
    );
  });

  it('logs one line of ids and the milestone per release written, never an amount', async () => {
    const w = world(1);
    await sweepOver(w).run();

    expect(w.lines).toEqual([
      [
        {
          releaseId: id(500),
          enrollmentId: id(101),
          teacherUserId: TEACHER,
          milestone: 'recitation_end',
        },
        "A release of the teacher's share fell due",
      ],
    ]);
  });

  it('leaves what one run leaves when run twice (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => world(3),
      run: async (w) => {
        await sweepOver(w).run();
      },
      observe: (w) =>
        w.rows.map(({ enrollmentId, milestone, amount_piasters }) => [
          enrollmentId,
          milestone,
          amount_piasters,
        ]),
    });
    expect(twice).toEqual(once);
    expect(once).toHaveLength(3);
  });

  it('goes on past an enrollment whose write failed, reporting it with its id alone', async () => {
    const w = world(3, 2);
    const run = await sweepOver(w).run();

    expect(run.failed).toEqual([id(102)]);
    expect(w.rows.map(({ enrollmentId }) => enrollmentId)).toEqual([id(101), id(103)]);
    expect(w.errors).toEqual([
      [{ enrollmentId: id(102) }, "A release of the teacher's share failed"],
    ]);
  });
});

describe('a make-up valued as the session it makes up (Q-B1-4 (a))', () => {
  it('reads each make-up’s original through sessions’ entry, through a chain of make-ups', async () => {
    const enrollmentId = id(101);
    const w = world(1);
    const rows = [
      { id: id(601), sequenceNumber: 1, status: 'done' },
      { id: id(603), sequenceNumber: 3, status: 'teacher_no_show' },
      { id: id(611), sequenceNumber: 11, status: 'teacher_no_show' },
      { id: id(612), sequenceNumber: 12, status: 'done' },
    ].map((row) => ({
      ...row,
      endsAt: new Date('2026-10-01T10:00:00Z'),
    })) as unknown as EnrollmentSessionRow[];
    const reads: ReleaseReads = {
      shareOrdersOf: async () => ordersByEnrollment(w.orders, [enrollmentId]),
      releasesOf: async () => [],
      enrollmentsAmong: async () => w.enrollments,
      sessionsAmong: async () => new Map([[enrollmentId, rows]]),
      casesAmong: async () => new Map([[enrollmentId, []]]),
      openMattersAmong: async () => new Set(),
      // 11 makes up 3, and 12 makes up 11.
      makeupsAmong: async () =>
        new Map([
          [id(611), id(603)],
          [id(612), id(611)],
        ]),
    };
    const [one] = await releasesAmong({} as Transaction, [enrollmentId], reads);

    expect(
      one?.facts.sessions.map(({ sequenceNumber, madeUpSequence }) => [
        sequenceNumber,
        madeUpSequence,
      ]),
    ).toEqual([
      [1, undefined],
      [3, undefined],
      [11, 3],
      [12, 3],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// 006:T011 (R-512, FR-703, FR-706b, FR-728): a programme's facts. The worked example: an offer of
// 10,000 EGP, the fee 500 EGP, the share 70 %, the half 25 %.

const assessmentOf = (enrollmentId: string, paymentId: string): ShareOrderRow => ({
  paymentId,
  enrollmentId,
  kind: 'assessment',
  paid_piasters: piasters(50_000),
  share_piasters: piasters(35_000),
  sharePercent: 70,
  halfPercent: 25,
  refunded_piasters: piasters(0),
});

const programmeWorld = (): World => {
  const enrollmentId = id(101);
  return {
    orders: [
      assessmentOf(enrollmentId, id(201)),
      {
        ...assessmentOf(enrollmentId, id(202)),
        kind: 'rest_in_full',
        paid_piasters: piasters(950_000),
        share_piasters: piasters(665_000),
      },
    ],
    enrollments: new Map([
      [
        enrollmentId,
        {
          enrollmentId,
          teacherUserId: TEACHER,
          studentUserId: id(301),
          track: 'ijazah_track',
          status: 'completed',
          sessionCount: 10,
          cancellationReason: null,
          programme: {
            state: 'closed',
            total_piasters: piasters(1_000_000),
            payByAt: new Date('2026-09-28T10:00:00Z'),
            closedAt: new Date('2026-10-10T10:00:00Z'),
            payBlockedOpen: false,
          },
        },
      ],
    ]),
    rows: [],
    lines: [],
    errors: [],
  };
};

describe('006:T011 a programme’s facts (R-512)', () => {
  it('hands the rules every paid order with its kind, oldest first, the first as `order`', async () => {
    const w = programmeWorld();
    const enrollmentId = id(101);
    const reads: ReleaseReads = {
      shareOrdersOf: async (_tx, ids) => ordersByEnrollment(w.orders, ids),
      releasesOf: async () => [],
      enrollmentsAmong: async () => w.enrollments,
      sessionsAmong: async () => new Map([[enrollmentId, sessionsOf(enrollmentId)]]),
      casesAmong: async () => new Map([[enrollmentId, []]]),
      openMattersAmong: async () => new Set(),
      makeupsAmong: async () => new Map(),
    };
    const [one] = await releasesAmong({} as Transaction, [enrollmentId], reads);

    expect(one?.facts.order.paymentId).toBe(id(201));
    expect(one?.facts.orders.map(({ paymentId, kind }) => [paymentId, kind])).toEqual([
      [id(201), 'assessment'],
      [id(202), 'rest_in_full'],
    ]);
    expect(one?.facts.enrollment.programme?.total_piasters).toBe(1_000_000);
  });

  it('reads the cancellation reason and the programme through booking’s entry, a `pay_blocked` item open among them', async () => {
    const enrollmentId = id(101);
    const asked: unknown[] = [];
    const tx = {
      enrollment: {
        findMany: async (query: unknown) => {
          asked.push(query);
          return [
            {
              id: enrollmentId,
              studentUserId: id(301),
              teacherUserId: TEACHER,
              status: 'cancelled',
              cancellationReason: 'offer_lapsed',
              snapshotSubjectId: id(400),
              snapshotTrack: 'ijazah_track',
              snapshotSessionCount: 41,
              snapshotDurationMinutes: 45,
              snapshotPricePiasters: 1_000_000n,
              programme: {
                state: 'closed',
                payByAt: new Date('2026-10-05T12:00:00Z'),
                closedAt: new Date('2026-10-07T08:00:00Z'),
              },
              programmeRequests: [{ id: id(700) }],
            },
          ];
        },
      },
    } as unknown as Transaction;

    const enrollments = await releaseReads.enrollmentsAmong(tx, [enrollmentId]);

    expect(enrollments.get(enrollmentId)).toEqual({
      enrollmentId,
      teacherUserId: TEACHER,
      studentUserId: id(301),
      track: 'ijazah_track',
      status: 'cancelled',
      sessionCount: 41,
      cancellationReason: 'offer_lapsed',
      programme: {
        state: 'closed',
        total_piasters: 1_000_000,
        payByAt: new Date('2026-10-05T12:00:00Z'),
        closedAt: new Date('2026-10-07T08:00:00Z'),
        payBlockedOpen: true,
      },
    });
    expect(asked).toHaveLength(1);
  });

  it('writes the half (1,750 EGP) and the end (5,250 EGP) once across pages, and once when run twice (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: programmeWorld,
      run: async (w) => {
        await sweepOver(w, 1).run();
      },
      observe: (w) =>
        w.rows.map(({ enrollmentId, milestone, amount_piasters }) => [
          enrollmentId,
          milestone,
          amount_piasters,
        ]),
    });
    expect(twice).toEqual(once);
    expect(once).toEqual([
      [id(101), 'ijazah_half', 175_000],
      [id(101), 'ijazah_end', 525_000],
    ]);
  });
});
