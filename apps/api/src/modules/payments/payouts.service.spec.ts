// 003:T105: the payouts' reads and mark (`payouts.service.ts`), over a fake store. The worked
// example: 10,000 EGP packages of 10 sessions, the share at 70% (7,000 EGP, 700,000 piasters); a
// refund of 1,000 EGP (100,000 piasters) takes 700 EGP of the teacher's share off (Q-6 as revised);
// the dispute window 72 hours (and 48, to show the teacher's read answers the setting). The mark's race on the real table is
// `tests/db-integrity/payout-mark-race.spec.ts`.
import { piasters } from '@ijazah/money';
import { addDays } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { EnrollmentCase } from '../moderation/index.js';
import type { EnrollmentSessionRow } from '../sessions/index.js';
import {
  createPayouts,
  maskedReference,
  monthStartOf,
  type PayoutsStore,
} from './payouts.service.js';
import type { ReleaseRow, ShareOrderRow } from './share-release.repository.js';
import type { ReleaseEnrollment } from './share-release.rules.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = id(1);
const T1 = id(11);
const T2 = id(12);
const NOW = new Date('2026-11-18T12:00:00Z');
const tx = {} as Transaction;

const settings: SettingsReader = {
  read: async (key, schema) =>
    schema.parse({ dispute_window_hours: 72, admin_list_page_size: 1 }[key]),
};

/** Ten sessions ending on 2026-10-01 … 10, `done` up to `done`, then `scheduled`. */
const sessions = (done: number): EnrollmentSessionRow[] =>
  Array.from({ length: 10 }, (_, index) => ({
    sequenceNumber: index + 1,
    endsAt: new Date(addDays(new Date('2026-10-01T10:00:00Z'), index)),
    status: index < done ? 'done' : 'scheduled',
  })) as unknown as EnrollmentSessionRow[];

interface Fixture {
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly status: ReleaseEnrollment['status'];
  readonly done: number;
  readonly refunded?: number;
  readonly cases?: readonly EnrollmentCase[];
}

/**
 * T1: E1 completed (its release written and marked paid on 2026-11-02), E2 completed (its release
 * written, due since 2026-10-13), E3 running (held), E4 cancelled by an administrator's cancellation
 * with a refund of 1,000 EGP (003:T125, rule d: was a gender correction, which now releases). T2: E5
 * completed, its release written and due since 2026-10-05.
 */
const fixtures: readonly Fixture[] = [
  {
    enrollmentId: id(101),
    teacherUserId: T1,
    studentUserId: id(201),
    status: 'completed',
    done: 10,
  },
  {
    enrollmentId: id(102),
    teacherUserId: T1,
    studentUserId: id(202),
    status: 'completed',
    done: 10,
  },
  {
    enrollmentId: id(103),
    teacherUserId: T1,
    studentUserId: id(203),
    status: 'confirmed',
    done: 4,
  },
  {
    enrollmentId: id(104),
    teacherUserId: T1,
    studentUserId: id(204),
    status: 'cancelled',
    done: 2,
    refunded: 100_000,
    cases: [{ caseId: id(404), reason: 'admin_cancellation', status: 'resolved', createdAt: NOW }],
  },
  {
    enrollmentId: id(105),
    teacherUserId: T2,
    studentUserId: id(205),
    status: 'completed',
    done: 10,
  },
];

const order = (f: Fixture): ShareOrderRow => ({
  paymentId: `${f.enrollmentId.slice(0, -3)}9${f.enrollmentId.slice(-2)}`,
  enrollmentId: f.enrollmentId,
  kind: 'package',
  instalmentMonth: null,
  paid_piasters: piasters(1_000_000),
  share_piasters: piasters(700_000),
  sharePercent: 70,
  halfPercent: null,
  refunded_piasters: piasters(f.refunded ?? 0),
});

