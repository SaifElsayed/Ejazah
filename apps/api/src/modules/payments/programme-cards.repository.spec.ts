// 006:T018 (app-surface.md `programme.get`; R-510, SC-707) — the student's saved card as the read
// shows it: the last four digits and the brand of the programme's row, by its key, and nothing else.
// The token is never selected, so a row that holds it hands on none (a stand-in client answers more
// than asked, and the read still hands on two fields). The rows against Postgres are
// `tests/db-integrity/programme-reads.spec.ts`'.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { programmeCardOf } from './programme-cards.repository.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000018e9';

function clientOf(row: unknown) {
  const calls: unknown[] = [];
  const client = {
    programmeCard: {
      findUnique: async (query: unknown) => {
        calls.push(query);
        return row;
      },
    },
  } as unknown as Pick<Transaction, 'programmeCard'>;
  return { client, calls };
}

describe('programmeCardOf (006:T018, SC-707)', () => {
  it('reads the last four digits and the brand by the enrollment, never the token', async () => {
    const { client, calls } = clientOf({
      last4: '4242',
      brand: 'Visa',
      tokenEncrypted: Uint8Array.from([1, 2, 3]),
      consentedAt: new Date('2026-11-24T10:00:00Z'),
    });
    expect(await programmeCardOf(client, ENROLLMENT)).toStrictEqual({
      last4: '4242',
      brand: 'Visa',
    });
    expect(calls).toEqual([
      { where: { enrollmentId: ENROLLMENT }, select: { last4: true, brand: true } },
    ]);
  });

  it('answers null with no card saved', async () => {
    const { client } = clientOf(null);
    expect(await programmeCardOf(client, ENROLLMENT)).toBeNull();
  });
});
