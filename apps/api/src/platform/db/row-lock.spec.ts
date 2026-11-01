// T126 — the kernel's row lock without a database: the one statement each table is locked with, its
// ids as one bound array, the order that keeps two callers from deadlocking, and no statement for no
// ids. The lock against Postgres, as the application role, with a second transaction seen waiting on
// it, is `tests/db-integrity/account-locks.spec.ts`; a kernel spec may not write the identity
// module's rows the lock needs (R-API-6, `api/table-ownership`).
import { describe, expect, it } from 'vitest';

import type { Transaction } from './prisma.repository.js';
import { type LockedTable, lockRows } from './row-lock.js';

interface Sent {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** A transaction that records each tagged raw query it is handed, and answers no rows. */
function recordingTransaction(): { readonly tx: Transaction; readonly sent: Sent[] } {
  const sent: Sent[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sent.push({ text: strings.join('$'), values });
      return [];
    },
  } as unknown as Transaction;
  return { tx, sent };
}

const IDS = ['0199d0a0-0000-7000-8000-000000000002', '0199d0a0-0000-7000-8000-000000000001'];

describe('lockRows (T126)', () => {
  it.each<LockedTable>(['users', 'teacher_profiles'])(
    'locks the rows of %s by id, in id order, FOR UPDATE, the ids bound as one uuid array',
    async (table) => {
      const { tx, sent } = recordingTransaction();
      await lockRows(tx, table, IDS);
      expect(sent).toEqual([
        {
          text: `SELECT 1 FROM ${table} WHERE id = ANY($::uuid[]) ORDER BY id FOR UPDATE`,
          values: [IDS],
        },
      ]);
    },
  );

  it('sends no statement for no ids', async () => {
    const { tx, sent } = recordingTransaction();
    await lockRows(tx, 'users', []);
    expect(sent).toEqual([]);
  });
});
