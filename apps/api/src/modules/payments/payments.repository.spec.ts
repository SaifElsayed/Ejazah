// 006:T005 (R-502) — the order's terms the confirm step decides on: its kind, its instalment's
// month and its per-order marker, read on the caller's transaction (the caller holds the order's
// lock). Over a recording stand-in of the client; the rows against Postgres are
// `tests/db-integrity/programme-confirmation.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  markOrderConfirmed,
  orderTermsOf,
  processedProgrammeOrdersOf,
} from './payments.repository.js';

const PAYMENT = '0199d0a0-0000-7000-8000-0000000007a1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000007e1';

function clientOf(row: unknown) {
  const calls: unknown[] = [];
  const client = {
    payment: {
      findUniqueOrThrow: async (query: unknown) => {
        calls.push(query);
        return row;
      },
    },
  } as unknown as Pick<Transaction, 'payment'>;
  return { client, calls };
}

describe('the order’s terms (006:T005; R-502)', () => {
  it('reads the kind, the month and the marker of the order by its id', async () => {
    const at = new Date('2026-11-05T07:00:00Z');
    const { client, calls } = clientOf({ kind: 'instalment', instalmentMonth: 2, confirmedAt: at });
    await expect(orderTermsOf(client, PAYMENT)).resolves.toStrictEqual({
      kind: 'instalment',
      instalmentMonth: 2,
      confirmedAt: at,
    });
    expect(calls).toEqual([
      {
        where: { id: PAYMENT },
        select: { kind: true, instalmentMonth: true, confirmedAt: true },
      },
    ]);
  });

  it('reads an assessment with no month and no marker as such', async () => {
    const { client } = clientOf({ kind: 'assessment', instalmentMonth: null, confirmedAt: null });
    await expect(orderTermsOf(client, PAYMENT)).resolves.toStrictEqual({
      kind: 'assessment',
      instalmentMonth: null,
      confirmedAt: null,
    });
  });
});

describe('the programme orders the confirm step processed, and its marker (006:T006; R-502, V-3)', () => {
  it('reads the enrollment’s processed months and rest, in the order they were processed', async () => {
    const calls: unknown[] = [];
    const client = {
      payment: {
        findMany: async (query: unknown) => {
          calls.push(query);
          return [
            { kind: 'instalment', instalmentMonth: 1 },
            { kind: 'rest_in_full', instalmentMonth: null },
          ];
        },
      },
    } as unknown as Pick<Transaction, 'payment'>;
    await expect(processedProgrammeOrdersOf(client, ENROLLMENT)).resolves.toStrictEqual([
      { kind: 'instalment', instalmentMonth: 1 },
      { kind: 'rest_in_full', instalmentMonth: null },
    ]);
    expect(calls).toEqual([
      {
        where: {
          enrollmentId: ENROLLMENT,
          kind: { in: ['rest_in_full', 'instalment'] },
          confirmedAt: { not: null },
        },
        orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
        select: { kind: true, instalmentMonth: true },
      },
    ]);
  });

  // 006:T009, PR #156 r2 Follow-up 1: the instant is the database's clock on the marker's own
  // transaction, read under the locks the caller holds, never one the caller read before them.
  it('writes the marker once, only on an order that has none, at the database’s clock under the locks', async () => {
    const calls: unknown[] = [];
    const at = new Date('2026-11-03T08:00:00.123Z');
    const client = {
      $queryRaw: async (...query: unknown[]) => {
        calls.push(`clock ${(query[0] as readonly string[]).join('?')}`);
        return [{ at }];
      },
      payment: {
        updateMany: async (query: unknown) => {
          calls.push(query);
          return { count: 1 };
        },
      },
    } as unknown as Transaction;
    await markOrderConfirmed(client, PAYMENT);
    expect(calls).toEqual([
      'clock SELECT clock_timestamp() AS at',
      { where: { id: PAYMENT, confirmedAt: null }, data: { confirmedAt: at } },
    ]);
  });
});
