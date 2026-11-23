// 003:T126 (SRS DEC-96's last clause; the owner's Q15 (a)): the audit entries of a release's mark and
// unmark name the release and its amount, over the real table. Three releases of one teacher,
// 7,000, 1,750 and 2,800 EGP, are marked, then unmarked, each call through the administrator surface
// on a transaction of its own, keyed through the kernel's idempotency: every entry stays on the
// teacher (`user`) and carries `after: { releaseId, enrollmentId, milestone, amount_piasters }` of its
// own release; the unmark's entry still names it once `unmarkRelease` has cleared the mark's columns
// (the figures come from the read before the write); a replay of either key writes no second entry.
// The three releases share one enrollment, since only their milestones need to differ (the unique
// `(enrollment_id, milestone)`, rule 62).
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
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  type AdminSurfaceServices,
  createAdminContext,
} from '../../apps/api/src/surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
} from '../../apps/api/src/surfaces/procedures.js';
import { unusedAdminServices } from '../../apps/api/src/surfaces/services.fixtures.js';
import { confirmationWorld } from './confirmation-world.js';

const SETTINGS: Record<string, number> = {
  dispute_window_hours: 72,
  idempotency_key_ttl_hours: 24,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const REASON = 'marked by mistake: the transfer did not go through';

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

describe('the mark’s and the unmark’s entries name the release and its amount (003:T126)', () => {
  it('three releases of one teacher, each entry its own, after the unmark clears the mark; a replay writes none', async () => {
    const w = await world();
    const three = [
      { milestone: 'recitation_end', amount: 700_000 },
      { milestone: 'ijazah_half', amount: 175_000 },
      { milestone: 'direct_end', amount: 280_000 },
    ] as const;
    const releases: {
      readonly releaseId: string;
      readonly milestone: (typeof three)[number]['milestone'];
      readonly amount: number;
    }[] = [];
    for (const one of three) {
      const { id } = await database.teacherShareRelease.create({
        data: {
          enrollmentId: w.enrollmentId,
          teacherUserId: w.teacherId,
          milestone: one.milestone,
          amountPiasters: BigInt(one.amount),
          dueAt: new Date('2026-10-07T10:00:00Z'),
        },
        select: { id: true },
      });
      releases.push({ releaseId: id, ...one });
    }
    const adminId = await admin();
    const payouts = createPayoutServices({
      database,
      settings,
      idempotency: new IdempotencyService({ store: new IdempotencyRepository(database), settings }),
      cipher: { decrypt: () => '' },
      log,
    }).admin;
    const written: AuditRecord[] = [];
    const caller = () => {
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
    const keyOf = (call: 'mark' | 'unmark', releaseId: string) =>
      `audit-${call}-${releaseId.replaceAll('-', '')}`;

    for (const { releaseId } of releases) {
      await caller().payouts.mark({ releaseId, idempotencyKey: keyOf('mark', releaseId) });
    }
    for (const { releaseId } of releases) {
      await caller().payouts.unmark({
        releaseId,
        reason: REASON,
        idempotencyKey: keyOf('unmark', releaseId),
      });
    }
    // Replays: the same keys and inputs, answered from the keys' rows.
    const first = releases[0];
    if (first === undefined) throw new Error('no release written');
    await caller().payouts.mark({
      releaseId: first.releaseId,
      idempotencyKey: keyOf('mark', first.releaseId),
    });
    await caller().payouts.unmark({
      releaseId: first.releaseId,
      reason: REASON,
      idempotencyKey: keyOf('unmark', first.releaseId),
    });

    const after = ({ releaseId, milestone, amount }: (typeof releases)[number]) => ({
      releaseId,
      enrollmentId: w.enrollmentId,
      milestone,
      amount_piasters: amount,
    });
    expect(written).toEqual([
      ...releases.map((one) => ({
        adminId,
        action: 'payout_release.marked',
        targetType: 'user',
        targetId: w.teacherId,
        after: after(one),
      })),
      ...releases.map((one) => ({
        adminId,
        action: 'payout_release.unmarked',
        targetType: 'user',
        targetId: w.teacherId,
        reason: REASON,
        after: after(one),
      })),
    ]);
    const rows = await database.teacherShareRelease.findMany({
      where: { id: { in: releases.map(({ releaseId }) => releaseId) } },
      select: { markedAt: true, markedByAdminId: true },
    });
    expect(rows).toEqual(releases.map(() => ({ markedAt: null, markedByAdminId: null })));
  });
});