const written: ReleaseRow[] = [
  {
    id: id(501),
    enrollmentId: id(101),
    teacherUserId: T1,
    milestone: 'recitation_end',
    amount_piasters: piasters(700_000),
    dueAt: new Date('2026-10-13T10:00:00Z'),
    markedAt: new Date('2026-11-02T09:00:00Z'),
    refundTakenOff_piasters: piasters(0),
  },
  {
    id: id(502),
    enrollmentId: id(102),
    teacherUserId: T1,
    milestone: 'recitation_end',
    amount_piasters: piasters(700_000),
    dueAt: new Date('2026-10-13T10:00:00Z'),
    markedAt: null,
    refundTakenOff_piasters: piasters(0),
  },
  {
    id: id(505),
    enrollmentId: id(105),
    teacherUserId: T2,
    milestone: 'recitation_end',
    amount_piasters: piasters(700_000),
    dueAt: new Date('2026-10-05T10:00:00Z'),
    markedAt: null,
    refundTakenOff_piasters: piasters(0),
  },
];

function store(overrides: Partial<PayoutsStore> = {}): {
  readonly store: PayoutsStore;
  readonly marks: unknown[];
  readonly unmarks: string[];
} {
  const marks: unknown[] = [];
  const unmarks: string[] = [];
  const byIds = <T>(ids: readonly string[], pick: (f: Fixture) => T) =>
    new Map(
      fixtures.filter((f) => ids.includes(f.enrollmentId)).map((f) => [f.enrollmentId, pick(f)]),
    );
  const base: PayoutsStore = {
    reads: {
      shareOrdersOf: async (_tx, ids) => byIds(ids, (f) => [order(f)]),
      releasesOf: async (_tx, ids) => written.filter((row) => ids.includes(row.enrollmentId)),
      enrollmentsAmong: async (_tx, ids) =>
        byIds(ids, (f) => ({
          enrollmentId: f.enrollmentId,
          teacherUserId: f.teacherUserId,
          studentUserId: f.studentUserId,
          track: 'recitation' as const,
          status: f.status,
          sessionCount: 10,
          cancellationReason: null,
          programme: null,
        })),
      sessionsAmong: async (_tx, ids) => byIds(ids, (f) => sessions(f.done)),
      casesAmong: async (_tx, ids) => byIds(ids, (f) => [...(f.cases ?? [])]),
      openMattersAmong: async () => new Set(),
      caseRecordOf: async () => null,
      makeupsAmong: async () => new Map(),
    },
    enrollmentIdsOfTeacher: async (_tx, teacherUserId) =>
      fixtures.filter((f) => f.teacherUserId === teacherUserId).map((f) => f.enrollmentId),
    refundedOrdersOf: async (_tx, ids) =>
      fixtures.filter((f) => ids.includes(f.enrollmentId) && (f.refunded ?? 0) > 0).map(order),
    shareOrdersAfter: async (_tx, after, take) =>
      fixtures
        .map(order)
        .filter((o) => after === undefined || o.paymentId > after)
        .slice(0, take),
    refundedOrdersAfter: async (_tx, after, take) =>
      fixtures
        .filter((f) => (f.refunded ?? 0) > 0)
        .map(order)
        .filter((o) => after === undefined || o.paymentId > after)
        .slice(0, take),
    releasesAfter: async (_tx, after, take) =>
      written.filter((row) => after === undefined || row.id > after).slice(0, take),
    namesOf: async (_tx, ids) => new Map(ids.map((one) => [one, `name-${one.slice(-3)}`])),
    payoutReferenceOf: async (_tx, teacherUserId) => (teacherUserId === T1 ? 'rcp_00001234' : null),
    releaseById: async (_tx, releaseId) => written.find((row) => row.id === releaseId) ?? null,
    // 003:T105's undo: true only while the release is marked (`WHERE marked_at IS NOT NULL`).
    unmarkRelease: async (_tx, releaseId) => {
      unmarks.push(releaseId);
      return (written.find((row) => row.id === releaseId)?.markedAt ?? null) !== null;
    },
    markRelease: async (_tx, mark) => {
      marks.push(mark);
      return written.find((row) => row.id === mark.releaseId)?.markedAt === null;
    },
  };
  return { store: { ...base, ...overrides }, marks, unmarks };
}

/** An idempotency that runs the effect, or replays when told to. */
const runOnce = (replay = false) => ({
  runOn: async <T>(_tx: Transaction, _request: unknown, effect: (tx: Transaction) => Promise<T>) =>
    replay
      ? { outcome: { teacherUserId: T1 } as T, replayed: true }
      : { outcome: await effect(tx), replayed: false },
});

