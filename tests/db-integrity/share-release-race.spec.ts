// 003:T105 — two release sweeps at once over the real table (ADR 0025 D2; ERD §15 rule 62): both
// judge the same enrollment's release due, held at a barrier before either writes, then each writes
// on a transaction of its own. The unique `(enrollment_id, milestone)` with `ON CONFLICT DO NOTHING`
// lets one of them write it: one row, one info line, and no sweep reports a failure.
//
// The enrollment is a real row (the foreign key); what the sweeps judge it by is handed in (its
// order, its sessions, its cases), so the race is the insert's alone. The rules are
// `share-release.rules.spec.ts`'s and the double run `share-release.service.spec.ts`'s.
//
// Observed red first: the case against the insert without `skipDuplicates` (mutant M-B1-19), where the
// second sweep's insert is refused by the unique and reported as a failure.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createShareReleaseSweep,
  type ReleaseReads,
} from '../../apps/api/src/modules/payments/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
import type { EnrollmentSessionRow } from '../../apps/api/src/modules/sessions/index.js';
import { piasters } from '../../packages/money/src/index.js';
import { addDays } from '../../packages/time/src/index.js';
import { confirmationWorld } from './confirmation-world.js';

let database: Database;

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
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

/** A barrier both callers reach before either goes on. */
function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === parties) open();
    await gate;
  };
}

describe('two release sweeps at once (003:T105, rule 62)', () => {
  it('write the release once: one row, one line, no failure', async () => {
    const w = await world();
    const order = {
      paymentId: w.enrollmentId,
      enrollmentId: w.enrollmentId,
      kind: 'package' as const,
      instalmentMonth: null,
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
      caseRecordOf: async () => null,
      makeupsAmong: async () => new Map(),
    };
    const lines: unknown[][] = [];
    const reported: Error[] = [];
    const meet = barrier(2);
    const sweep = () =>
      createShareReleaseSweep({
        transactions: transactionsOver(database),
        settings: { read: async (_key, schema) => schema.parse(72) },
        log: {
          info: (...line: unknown[]) => void lines.push(line),
          error: () => undefined,
          warn: () => undefined,
        },
        pageSize: 10,
        report: (error) => void reported.push(error),
        // Both sweeps judge the release due before either writes it.
        clock: async () => {
          await meet();
          return NOW;
        },
        reads,
        ordersAfter: async (_tx, after) => (after === undefined ? [order] : []),
      });

    const [first, second] = await Promise.all([sweep().run(), sweep().run()]);

    const rows = await database.teacherShareRelease.findMany({
      where: { enrollmentId: w.enrollmentId },
      select: { milestone: true, amountPiasters: true, teacherUserId: true },
    });
    expect(rows).toEqual([
      { milestone: 'recitation_end', amountPiasters: 70_000n, teacherUserId: w.teacherId },
    ]);
    expect([...first.written, ...second.written]).toHaveLength(1);
    expect([...first.failed, ...second.failed]).toEqual([]);
    expect(reported).toEqual([]);
    expect(lines).toHaveLength(1);
  });
});
