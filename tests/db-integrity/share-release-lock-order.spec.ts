// 003:T105, PR #149's review, round 1, Major 1 (T005 rule 2; specs/004-sessions/contracts/kernel.md,
// the `release-teacher-shares` insert's row): the sweep's insert of a release references the
// teacher's account and the enrollment. Its foreign-key checks key-share the enrollment before the
// account (the order the keys were created in), so without a lock taken first it holds the
// enrollment while it waits on the account. A path in the one order holds the teacher's `users` row
// FOR UPDATE and then takes the enrollment FOR UPDATE (`chat.send` by the teacher does), and the two
// deadlock. The insert takes the account's key-share first (`keyShareRows`), in the account's place
// of the order, so it waits on the account before it touches the enrollment, and both commit.
//
// The sweep is the real one with its real insert; what it judges the release by is handed in (the
// order, the sessions, the cases), as in `share-release-race.spec.ts`, so the race is the insert's.
//
// Observed red first: on the code before the fix, the sweep's insert dies `40P01` and the sweep
// reports the failure (Saif's probe, `review\r1-runs\05-probe-fk-order.spec.ts.txt`, in the sweep's
// shape); then the mutant M-R1-1 (the `keyShareRows` call removed) goes red the same way.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createShareReleaseSweep,
  type ReleaseReads,
} from '../../apps/api/src/modules/payments/index.js';
import type { EnrollmentSessionRow } from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
import { piasters } from '../../packages/money/src/index.js';
import { addDays } from '../../packages/time/src/index.js';
import { confirmationWorld } from './confirmation-world.js';

let database: Database;

beforeAll(() => {
  // A short statement timeout, so a lock that is never granted ends the run instead of holding it.
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 10_000,
    idleInTransactionTimeoutMs: 20_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const { world } = confirmationWorld(() => database);
const NOW = new Date('2026-12-01T00:00:00Z');

/** Four sessions, every one delivered, the last ending on 2026-10-04. */
const delivered = (): EnrollmentSessionRow[] =>
  Array.from({ length: 4 }, (_, index) => ({
    sequenceNumber: index + 1,
    endsAt: new Date(addDays(new Date('2026-10-01T10:00:00Z'), index)),
    status: 'done',
  })) as unknown as EnrollmentSessionRow[];

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The cause of a failure: the deadlock or the timeout, not the whole message. */
function causeOf(error: Error): string {
  const at = error.message.search(/deadlock|40P01|timeout|canceling|violates/i);
  return at < 0 ? error.message.slice(-300) : error.message.slice(at, at + 160);
}

describe('the sweep insert against a path in the one order (003:T105, T005 rule 2)', () => {
  it('the teacher’s account FOR UPDATE then the enrollment, against the sweep writing that enrollment’s release: both commit', async () => {
    const w = await world();
    const order = {
      paymentId: w.enrollmentId,
      enrollmentId: w.enrollmentId,
      kind: 'package' as const,
      paid_piasters: piasters(100_000),
      share_piasters: piasters(70_000),
      sharePercent: 70,
      halfPercent: null,
      refunded_piasters: piasters(0),
    };
    const reads: ReleaseReads = {
      shareOrdersOf: async () => new Map([[w.enrollmentId, [order]]]),
      releasesOf: async () => [],
      enrollmentsAmong: async () =>
        new Map([
          [
            w.enrollmentId,
            {
              enrollmentId: w.enrollmentId,
              teacherUserId: w.teacherId,
              studentUserId: w.studentId,
              track: 'recitation' as const,
              status: 'completed' as const,
              sessionCount: 4,
              cancellationReason: null,
              programme: null,
            },
          ],
        ]),
      sessionsAmong: async () => new Map([[w.enrollmentId, delivered()]]),
      casesAmong: async () => new Map([[w.enrollmentId, []]]),
      openMattersAmong: async () => new Set(),
      makeupsAmong: async () => new Map(),
    };
    const reported: Error[] = [];
    const sweep = createShareReleaseSweep({
      transactions: transactionsOver(database),
      settings: { read: async (_key, schema) => schema.parse(72) },
      log: { info: () => undefined, error: () => undefined, warn: () => undefined },
      pageSize: 10,
      report: (error) => void reported.push(error),
      clock: async () => NOW,
      reads,
      ordersAfter: async (_tx, after) => (after === undefined ? [order] : []),
    });

    let releasePath: () => void = () => undefined;
    const pathMayGoOn = new Promise<void>((resolve) => {
      releasePath = resolve;
    });
    const path = database.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${w.teacherId}::uuid FOR UPDATE`;
        await pathMayGoOn;
        await tx.$queryRaw`SELECT id FROM enrollments WHERE id = ${w.enrollmentId}::uuid FOR UPDATE`;
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
    // The path holds the account before the sweep starts.
    await pause(300);
    const run = sweep.run();
    // The sweep's insert is waiting before the path takes the enrollment.
    await pause(800);
    releasePath();

    const [pathOutcome, runOutcome] = await Promise.allSettled([path, run]);
    expect(pathOutcome.status === 'rejected' ? causeOf(pathOutcome.reason as Error) : 'committed').toBe(
      'committed',
    );
    expect(reported.map(causeOf)).toEqual([]);
    expect(runOutcome.status === 'fulfilled' ? runOutcome.value.failed : 'rejected').toEqual([]);

    const rows = await database.teacherShareRelease.findMany({
      where: { enrollmentId: w.enrollmentId },
      select: { milestone: true, amountPiasters: true, teacherUserId: true },
    });
    expect(rows).toEqual([
      { milestone: 'recitation_end', amountPiasters: 70_000n, teacherUserId: w.teacherId },
    ]);
  }, 30_000);
});
