// Quickstart §3.1 (B49 lane H; FR-613; SRS §3.14 as amended by DEC-71): a report past the limit of
// a day answers `RATE_LIMITED`, through the user surface's real `reports.create` (moderation's
// router and service over the real tables, the `Pairings` bound as `main.ts` binds them) and the
// process's real limiter (`createRateLimiter`, as `main.ts` builds it), counting in the Redis at
// `REDIS_URL`, the limit read from the `settings` row `rate_limit_user_report`, never a constant.
//
// One student reports the visible profiles of as many teachers as the row's limit (one open report
// per reporter, reported user and context, so each report a teacher of its own), each answered
// `received`; one more, to a teacher of its own too, answers `RATE_LIMITED` with nothing written,
// and the limiter's first refusal is logged with ids only. The settings reader here reads the table
// (the admin module's reader is out of this file's reach, R-API-4); the counter's key is the
// subject's HMAC under a key drawn for this file, so no earlier run's count is met, and it expires
// with its window. Its rows are committed, accounts of its own; nothing is deleted but what
// `plantSettings` planted: the settings rows it reads, where no row held them (CI migrates and
// never seeds; CI run 44507509934), and their administrator.
//
// Red first under the mutant «the report limit's key is `rate_limit_ijazah_request`» (ten an hour)
// in `reports.router.ts`: the sixth report is received (lane H's `runs\lane-h\`).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { paired, partyOfEnrollment } from '../../apps/api/src/modules/booking/index';
import { createUserReports, reportsRouter } from '../../apps/api/src/modules/moderation/index';
import { partyOfSession } from '../../apps/api/src/modules/sessions/index';
import type { Database, Transaction } from '../../apps/api/src/platform/db/prisma.repository';
import {
  createRateLimiter,
  rateLimitSetting,
} from '../../apps/api/src/platform/guards/rate-limit.guard';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository';
import {
  IDEMPOTENCY_RETENTION_SETTING,
  IdempotencyService,
} from '../../apps/api/src/platform/idempotency/idempotency.service';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import { SETTINGS_REGISTRY } from '../../apps/api/src/platform/settings/registry';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader';
import {
  type AppServices,
  createAppContext,
  type UserSession,
} from '../../apps/api/src/surfaces/context';
import { createAppCallerFactory, createAppRouter } from '../../apps/api/src/surfaces/procedures';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../apps/api/src/surfaces/services.fixtures';
import { closeDatabase, openSpecDatabase, worldOn } from './report-world';

/** The key the step names, written out: the spec pins it, so it never follows the router's constant. */
const REPORT_LIMIT_KEY = 'rate_limit_user_report';
const REASON = 'كلام غير لائق';

let database: Database;
let planted: { remove(): Promise<void> } | undefined;
const lines: string[] = [];

/**
 * The rows `keys` names, planted where none holds them: CI migrates its database and never seeds
 * it (`.github/workflows/ci.yml:115`; CI run 44507509934; #150 Saif r1, Major 1). Each key is
 * upserted create-only (`update: {}`) at the registry's default, named to an administrator of this
 * file's own, so a row already there is never changed; a row naming that administrator is one this
 * run created. `remove` deletes only those rows, then that administrator once no row names it.
 */
async function plantSettings(keys: readonly string[]): Promise<{ remove(): Promise<void> }> {
  const planter = await worldOn(database as unknown as Transaction).admin();
  const created: string[] = [];
  for (const key of keys) {
    const entry = SETTINGS_REGISTRY[key];
    if (entry === undefined) throw new Error(`No registry entry to plant ${key} at`);
    const { updatedByAdminId } = await database.setting.upsert({
      where: { key },
      create: { key, value: entry.default, updatedByAdminId: planter },
      update: {},
      select: { updatedByAdminId: true },
    });
    if (updatedByAdminId === planter) created.push(key);
  }
  return {
    async remove() {
      if (created.length > 0) {
        await database.setting.deleteMany({ where: { key: { in: created } } });
      }
      if ((await database.setting.count({ where: { updatedByAdminId: planter } })) === 0) {
        await database.adminUser.delete({ where: { id: planter } });
      }
    },
  };
}

