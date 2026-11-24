// 003:T127 (SRS DEC-98; ERD changelog row 76, §15 rule 83) — the refund share an end release took off,
// written with its row by the release sweep over the real table: a completed recitation package of
// 1,000 EGP (100,000 pt, the share 70,000) with 100 EGP refunded writes `recitation_end` 63,000 with
// 7,000 taken off; a close on the teacher's stop with the same refund writes `teacher_dropout` with
// nothing taken off, which rule 83 alone admits.
//
// The enrollment is a real row (the foreign key); what the sweep judges it by is handed in (its order,
// its sessions, its cases), so the write is the insert's alone, as `share-release-race.spec.ts` does.
//
// Observed red first: the first case before the field was written; the second under mutant A-8 (the
// writer keeps the refund share on a closing release), which rule 83 refuses, the sweep reporting it.
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
import {
  attempt,
  connectAsApplication,
  type Db,
  inRollback,
  makeEnrollment,
  SQLSTATE,
} from './harness';

let database: Database;
let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db.end();
  await closeDatabase(database);
});

const { world } = confirmationWorld(() => database);
const NOW = new Date('2026-12-01T00:00:00Z');

/** Four sessions, the first `done` delivered and the rest cancelled, the last ending 2026-10-04. */
const sessions = (done: number): EnrollmentSessionRow[] =>
  Array.from({ length: 4 }, (_, index) => ({
    sequenceNumber: index + 1,
    endsAt: new Date(addDays(new Date('2026-10-01T10:00:00Z'), index)),
    status: index < done ? 'done' : 'cancelled_by_admin',
  })) as unknown as EnrollmentSessionRow[];

/** The sweep over one real enrollment, judged by the facts handed in. */
async function sweepOne({
  status,
  done,
  caseReason,
}: {
  readonly status: 'completed' | 'cancelled';
  readonly done: number;
  readonly caseReason?: string;
}) {
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
    refunded_piasters: piasters(10_000),
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
            status,
            sessionCount: 4,
            cancellationReason: status === 'cancelled' ? 'admin' : null,
            programme: null,
          },
        ],
      ]),
    sessionsAmong: async () => new Map([[w.enrollmentId, sessions(done)]]),
    casesAmong: async () =>
      new Map([
        [
          w.enrollmentId,
          caseReason === undefined
            ? []
            : [
                {
                  caseId: w.enrollmentId,
                  reason: caseReason,
                  status: 'resolved' as const,
                  createdAt: NOW,
                },
              ],
        ],
      ]),
    openMattersAmong: async () => new Set(),
    makeupsAmong: async () => new Map(),
    caseRecordOf: async () => null,
  };
  const reported: Error[] = [];
  const run = await createShareReleaseSweep({
    transactions: transactionsOver(database),
    settings: { read: async (_key, schema) => schema.parse(72) },
    log: { info: () => undefined, error: () => undefined, warn: () => undefined },
    pageSize: 10,
    report: (error) => void reported.push(error),
    clock: async () => NOW,
    reads,
    ordersAfter: async (_tx, after) => (after === undefined ? [order] : []),
  }).run();
  const rows = await database.teacherShareRelease.findMany({
    where: { enrollmentId: w.enrollmentId },
    select: { milestone: true, amountPiasters: true, refundTakenOffPiasters: true },
  });
  return { run, rows, reported };
}

describe('the refund share an end release took off (003:T127, rule 83)', () => {
  it('writes recitation_end 63,000 with the 7,000 it took off', async () => {
    const { run, rows } = await sweepOne({ status: 'completed', done: 4 });

    expect(run.failed).toEqual([]);
    expect(rows).toEqual([
      { milestone: 'recitation_end', amountPiasters: 63_000n, refundTakenOffPiasters: 7_000n },
    ]);
  });

  it('writes a closing release with nothing taken off, a refund recorded (mutant A-8: refused)', async () => {
    const { run, rows, reported } = await sweepOne({
      status: 'cancelled',
      done: 2,
      caseReason: 'teacher_ended',
    });

    expect(run.failed).toEqual([]);
    expect(reported).toEqual([]);
    expect(rows).toEqual([
      { milestone: 'teacher_dropout', amountPiasters: 35_000n, refundTakenOffPiasters: 0n },
    ]);
  });
});

// ERD §15 rule 83 (003:T127, R1b; PR #159 r1 Minor 1): never a negative share, and only the three end
// releases take refunds off.
describe('rule 83: the refund share taken off', () => {
  const insert = (
    probe: Db,
    on: { enrollmentId: string; teacherId: string },
    milestone: string,
    refundTakenOff: number,
  ) =>
    attempt(
      probe,
      `INSERT INTO teacher_share_releases
         (enrollment_id, teacher_user_id, milestone, amount_piasters, due_at, refund_taken_off_piasters)
       VALUES ($1, $2, $3::share_release_milestone, 100000, now(), $4)`,
      [on.enrollmentId, on.teacherId, milestone, refundTakenOff],
    );

  it('refuses a negative share on an end release, and a share on direct_end', async () => {
    await inRollback(db, async (probe) => {
      const on = await makeEnrollment(probe);
      expect(await insert(probe, on, 'recitation_end', -1)).toBe(SQLSTATE.checkViolation);
      expect(await insert(probe, on, 'direct_end', 1)).toBe(SQLSTATE.checkViolation);
      expect(await insert(probe, on, 'recitation_end', 1)).toBeNull();
      expect(await insert(probe, on, 'direct_end', 0)).toBeNull();
    });
  });
});