function payouts(
  overrides: Partial<PayoutsStore> = {},
  replay = false,
  reader: SettingsReader = settings,
) {
  const lines: unknown[][] = [];
  const { store: s, marks, unmarks } = store(overrides);
  const service = createPayouts({
    settings: reader,
    idempotency: runOnce(replay) as never,
    store: s,
    log: { info: (...line: unknown[]) => void lines.push(line) },
    clock: async () => NOW,
  });
  return { service, lines, marks, unmarks };
}

describe('teacher.dues.get: «مستحقاتي» (DEC-89)', () => {
  it('answers his own releases held, due and paid, the two totals, and his share of each refund', async () => {
    const dues = await payouts().service.teacherDues(tx, T1);

    expect(dues).toEqual({
      held_piasters: 700_000,
      paid_piasters: 700_000,
      releases: [
        {
          part: 'recitation_end',
          amount_piasters: 700_000,
          state: 'paid',
          fallsDueAt: '2026-10-13T10:00:00.000Z',
          waitsForCase: false,
          paidAt: '2026-11-02T09:00:00.000Z',
        },
        {
          part: 'recitation_end',
          amount_piasters: 700_000,
          state: 'due',
          fallsDueAt: '2026-10-13T10:00:00.000Z',
          waitsForCase: false,
        },
        {
          part: 'recitation_end',
          amount_piasters: 700_000,
          state: 'held',
          fallsDueAt: '2026-10-13T10:00:00.000Z',
          waitsForCase: false,
        },
      ],
      deductions: [{ share_piasters: 70_000, caseReason: 'admin_cancellation' }],
      disputeWindowHours: 72,
    });
  });

  it('answers the dispute window read from its setting at each request, 72 or 48 hours, never a constant (the owner, 2026-11-18)', async () => {
    const at = (hours: number): SettingsReader => ({
      read: async (key, schema) =>
        schema.parse({ dispute_window_hours: hours, admin_list_page_size: 1 }[key]),
    });
    const reads: string[] = [];
    const counting: SettingsReader = {
      read: async (key, schema) => {
        reads.push(key);
        return at(48).read(key, schema);
      },
    };
    const { service } = payouts({}, false, counting);

    expect((await payouts({}, false, at(72)).service.teacherDues(tx, T1)).disputeWindowHours).toBe(
      72,
    );
    expect((await service.teacherDues(tx, T1)).disputeWindowHours).toBe(48);
    await service.teacherDues(tx, T1);
    expect(reads.filter((key) => key === 'dispute_window_hours')).toHaveLength(2);
  });

  it('never answers another teacher’s release, even one a read hands back', async () => {
    const dues = await payouts({
      enrollmentIdsOfTeacher: async () => [id(101), id(105)],
    }).service.teacherDues(tx, T1);

    expect(dues.releases).toHaveLength(1);
    expect(dues.paid_piasters).toBe(700_000);
    expect(JSON.stringify(dues)).not.toContain(id(105));
  });

  it('carries no order, enrollment or student id and no name', async () => {
    const text = JSON.stringify(await payouts().service.teacherDues(tx, T1));
    for (const leak of [
      id(101),
      id(201),
      id(204),
      'name-',
      'paymentId',
      'enrollmentId',
      'student',
    ]) {
      expect(text).not.toContain(leak);
    }
  });
});

