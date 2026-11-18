// 003:T105 — two administrators mark the same due release at once, «تم الصرف», over the real table
// (SRS DEC-89; ERD §15 rule 63): both open their transactions, held at a barrier, then both make the
// conditional update `WHERE marked_at IS NULL`, each on a transaction of its own through the
// administrator surface. Postgres re-reads the row the second waited on, finds it marked, and updates
// nothing: one mark, its administrator and instant set together, one `payout_release.marked` entry,
// and the other call refused CONFLICT.
//
// Observed red first: the case against the update without `marked_at IS NULL` (mutant M-B1-20),
// where both calls mark and two entries are written.
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

describe('two marks of one release at once (003:T105, rule 63)', () => {
  it('mark it once, write one entry, and refuse the other CONFLICT', async () => {
    const w = await world();
    const release = await database.teacherShareRelease.create({
      data: {
        enrollmentId: w.enrollmentId,
        teacherUserId: w.teacherId,
        milestone: 'recitation_end',
        amountPiasters: 70_000n,
        dueAt: new Date('2026-10-07T10:00:00Z'),
      },
      select: { id: true },
    });
    const admins = [await admin(), await admin()];
    const meet = barrier(2);
    const payouts = createPayoutServices({
      database,
      settings: { read: async (_key, schema) => schema.parse(72) },
      // Each call its own key, and both inside their transactions before either reads the release:
      // the race is the conditional update's, not the key's.
      idempotency: {
        runOn: async <T>(
          tx: Transaction,
          _request: unknown,
          effect: (on: Transaction) => Promise<T>,
        ): Promise<{ readonly outcome: T; readonly replayed: boolean }> => {
          await meet();
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
              name === 'payouts' ? payouts : Reflect.get(target, name, receiver),
          }) as AdminSurfaceServices,
          rateLimiter: { check: async () => undefined } as unknown as RateLimiter,
          clientAddress: '203.0.113.9',
        }),
      );
    };

    const outcomes = await Promise.allSettled(
      admins.map((adminId, index) =>
        callerAs(adminId).payouts.mark({
          releaseId: release.id,
          idempotencyKey: `mark-race-key-000${String(index)}`,
        }),
      ),
    );

    const refusals = outcomes.flatMap((outcome) =>
      outcome.status === 'rejected'
        ? [
            (
              toErrorShape(outcome.reason as Parameters<typeof toErrorShape>[0]).body as {
                code: string;
              }
            ).code,
          ]
        : [],
    );
    expect(refusals).toEqual(['CONFLICT']);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      action: 'payout_release.marked',
      targetType: 'user',
      targetId: w.teacherId,
    });
    const row = await database.teacherShareRelease.findUniqueOrThrow({
      where: { id: release.id },
      select: { markedAt: true, markedByAdminId: true },
    });
    expect(row.markedAt).not.toBeNull();
    expect(row.markedByAdminId).toBe(written[0]?.adminId);
  });
});
