// 006:T005 (R-504; U-1, N-12) — booking's queries on `programmes`: a student's active programmes'
// weekly times (the four active states, a soft-deleted enrollment left out, one enrollment left out
// when asked) and the confirmed assessment's row written once. Over a recording stand-in of the
// client; the rows against Postgres are `tests/db-integrity/programme-confirmation.spec.ts`' and
// `tests/adversarial/programme-assessment.spec.ts`'. 006:T007: the offer's read and its write.
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  activeProgrammeSlotsOf,
  insertAwaitingOffer,
  offerEnrollmentOf,
  payEnrollmentOf,
  programmeStateOf,
  programmeTermsOf,
  writeOffer,
  withdrawOpenStop,
  writeProgrammePaid,
} from './programmes.repository.js';

const STUDENT = '0199d0a0-0000-7000-8000-0000000006d2';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000006e1';
const SLOT = '0199d0a0-0000-7000-8000-0000000006f1';
const REQUEST = '0199d0a0-0000-7000-8000-0000000006a1';

function clientOf(rows: readonly unknown[]) {
  const calls: [string, unknown][] = [];
  const client = {
    programme: {
      findMany: async (query: unknown) => {
        calls.push(['findMany', query]);
        return rows;
      },
      createMany: async (query: unknown) => {
        calls.push(['createMany', query]);
        return { count: 1 };
      },
    },
  } as unknown as Pick<Transaction, 'programme'>;
  return { client, calls };
}