describe('payouts.list: «تحويلات المعلمين»', () => {
  it('puts the teacher with the oldest due release first and totals every teacher', async () => {
    const page = await payouts().service.list(tx, ADMIN, {});

    expect(page.totals).toEqual({
      held_piasters: 700_000,
      dueNow_piasters: 1_400_000,
      paid_piasters: 700_000,
      paidThisMonth_piasters: 700_000,
      takenOff_piasters: 70_000,
    });
    expect(page.items).toEqual([
      {
        teacher: { userId: T2, displayName: 'name-012' },
        held_piasters: 0,
        dueNow_piasters: 700_000,
        paid_piasters: 0,
        paidThisMonth_piasters: 0,
        takenOff_piasters: 0,
        oldestDueAt: '2026-10-05T10:00:00.000Z',
      },
    ]);
    expect(page.nextCursor).toBe(T2);
  });

  it('pages after the cursor, the last page with no cursor', async () => {
    const page = await payouts().service.list(tx, ADMIN, { cursor: T2 });

    expect(page.items.map(({ teacher }) => teacher.userId)).toEqual([T1]);
    expect(page.items[0]).toMatchObject({ dueNow_piasters: 700_000, takenOff_piasters: 70_000 });
    expect(page.nextCursor).toBeUndefined();
  });

  it('ends its scan when a page does not move the cursor, so a read that ignores it cannot loop', async () => {
    // A store that answers every written release whatever the cursor, at a page size of 1.
    const { service } = payouts({ releasesAfter: async () => written });
    await expect(service.list(tx, ADMIN, {})).resolves.toBeDefined();
  });

  it('keeps only the teachers with something due under «due now only»', async () => {
    // T1's due release marked: T1 has nothing due now, T2 still has.
    const paid = written.map((row) =>
      row.id === id(502) ? { ...row, markedAt: new Date('2026-11-03T09:00:00Z') } : row,
    );
    const base = store().store;
    const { service } = payouts({
      releasesAfter: async (_tx, after, take) =>
        paid.filter((row) => after === undefined || row.id > after).slice(0, take),
      reads: {
        ...base.reads,
        releasesOf: async (_tx, ids) => paid.filter((row) => ids.includes(row.enrollmentId)),
      },
    });
    const all = await service.list(tx, ADMIN, { cursor: T2 });
    const dueOnly = await service.list(tx, ADMIN, { dueOnly: true });

    expect(all.items).toEqual([
      expect.objectContaining({ dueNow_piasters: 0, paid_piasters: 1_400_000 }),
    ]);
    expect(all.items[0]?.oldestDueAt).toBeUndefined();
    expect(dueOnly.items.map(({ teacher }) => teacher.userId)).toEqual([T2]);
    expect(dueOnly.nextCursor).toBeUndefined();
  });
});

describe('payouts.get: a teacher’s detail', () => {
  it('shows each release with its order and student, each refund with its share and case, and the masked account', async () => {
    const detail = await payouts().service.get(tx, ADMIN, T1);

    expect(detail.teacher).toEqual({ userId: T1, displayName: 'name-011' });
    expect(detail.payoutAccountMasked).toBe('••••1234');
    expect(
      detail.releases.map(({ releaseId, state, enrollmentId, student }) => ({
        releaseId,
        state,
        enrollmentId,
        student: student.displayName,
      })),
    ).toEqual([
      { releaseId: id(501), state: 'paid', enrollmentId: id(101), student: 'name-201' },
      { releaseId: id(502), state: 'due', enrollmentId: id(102), student: 'name-202' },
      { releaseId: undefined, state: 'held', enrollmentId: id(103), student: 'name-203' },
    ]);
    expect(detail.deductions).toEqual([
      {
        paymentId: order(fixtures[3] as Fixture).paymentId,
        enrollmentId: id(104),
        student: { userId: id(204), displayName: 'name-204' },
        refunded_piasters: 100_000,
        share_piasters: 70_000,
        case: { caseId: id(404), reason: 'admin_cancellation' },
      },
    ]);
    expect(detail.figures).toMatchObject({
      held_piasters: 700_000,
      dueNow_piasters: 700_000,
      takenOff_piasters: 70_000,
    });
  });

  it('shows no account while the gateway has not verified one', async () => {
    expect((await payouts().service.get(tx, ADMIN, T2)).payoutAccountMasked).toBeUndefined();
  });
});

