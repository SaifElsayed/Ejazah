// 006:T011 (R-512) — the paid orders the releases of a teacher's share are computed from, over a
// recording stand-in of the client: every paid order with a share of each enrollment asked, oldest
// first by the time-ordered id, each with its kind and its gross. The release sweep's race on the
// real table is `tests/db-integrity/share-release-race.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { shareOrdersOf } from './share-release.repository.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PROGRAMME = id(101);
const PACKAGE = id(102);

/** An order row as the client answers it, a share of 70 % on its gross. */
const row = (
  paymentId: string,
  enrollmentId: string,
  kind: string,
  gross: bigint,
  share: bigint | null,
  instalmentMonth: number | null = null,
) => ({
  id: paymentId,
  enrollmentId,
  kind,
  instalmentMonth,
  grossPiasters: gross,
  teacherSharePiasters: share,
  teacherShareRatePercent: share === null ? null : 70,
  halfReleaseRatePercent: 25,
  refundedPiasters: 0n,
});

function clientOf(rows: readonly unknown[]) {
  const calls: unknown[] = [];
  const client = {
    payment: {
      findMany: async (query: unknown) => {
        calls.push(query);
        return rows;
      },
    },
  } as unknown as Pick<Transaction, 'payment' | 'teacherShareRelease'>;
  return { client, calls };
}

describe('shareOrdersOf (006:T011: every paid order with a share, with its kind)', () => {
  it('answers each enrollment’s paid orders oldest first, each with its kind and its gross', async () => {
    const { client } = clientOf([
      row(id(201), PROGRAMME, 'assessment', 50_000n, 35_000n),
      row(id(202), PACKAGE, 'package', 1_000_000n, 700_000n),
      row(id(203), PROGRAMME, 'instalment', 100_000n, 70_000n, 1),
      row(id(204), PROGRAMME, 'instalment', 100_000n, 70_000n, 2),
    ]);

    const orders = await shareOrdersOf(client, [PROGRAMME, PACKAGE]);

    expect(
      orders
        .get(PROGRAMME)
        ?.map(({ paymentId, kind, paid_piasters, share_piasters }) => [
          paymentId,
          kind,
          paid_piasters,
          share_piasters,
        ]),
    ).toEqual([
      [id(201), 'assessment', 50_000, 35_000],
      [id(203), 'instalment', 100_000, 70_000],
      [id(204), 'instalment', 100_000, 70_000],
    ]);
    expect(orders.get(PACKAGE)?.map(({ paymentId, kind }) => [paymentId, kind])).toEqual([
      [id(202), 'package'],
    ]);
  });

  it('leaves out an order created before the commission (no share), keeping every other', async () => {
    const { client } = clientOf([
      row(id(201), PACKAGE, 'package', 1_000_000n, null),
      row(id(202), PACKAGE, 'package', 1_000_000n, 700_000n),
      row(id(203), PACKAGE, 'package', 1_000_000n, 700_000n),
    ]);

    const orders = await shareOrdersOf(client, [PACKAGE]);

    expect(orders.get(PACKAGE)?.map(({ paymentId }) => paymentId)).toEqual([id(202), id(203)]);
  });

  it('reads the paid and refunded orders with a share of the enrollments asked, in id order, in one statement', async () => {
    const { client, calls } = clientOf([]);

    await shareOrdersOf(client, [PROGRAMME]);

    expect(calls).toEqual([
      expect.objectContaining({
        where: {
          enrollmentId: { in: [PROGRAMME] },
          status: { in: ['paid', 'refunded'] },
          teacherSharePiasters: { not: null },
        },
        orderBy: { id: 'asc' },
        select: expect.objectContaining({ kind: true, grossPiasters: true }),
      }),
    ]);
  });
});

describe('shareOrdersOf (006:T012: an instalment’s month)', () => {
  it('answers each order’s month, none but on an instalment, and reads it in the one statement', async () => {
    const { client, calls } = clientOf([
      row(id(201), PROGRAMME, 'assessment', 50_000n, 35_000n),
      row(id(203), PROGRAMME, 'instalment', 100_000n, 70_000n, 1),
      row(id(204), PROGRAMME, 'instalment', 100_000n, 70_000n, 2),
    ]);

    const orders = await shareOrdersOf(client, [PROGRAMME]);

    expect(orders.get(PROGRAMME)?.map(({ instalmentMonth }) => instalmentMonth)).toEqual([
      null,
      1,
      2,
    ]);
    expect(calls).toEqual([
      expect.objectContaining({ select: expect.objectContaining({ instalmentMonth: true }) }),
    ]);
  });
});
