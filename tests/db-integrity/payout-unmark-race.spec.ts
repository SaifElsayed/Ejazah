// 003:T105 — a mark and an unmark of one release at once over the real table (SRS DEC-89, the
// owner's «موافق على الاتنين» of 2026-11-18; ERD §15 rule 63). Each call runs through the
// administrator surface on a transaction of its own; the unmark's step runs first and the mark's
// waits for it, inside both transactions, so the mark meets whatever row lock the unmark's update
// took. Whatever the order, the outcome is consistent:
//
//   - the release ends marked exactly when the successful marks outnumber the successful unmarks
//     from its starting state, and its `marked_at` and `marked_by_admin_id` are both set or both
//     NULL (rule 63);
//   - every call that succeeded wrote its one audit entry and every refused one wrote none, so no
//     entry is lost or invented.
//
// From an unmarked release, the unmark finds nothing marked (CONFLICT) and the mark then marks it.
// From a marked one, the unmark clears it and the mark, which waited on its row lock, marks it again.
//
// Observed red first: the case from an unmarked release against the unmark's update without
// `marked_at IS NOT NULL` (mutant M-B1-30), where the unmark «succeeds» on a release nobody marked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPayoutServices,
  payoutsAdminRouter,
} from '../../apps/api/src/modules/payments/index.js';
import type { AuditRecord } from '../../apps/api/src/platform/audit/audit-writer.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import {
  type AdminSurfaceServices,
  createAdminContext,
} from '../../apps/api/src/surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../apps/api/src/surfaces/procedures.js';
import { unusedAdminServices } from '../../apps/api/src/surfaces/services.fixtures.js';
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
const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const callerFor = createAdminCallerFactory(createAdminRouter({ payouts: payoutsAdminRouter }));
const REASON = 'marked by mistake: the transfer did not go through';

async function admin(): Promise<string> {
  const { id } = await database.adminUser.create({
    data: {
      email: `probe-admin-${randomUUID()}@example.invalid`,
      passwordHash: 'probe-hash',
      mfaSecretEncrypted: Buffer.from('probe'),
      displayName: 'Probe administrator',
      isActive: true,
    },
    select: { id: true },
  });
  return id;
}

interface Outcome {
  readonly mark: 'done' | string;
  readonly unmark: 'done' | string;
  readonly written: readonly AuditRecord[];
  readonly row: { readonly markedAt: Date | null; readonly markedByAdminId: string | null };
}

/** The unmark (by `unmarker`) and the mark (by `marker`) of `releaseId` at once, the unmark's step first. */
async function race(releaseId: string, unmarker: string, marker: string): Promise<Outcome> {
  let unmarkStepped: () => void = () => undefined;
  const unmarkRan = new Promise<void>((resolve) => {
    unmarkStepped = resolve;
  });
  const services = createPayoutServices({
    database,
    settings: { read: async (_key, schema) => schema.parse(72) },
    idempotency: {
      runOn: async <T>(
        tx: Transaction,
        request: { readonly scope: string },
        effect: (on: Transaction) => Promise<T>,
      ): Promise<{ readonly outcome: T; readonly replayed: boolean }> => {
        if (request.scope === 'payouts.unmark') {
          try {
            return { outcome: await effect(tx), replayed: false };
          } finally {
            unmarkStepped();
          }
        }
        await unmarkRan;
        return { outcome: await effect(tx), replayed: false };
      },
    },
    cipher: { decrypt: () => '' },
    log,
  }).admin;
  const written: AuditRecord[] = [];
  const callerAs = (adminId: string) => {
    const pending: AuditRecord[] = [];
    return callerFor(
      createAdminContext({
        session: { adminId, sessionId: adminId, mfaVerified: true },
        log,
        administration: {
          transactions: {
            run: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
              pending.length = 0;
              const answer = await database.$transaction((tx: Transaction) => work(tx), {
                timeout: 30_000,
              });
              written.push(...pending);
              return answer;
            },
          },
          auditWriter: {
            write: async (_tx: Transaction, record: AuditRecord) => {
              pending.push(record);
            },
          },
        } as never,
        services: new Proxy(unusedAdminServices, {
          get: (target, name, receiver) =>
            name === 'payouts' ? services : Reflect.get(target, name, receiver),
        }) as AdminSurfaceServices,
        rateLimiter: { check: async () => undefined } as unknown as RateLimiter,
        clientAddress: '203.0.113.9',
      }),
    );
  };
  const settled = (call: Promise<unknown>): Promise<string> =>
    call.then(
      () => 'done',
      (error: unknown) =>
        (toErrorShape(error as Parameters<typeof toErrorShape>[0]).body as { code: string }).code,
    );
  const [unmark, mark] = await Promise.all([
    settled(
      callerAs(unmarker).payouts.unmark({
        releaseId,
        reason: REASON,
        idempotencyKey: `unmark-race-key-${randomUUID().slice(0, 8)}`,
      }),
    ),
    settled(
      callerAs(marker).payouts.mark({
        releaseId,
        idempotencyKey: `mark-race-key-${randomUUID().slice(0, 8)}`,
      }),
    ),
  ]);
  const row = await database.teacherShareRelease.findUniqueOrThrow({
    where: { id: releaseId },
    select: { markedAt: true, markedByAdminId: true },
  });
  return { mark, unmark, written, row };
}