beforeAll(async () => {
  database = openSpecDatabase();
  // Every key `tableSettings` is asked for on this path: the limit the router declares (the
  // limiter's only read, `rate-limit.guard.ts:263`; the signed-in default is not read for a
  // procedure that declares its own, `procedures.ts:590-592`) and the retention the idempotency
  // service reads (`idempotency.service.ts:215`, `:273`).
  planted = await plantSettings([REPORT_LIMIT_KEY, IDEMPOTENCY_RETENTION_SETTING]);
});

afterAll(async () => {
  if (database === undefined) return;
  try {
    await planted?.remove();
  } finally {
    await closeDatabase(database);
  }
});

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (url === undefined || url === '') throw new Error('REDIS_URL is not set in the environment');
  return url;
}

/** The `settings` table read as a reader: a row missing or refused by the schema fails closed. */
function tableSettings(): SettingsReader {
  return {
    async read(key, schema) {
      const row = await database.setting.findUnique({ where: { key }, select: { value: true } });
      if (row === null) throw new SettingError(key, 'missing');
      const parsed = schema.safeParse(row.value);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
}

/** The user surface's `reports` namespace over the real service, limiter and tables. */
function callerFor(session: UserSession) {
  const settings = tableSettings();
  const log = createLogger({ level: 'info', destination: { write: (line) => lines.push(line) } });
  const reports = createUserReports({
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    // As `main.ts` binds the `Pairings` (005:T011, Q-X1).
    pairings: { partyOfSession, partyOfEnrollment, paired },
    settings,
  });
  const services = {
    settings,
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    teacherProfile: unusedTeacherProfileServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
    catalog: unusedCatalogServices,
    moderation: { reports },
  } as unknown as AppServices;
  const rateLimiter = createRateLimiter({
    redisUrl: redisUrl(),
    settings,
    log,
    encryptionKey: randomBytes(32).toString('base64'),
  });
  return createAppCallerFactory(createAppRouter({ reports: reportsRouter }))(
    createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

async function codeOf(attempt: Promise<unknown>): Promise<string | undefined> {
  const thrown: unknown = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) return undefined;
  return (thrown as { cause?: { code?: string } }).cause?.code;
}

describe('a report past the day’s limit answers RATE_LIMITED (quickstart §3.1, FR-613)', () => {
  it('as many reports as the setting allows are received; the next is refused by the limiter, nothing written', async () => {
    const stored = await database.setting.findUniqueOrThrow({
      where: { key: REPORT_LIMIT_KEY },
      select: { value: true },
    });
    const { limit } = rateLimitSetting.parse(stored.value);
    const world = worldOn(database as unknown as Transaction);
    const studentId = await world.person('female');
    const teachers: string[] = [];
    for (let made = 0; made <= limit; made += 1) {
      teachers.push((await world.teacher('female')).teacherId);
    }
    const reporter = callerFor({
      userId: studentId,
      sessionId: randomUUID(),
      role: 'student',
      accountStatus: 'active',
      gender: 'female',
      preferredLanguage: 'ar',
    });
    const report = (reportedUserId: string) =>
      reporter.reports.create({
        reportedUserId,
        context: 'profile',
        reason: REASON,
        idempotencyKey: `report-limit-${randomUUID()}`,
      });

    for (const teacherId of teachers.slice(0, limit)) {
      expect(await report(teacherId), teacherId).toEqual({ received: true });
    }
    const last = teachers[limit] ?? '';
    expect(await codeOf(report(last))).toBe('RATE_LIMITED');

    const written = await database.userReport.findMany({
      where: { reporterUserId: studentId },
      select: { reportedUserId: true },
    });
    expect(written.map(({ reportedUserId }) => reportedUserId).sort()).toEqual(
      teachers.slice(0, limit).sort(),
    );
    const refusals = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter(({ msg }) => msg === 'rate limit refused');
    expect(refusals).toEqual([
      expect.objectContaining({ procedure: 'reports.create', userId: studentId }),
    ]);
    expect(lines.join('\n')).not.toContain(REASON);
  });
});
