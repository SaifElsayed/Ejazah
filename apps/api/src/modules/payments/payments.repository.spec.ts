// 006:T005 (R-502) — the order's terms the confirm step decides on: its kind, its instalment's
// month and its per-order marker, read on the caller's transaction (the caller holds the order's
// lock). Over a recording stand-in of the client; the rows against Postgres are
// `tests/db-integrity/programme-confirmation.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { orderTermsOf } from './payments.repository.js';

const PAYMENT = '0199d0a0-0000-7000-8000-0000000007a1';

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