/** What every order must leave: rule 63's pair, and one entry per success, none per refusal. */
function expectConsistent(outcome: Outcome, startedMarked: boolean): void {
  const { row, written, mark, unmark } = outcome;
  expect(row.markedAt === null).toBe(row.markedByAdminId === null);
  const marks = written.filter(({ action }) => action === 'payout_release.marked').length;
  const unmarks = written.filter(({ action }) => action === 'payout_release.unmarked').length;
  expect(marks).toBe(mark === 'done' ? 1 : 0);
  expect(unmarks).toBe(unmark === 'done' ? 1 : 0);
  expect(row.markedAt !== null).toBe((startedMarked ? 1 : 0) + marks - unmarks > 0);
}

async function release(markedBy?: string): Promise<{ id: string; teacherId: string }> {
  const w = await world();
  const { id } = await database.teacherShareRelease.create({
    data: {
      enrollmentId: w.enrollmentId,
      teacherUserId: w.teacherId,
      milestone: 'recitation_end',
      amountPiasters: 70_000n,
      dueAt: new Date('2026-10-07T10:00:00Z'),
      ...(markedBy === undefined
        ? {}
        : { markedAt: new Date('2026-11-01T09:00:00Z'), markedByAdminId: markedBy }),
    },
    select: { id: true },
  });
  return { id, teacherId: w.teacherId };
}

describe('a mark and an unmark of one release at once (003:T105, DEC-89, rule 63)', () => {
  it('from an unmarked release: the unmark finds nothing marked, the mark marks it', async () => {
    const [unmarker, marker] = [await admin(), await admin()];
    const one = await release();
    const outcome = await race(one.id, unmarker, marker);

    expect({ unmark: outcome.unmark, mark: outcome.mark }).toEqual({
      unmark: 'CONFLICT',
      mark: 'done',
    });
    expect(outcome.row.markedByAdminId).toBe(marker);
    expectConsistent(outcome, false);
  });

  it('from a marked release: the unmark clears it, then the mark that waited marks it again', async () => {
    const [first, unmarker, marker] = [await admin(), await admin(), await admin()];
    const one = await release(first);
    const outcome = await race(one.id, unmarker, marker);

    expect({ unmark: outcome.unmark, mark: outcome.mark }).toEqual({
      unmark: 'done',
      mark: 'done',
    });
    expect(outcome.row.markedByAdminId).toBe(marker);
    expect(
      outcome.written.find(({ action }) => action === 'payout_release.unmarked'),
    ).toMatchObject({
      targetType: 'user',
      targetId: one.teacherId,
      reason: REASON,
    });
    expectConsistent(outcome, true);
  });
});