describe('payouts.mark: «تم الصرف»', () => {
  it('marks a due release once and answers its teacher, with one line of ids', async () => {
    const { service, lines, marks } = payouts();
    const marked = await service.mark(tx, ADMIN, {
      releaseId: id(502),
      idempotencyKey: 'k'.repeat(16),
    });

    expect(marked).toEqual({ teacherUserId: T1, replayed: false });
    expect(marks).toEqual([{ releaseId: id(502), adminId: ADMIN, at: NOW }]);
    expect(lines).toEqual([
      [
        { adminId: ADMIN, releaseId: id(502), enrollmentId: id(102), teacherUserId: T1 },
        "A release of the teacher's share was marked paid",
      ],
    ]);
  });

  it('refuses an unknown release NOT_FOUND, logging ids and the reason', async () => {
    const { service, lines } = payouts();
    const refused = await service
      .mark(tx, ADMIN, { releaseId: id(599), idempotencyKey: 'k'.repeat(16) })
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(DomainError);
    expect((refused as DomainError).code).toBe('NOT_FOUND');
    expect(lines).toEqual([
      [
        { adminId: ADMIN, releaseId: id(599), errorCode: 'NOT_FOUND', reason: 'no_release' },
        "A payout release's mark was refused",
      ],
    ]);
  });

  it('refuses a release already marked CONFLICT, no longer due', async () => {
    const { service, lines } = payouts();
    const refused = await service
      .mark(tx, ADMIN, { releaseId: id(501), idempotencyKey: 'k'.repeat(16) })
      .catch((error: unknown) => error);

    expect((refused as DomainError).code).toBe('CONFLICT');
    expect(lines).toEqual([
      [
        { adminId: ADMIN, releaseId: id(501), errorCode: 'CONFLICT', reason: 'already_marked' },
        "A payout release's mark was refused",
      ],
    ]);
  });

  it('answers a replay from the key, marking nothing again', async () => {
    const { service, marks } = payouts({}, true);
    expect(
      await service.mark(tx, ADMIN, { releaseId: id(502), idempotencyKey: 'k'.repeat(16) }),
    ).toEqual({ teacherUserId: T1, replayed: true });
    expect(marks).toEqual([]);
  });
});

describe('payouts.unmark: a mark made in error undone (DEC-89, the owner of 2026-11-18)', () => {
  const REASON = 'marked by mistake: the transfer did not go through';
  const KEY = 'u'.repeat(16);

  it('unmarks a marked release and answers its teacher, its one line of ids carrying no reason', async () => {
    const { service, lines, unmarks } = payouts();
    const undone = await service.unmark(tx, ADMIN, {
      releaseId: id(501),
      reason: REASON,
      idempotencyKey: KEY,
    });

    expect(undone).toEqual({ teacherUserId: T1, replayed: false });
    expect(unmarks).toEqual([id(501)]);
    expect(lines).toEqual([
      [
        { adminId: ADMIN, releaseId: id(501), enrollmentId: id(101), teacherUserId: T1 },
        "A release of the teacher's share was unmarked",
      ],
    ]);
    expect(JSON.stringify(lines)).not.toContain('mistake');
  });

  it('refuses an unknown release NOT_FOUND, logging ids and the reason code', async () => {
    const { service, lines } = payouts();
    const refused = await service
      .unmark(tx, ADMIN, { releaseId: id(599), reason: REASON, idempotencyKey: KEY })
      .catch((error: unknown) => error);

    expect((refused as DomainError).code).toBe('NOT_FOUND');
    expect(lines).toEqual([
      [
        { adminId: ADMIN, releaseId: id(599), errorCode: 'NOT_FOUND', reason: 'no_release' },
        "A payout release's unmark was refused",
      ],
    ]);
  });

  it('refuses a release not marked CONFLICT', async () => {
    const { service, lines } = payouts();
    const refused = await service
      .unmark(tx, ADMIN, { releaseId: id(502), reason: REASON, idempotencyKey: KEY })
      .catch((error: unknown) => error);

    expect((refused as DomainError).code).toBe('CONFLICT');
    expect(lines).toEqual([
      [
        { adminId: ADMIN, releaseId: id(502), errorCode: 'CONFLICT', reason: 'not_marked' },
        "A payout release's unmark was refused",
      ],
    ]);
  });

  it('answers a replay from the key, unmarking nothing again', async () => {
    const { service, unmarks } = payouts({}, true);
    expect(
      await service.unmark(tx, ADMIN, { releaseId: id(501), reason: REASON, idempotencyKey: KEY }),
    ).toEqual({ teacherUserId: T1, replayed: true });
    expect(unmarks).toEqual([]);
  });
});

describe('the month and the mask', () => {
  it('starts «this month» at Cairo’s midnight of the 1st (Q-B1-9 (a))', () => {
    expect(monthStartOf(NOW).toISOString()).toBe('2026-10-31T22:00:00.000Z');
  });

  it('shows the reference’s last four characters only', () => {
    expect(maskedReference('rcp_00001234')).toBe('••••1234');
  });
});