describe('a student’s active programmes (U-1)', () => {
  it('reads the four active states of the students’ live enrollments, by enrollment id', async () => {
    const { client, calls } = clientOf([
      {
        enrollmentId: ENROLLMENT,
        enrollment: { slotId: SLOT, snapshotSlotTimezone: 'Africa/Cairo' },
      },
    ]);
    await expect(activeProgrammeSlotsOf(client, [STUDENT])).resolves.toStrictEqual([
      { enrollmentId: ENROLLMENT, slotId: SLOT, timezone: 'Africa/Cairo' },
    ]);
    expect(calls).toEqual([
      [
        'findMany',
        {
          where: {
            state: { in: ['awaiting_offer', 'offered', 'active', 'paused'] },
            enrollment: { studentUserId: { in: [STUDENT] }, deletedAt: null },
          },
          orderBy: { enrollmentId: 'asc' },
          select: {
            enrollmentId: true,
            enrollment: { select: { slotId: true, snapshotSlotTimezone: true } },
          },
        },
      ],
    ]);
  });

  it('leaves out the enrollment named', async () => {
    const { client, calls } = clientOf([]);
    await activeProgrammeSlotsOf(client, [STUDENT], ENROLLMENT);
    expect(calls[0]?.[1]).toMatchObject({
      where: { enrollment: { id: { not: ENROLLMENT } } },
    });
  });

  it('reads nothing for no student', async () => {
    const { client, calls } = clientOf([]);
    await expect(activeProgrammeSlotsOf(client, [])).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('the confirmed assessment’s programme (R-504)', () => {
  it('writes it `awaiting_offer`, a second write skipped', async () => {
    const { client, calls } = clientOf([]);
    await insertAwaitingOffer(client, ENROLLMENT);
    expect(calls).toEqual([
      [
        'createMany',
        { data: [{ enrollmentId: ENROLLMENT, state: 'awaiting_offer' }], skipDuplicates: true },
      ],
    ]);
  });
});

describe('the programme’s state under its lock (006:T006; R-502)', () => {
  it('reads the enrollment’s programme’s state, and none for an enrollment that is no programme', async () => {
    const calls: unknown[] = [];
    const answers = [{ state: 'active' }, null];
    const client = {
      programme: {
        findUnique: async (query: unknown) => {
          calls.push(query);
          return answers.shift() ?? null;
        },
      },
    } as unknown as Pick<Transaction, 'programme'>;
    await expect(programmeStateOf(client, ENROLLMENT)).resolves.toBe('active');
    await expect(programmeStateOf(client, ENROLLMENT)).resolves.toBeNull();
    expect(calls[0]).toEqual({ where: { enrollmentId: ENROLLMENT }, select: { state: true } });
  });
});

// 006:T007 (R-506): the offer's reads and its one write.
const TEACHER = '0199d0a0-0000-7000-8000-0000000006d1';
const PACKAGE = '0199d0a0-0000-7000-8000-0000000006c1';

describe('the programme as the offer reads it (006:T007)', () => {
  it('reads the programme’s state with its live enrollment, a soft-deleted one left out', async () => {
    const calls: unknown[] = [];
    const answers: unknown[] = [
      {
        state: 'awaiting_offer',
        enrollment: {
          id: ENROLLMENT,
          studentUserId: STUDENT,
          teacherUserId: TEACHER,
          packageId: PACKAGE,
          slotId: SLOT,
          status: 'confirmed',
        },
      },
      null,
    ];
    const client = {
      programme: {
        findFirst: async (query: unknown) => {
          calls.push(query);
          return answers.shift() ?? null;
        },
      },
    } as unknown as Pick<Transaction, 'programme'>;
    await expect(offerEnrollmentOf(client, ENROLLMENT)).resolves.toStrictEqual({
      id: ENROLLMENT,
      studentUserId: STUDENT,
      teacherUserId: TEACHER,
      packageId: PACKAGE,
      slotId: SLOT,
      status: 'confirmed',
      state: 'awaiting_offer',
    });
    await expect(offerEnrollmentOf(client, ENROLLMENT)).resolves.toBeNull();
    expect(calls[0]).toEqual({
      where: { enrollmentId: ENROLLMENT, enrollment: { deletedAt: null } },
      select: {
        state: true,
        enrollment: {
          select: {
            id: true,
            studentUserId: true,
            teacherUserId: true,
            packageId: true,
            slotId: true,
            status: true,
          },
        },
      },
    });
  });
});

describe('the offer and the snapshot, written once (006:T007, R-506)', () => {
  const OFFER = {
    level: 'level',
    readiness: 'readiness',
    expectedLength: 'ten months',
    offeredAt: new Date('2026-11-24T10:00:00Z'),
    payByAt: new Date('2026-11-26T10:00:00Z'),
    monthCount: 10,
    snapshot: { sessionCount: 41, durationMinutes: 45, price_piasters: piasters(1_000_000) },
  };

  function writer(moved: number) {
    const calls: [string, unknown][] = [];
    const client = {
      programme: {
        updateMany: async (query: unknown) => {
          calls.push(['programme', query]);
          return { count: moved };
        },
      },
      enrollment: {
        updateMany: async (query: unknown) => {
          calls.push(['enrollment', query]);
          return { count: 1 };
        },
      },
    } as unknown as Pick<Transaction, 'programme' | 'enrollment'>;
    return { client, calls };
  }

  it('moves the programme from awaiting_offer to offered with the offer, then freezes the snapshot', async () => {
    const { client, calls } = writer(1);
    await expect(writeOffer(client, ENROLLMENT, OFFER)).resolves.toBe(true);
    expect(calls).toEqual([
      [
        'programme',
        {
          where: { enrollmentId: ENROLLMENT, state: 'awaiting_offer' },
          data: {
            state: 'offered',
            level: 'level',
            readiness: 'readiness',
            expectedLength: 'ten months',
            offeredAt: OFFER.offeredAt,
            payByAt: OFFER.payByAt,
            monthCount: 10,
          },
        },
      ],
      [
        'enrollment',
        {
          where: { id: ENROLLMENT },
          data: {
            snapshotSessionCount: 41,
            snapshotDurationMinutes: 45,
            snapshotPricePiasters: 1_000_000n,
          },
        },
      ],
    ]);
  });

  it('writes no snapshot when the programme was not awaiting an offer', async () => {
    const { client, calls } = writer(0);
    await expect(writeOffer(client, ENROLLMENT, OFFER)).resolves.toBe(false);
    expect(calls.map(([model]) => model)).toEqual(['programme']);
  });
});

// 006:T009 (FR-710, R-507, R-509): what programme.pay and the confirm step read of the programme.
describe('the programme as programme.pay reads it (006:T009)', () => {
  it('reads the programme’s state and pay_by_at with its live enrollment’s parties, status and snapshot', async () => {
    const calls: unknown[] = [];
    const payBy = new Date('2026-11-26T10:00:00Z');
    const answers: unknown[] = [
      {
        state: 'offered',
        payByAt: payBy,
        enrollment: {
          id: ENROLLMENT,
          studentUserId: STUDENT,
          teacherUserId: TEACHER,
          status: 'confirmed',
          snapshotSessionCount: 41,
          snapshotPricePiasters: 1_000_000n,
          snapshotTrack: 'ijazah_track',
        },
      },
      null,
    ];
    const client = {
      programme: {
        findFirst: async (query: unknown) => {
          calls.push(query);
          return answers.shift() ?? null;
        },
      },
    } as unknown as Pick<Transaction, 'programme'>;
    await expect(payEnrollmentOf(client, ENROLLMENT)).resolves.toStrictEqual({
      id: ENROLLMENT,
      studentUserId: STUDENT,
      teacherUserId: TEACHER,
      status: 'confirmed',
      state: 'offered',
      payByAt: payBy,
      offerSessionCount: 40,
      total_piasters: piasters(1_000_000),
      track: 'ijazah_track',
    });
    await expect(payEnrollmentOf(client, ENROLLMENT)).resolves.toBeNull();
    expect(calls[0]).toEqual({
      where: { enrollmentId: ENROLLMENT, enrollment: { deletedAt: null } },
      select: {
        state: true,
        payByAt: true,
        enrollment: {
          select: {
            id: true,
            studentUserId: true,
            teacherUserId: true,
            status: true,
            snapshotSessionCount: true,
            snapshotPricePiasters: true,
            snapshotTrack: true,
          },
        },
      },
    });
  });

  it('reads the programme’s state and pay_by_at under its lock for the confirm step, none for no programme', async () => {
    const calls: unknown[] = [];
    const payBy = new Date('2026-11-26T10:00:00Z');
    const answers = [{ state: 'offered', payByAt: payBy }, null];
    const client = {
      programme: {
        findUnique: async (query: unknown) => {
          calls.push(query);
          return answers.shift() ?? null;
        },
      },
    } as unknown as Pick<Transaction, 'programme'>;
    await expect(programmeTermsOf(client, ENROLLMENT)).resolves.toStrictEqual({
      state: 'offered',
      payByAt: payBy,
    });
    await expect(programmeTermsOf(client, ENROLLMENT)).resolves.toBeNull();
    expect(calls[0]).toEqual({
      where: { enrollmentId: ENROLLMENT },
      select: { state: true, payByAt: true },
    });
  });
});

describe('the programme’s payment, written by the confirm step (006:T009, Q-C1 (a))', () => {
  it('moves an offered programme to active with its plan, then writes the months paid', async () => {
    const calls: unknown[] = [];
    const client = {
      programme: {
        updateMany: async (query: unknown) => {
          calls.push(query);
          return { count: 1 };
        },
      },
    } as unknown as Pick<Transaction, 'programme'>;
    await writeProgrammePaid(client, ENROLLMENT, { plan: 'in_full', monthsPaid: 10 });
    expect(calls).toEqual([
      {
        where: { enrollmentId: ENROLLMENT, state: 'offered' },
        data: { state: 'active', paymentPlan: 'in_full' },
      },
      // 006:T016: a paused programme resumed by the paid month (rule d: the list gained it).
      {
        where: { enrollmentId: ENROLLMENT, state: 'paused' },
        data: { state: 'active', pausedAt: null },
      },
      { where: { enrollmentId: ENROLLMENT }, data: { monthsPaid: 10 } },
    ]);
  });

  // 006:T016 (FR-722, B-P3’s conflict check): every paid month lands here, an automatic one after
  // a pause included; the answer says whether it was resumed.
  it('red first: answers whether a paused programme was resumed (paused_at cleared in the same update)', async () => {
    for (const [count, resumed] of [
      [1, true],
      [0, false],
    ] as const) {
      const client = {
        programme: {
          updateMany: async (query: { where: { state?: string } }) => ({
            count: query.where.state === 'paused' ? count : 1,
          }),
        },
      } as unknown as Pick<Transaction, 'programme'>;
      await expect(
        writeProgrammePaid(client, ENROLLMENT, { plan: 'monthly', monthsPaid: 3 }),
      ).resolves.toBe(resumed);
    }
  });
});

describe('the open stop request withdrawn by a paid month (006:T016; FR-724)', () => {
  function requestsOf(open: { id: string } | null, count: number) {
    const calls: [string, unknown][] = [];
    const client = {
      programmeRequest: {
        findFirst: async (query: unknown) => {
          calls.push(['findFirst', query]);
          return open;
        },
        updateMany: async (query: unknown) => {
          calls.push(['updateMany', query]);
          return { count };
        },
      },
    } as unknown as Pick<Transaction, 'programmeRequest'>;
    return { client, calls };
  }

  it('red first: withdraws the open stop by its id, conditionally on it still open, and answers its id', async () => {
    const { client, calls } = requestsOf({ id: REQUEST }, 1);
    await expect(withdrawOpenStop(client, ENROLLMENT)).resolves.toBe(REQUEST);
    expect(calls).toEqual([
      [
        'findFirst',
        {
          where: { enrollmentId: ENROLLMENT, kind: 'stop', status: 'open' },
          select: { id: true },
        },
      ],
      ['updateMany', { where: { id: REQUEST, status: 'open' }, data: { status: 'withdrawn' } }],
    ]);
  });

  it('answers null with nothing written when no stop is open, and when another writer closed it first', async () => {
    const none = requestsOf(null, 0);
    await expect(withdrawOpenStop(none.client, ENROLLMENT)).resolves.toBeNull();
    expect(none.calls.map(([name]) => name)).toEqual(['findFirst']);
    const raced = requestsOf({ id: REQUEST }, 0);
    await expect(withdrawOpenStop(raced.client, ENROLLMENT)).resolves.toBeNull();
  });
});
