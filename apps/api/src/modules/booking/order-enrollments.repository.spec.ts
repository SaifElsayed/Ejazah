// 006:T011 (R-512, FR-706b) — booking's `enrollmentsAmong` as payments' releases of the teacher's
// share read it, over a recording stand-in of the client: each enrollment's programme, its state,
// the snapshot's price (the offer's total once offered), `pay_by_at`, `closed_at` and whether a
// `pay_blocked` item is open; null on an enrollment that is no programme.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { enrollmentsAmong } from './order-enrollments.repository.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PROGRAMME = id(101);
const PACKAGE = id(102);

const enrollmentRow = (enrollmentId: string, rest: Record<string, unknown>) => ({
  id: enrollmentId,
  studentUserId: id(301),
  teacherUserId: id(302),
  status: 'confirmed',
  cancellationReason: null,
  snapshotSubjectId: id(400),
  snapshotTrack: 'ijazah_track',
  snapshotSessionCount: 41,
  snapshotDurationMinutes: 45,
  snapshotPricePiasters: 1_000_000n,
  ...rest,
});

function clientOf(rows: readonly unknown[]) {
  const calls: unknown[] = [];
  const client = {
    enrollment: {
      findMany: async (query: unknown) => {
        calls.push(query);
        return rows;
      },
    },
  } as unknown as Pick<Transaction, 'enrollment'>;
  return { client, calls };
}

describe('enrollmentsAmong: the programme (006:T011)', () => {
  it('answers a programme’s state, the offer’s total, pay_by, its close and an open `pay_blocked` item', async () => {
    const { client } = clientOf([
      enrollmentRow(PROGRAMME, {
        programme: {
          state: 'offered',
          payByAt: new Date('2026-10-05T12:00:00Z'),
          closedAt: null,
        },
        programmeRequests: [{ id: id(700) }],
      }),
    ]);

    const [one] = await enrollmentsAmong(client, [PROGRAMME]);

    expect(one?.programme).toEqual({
      state: 'offered',
      total_piasters: 1_000_000,
      payByAt: new Date('2026-10-05T12:00:00Z'),
      closedAt: null,
      payBlockedOpen: true,
    });
  });

  it('answers no open `pay_blocked` item when none is open', async () => {
    const { client } = clientOf([
      enrollmentRow(PROGRAMME, {
        status: 'cancelled',
        cancellationReason: 'offer_declined',
        programme: {
          state: 'closed',
          payByAt: new Date('2026-10-05T12:00:00Z'),
          closedAt: new Date('2026-10-03T18:00:00Z'),
        },
        programmeRequests: [],
      }),
    ]);

    const [one] = await enrollmentsAmong(client, [PROGRAMME]);

    expect(one?.programme).toEqual({
      state: 'closed',
      total_piasters: 1_000_000,
      payByAt: new Date('2026-10-05T12:00:00Z'),
      closedAt: new Date('2026-10-03T18:00:00Z'),
      payBlockedOpen: false,
    });
  });

  it('answers no programme for an enrollment that is none, its other fields as before', async () => {
    const { client } = clientOf([
      enrollmentRow(PACKAGE, {
        snapshotTrack: 'recitation',
        programme: null,
        programmeRequests: [],
      }),
    ]);

    expect(await enrollmentsAmong(client, [PACKAGE])).toEqual([
      {
        id: PACKAGE,
        studentUserId: id(301),
        teacherUserId: id(302),
        status: 'confirmed',
        cancellationReason: null,
        snapshotSubjectId: id(400),
        snapshotTrack: 'recitation',
        snapshotSessionCount: 41,
        snapshotDurationMinutes: 45,
        programme: null,
      },
    ]);
  });

  it('reads the programme and only an open `pay_blocked` item (one at most, rule 79) in the one read', async () => {
    const { client, calls } = clientOf([]);

    await enrollmentsAmong(client, [PROGRAMME]);

    expect(calls).toEqual([
      expect.objectContaining({
        where: { id: { in: [PROGRAMME] } },
        select: expect.objectContaining({
          snapshotPricePiasters: true,
          programme: { select: { state: true, payByAt: true, closedAt: true } },
          programmeRequests: {
            where: { kind: 'pay_blocked', status: 'open' },
            select: { id: true },
          },
        }),
      }),
    ]);
  });
});