// ---------------------------------------------------------------------------------------------
// 003:T127 (SRS DEC-98; Q-4 (a)): once an enrollment's end release is written, a refund recorded
// afterwards is the platform's: the teacher's «عليك» and `takenOff` show only the share the release
// took off (`refund_taken_off_piasters`), the administrator's page shows the rest marked as the
// platform's. A refund before the release, and a closing release, as today. E2: «due 7,000».
describe('003:T127 a refund after the end release (DEC-98)', () => {
  const E2 = id(102);
  const e2 = fixtures[1] as Fixture;
  /** E2's order refunded `refunded` piasters, its end release keeping `takenOff`. */
  const after = (
    refunded: number,
    takenOff: number,
    milestone: ReleaseRow['milestone'] = 'recitation_end',
  ) => {
    const rows = written.map((row) =>
      row.enrollmentId === E2
        ? { ...row, milestone, refundTakenOff_piasters: piasters(takenOff) }
        : row,
    );
    const refundedOrder = { ...order(e2), refunded_piasters: piasters(refunded) };
    const base = store().store;
    return payouts({
      reads: {
        ...base.reads,
        releasesOf: async (_tx, ids) => rows.filter((row) => ids.includes(row.enrollmentId)),
      },
      releasesAfter: async (_tx, from, take) =>
        rows.filter((row) => from === undefined || row.id > from).slice(0, take),
      refundedOrdersOf: async (_tx, ids) => (ids.includes(E2) ? [refundedOrder] : []),
      refundedOrdersAfter: async (_tx, from, take) =>
        [refundedOrder].filter((one) => from === undefined || one.paymentId > from).slice(0, take),
    }).service;
  };

  it('«due 7,000», then 1,000 EGP refunded: the row stays 7,000 and the teacher sees no «عليك 700»', async () => {
    const dues = await after(100_000, 0).teacherDues(tx, T1);

    expect(dues.deductions).toEqual([]);
    expect(dues.releases).toContainEqual(
      expect.objectContaining({ part: 'recitation_end', amount_piasters: 700_000, state: 'due' }),
    );
  });

  it('the administrator sees the 700 EGP marked the platform’s, none of it taken off the teacher', async () => {
    const service = after(100_000, 0);
    const detail = await service.get(tx, ADMIN, T1);

    expect(detail.deductions).toEqual([
      {
        paymentId: order(e2).paymentId,
        enrollmentId: E2,
        student: { userId: id(202), displayName: 'name-202' },
        refunded_piasters: 100_000,
        share_piasters: 70_000,
        platformShare_piasters: 70_000,
      },
    ]);
    expect(detail.figures.takenOff_piasters).toBe(0);
    expect((await service.list(tx, ADMIN, {})).totals.takenOff_piasters).toBe(0);
  });

  it('a refund before the release, taken off by it, stays the teacher’s as today', async () => {
    const service = after(100_000, 70_000);

    expect((await service.teacherDues(tx, T1)).deductions).toEqual([{ share_piasters: 70_000 }]);
    const detail = await service.get(tx, ADMIN, T1);
    expect(detail.deductions[0]).not.toHaveProperty('platformShare_piasters');
    expect(detail.figures.takenOff_piasters).toBe(70_000);
    expect((await service.list(tx, ADMIN, {})).totals.takenOff_piasters).toBe(70_000);
  });

  it('a refund partly after the release: 700 EGP the teacher’s, 700 EGP the platform’s', async () => {
    const service = after(200_000, 70_000);

    expect((await service.teacherDues(tx, T1)).deductions).toEqual([{ share_piasters: 70_000 }]);
    expect((await service.get(tx, ADMIN, T1)).deductions[0]).toMatchObject({
      share_piasters: 140_000,
      platformShare_piasters: 70_000,
    });
  });

  it('a closing release keeps today’s reading: the whole share the teacher’s (T120’s open case)', async () => {
    const service = after(100_000, 0, 'teacher_dropout');

    expect((await service.teacherDues(tx, T1)).deductions).toEqual([{ share_piasters: 70_000 }]);
    expect((await service.get(tx, ADMIN, T1)).deductions[0]).not.toHaveProperty(
      'platformShare_piasters',
    );
  });
});
