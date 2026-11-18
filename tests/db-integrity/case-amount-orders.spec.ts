// 003:T110 — the orders a compensation case's amount is computed from, over the real table
// (`case-amount.repository.ts`, ADR 0025 D4): the enrollment's paid orders with a teacher's share, a
// refunded one included, oldest first by the time-ordered id, each with what was paid, the share and
// the refunded total. An order not paid, one from before the commission (no share, ERD §15 rule
// 52's pair) and another enrollment's are left out. The amounts are `case-amount.rules.spec.ts`'s.
//
// Observed red first: against the query stubbed to answer nothing, and the status filter removed
// (mutant M-C16).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { caseOrdersOf } from '../../apps/api/src/modules/payments/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { confirmationWorld } from './confirmation-world.js';

let database: Database;

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const { world, order } = confirmationWorld(() => database);

/** The order's share at 70% (70,000 of its 100,000 piasters) and its refunded total. */
async function withShare(paymentId: string, refunded: number): Promise<void> {
  await database.$executeRaw`
    UPDATE payments SET teacher_share_rate_percent = 70, teacher_share_piasters = 70000,
                        refunded_piasters = ${refunded}
    WHERE id = ${paymentId}::uuid`;
}

describe('a case’s orders (003:T110)', () => {
  it('are the enrollment’s paid orders with a share, a refunded one included, oldest first', async () => {
    const w = await world();
    const paid = await order(w.enrollmentId, 'paid');
    await withShare(paid, 10_000);
    const created = await order(w.enrollmentId, 'created');
    await withShare(created, 0);
    await order(w.enrollmentId, 'paid');
    const refunded = await order(w.enrollmentId, 'refunded');
    await withShare(refunded, 100_000);
    const other = await world();
    await withShare(await order(other.enrollmentId, 'paid'), 0);

    expect(await caseOrdersOf(database, w.enrollmentId)).toEqual([
      {
        paymentId: paid,
        paid_piasters: 100_000,
        share_piasters: 70_000,
        refunded_piasters: 10_000,
      },
      {
        paymentId: refunded,
        paid_piasters: 100_000,
        share_piasters: 70_000,
        refunded_piasters: 100_000,
      },
    ]);
  });
});
