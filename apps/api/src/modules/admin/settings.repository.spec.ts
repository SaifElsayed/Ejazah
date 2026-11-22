// T002 of specs/005-certification (R-410; R-PROC-11): the settings table's one writer, `update(key,
// value, adminId)`, the panel's (T024). It writes the value of a key the registry names and a row
// holds, and nothing else; a key the registry does not name, or no row holds, is refused with the
// kernel's `SettingError`, naming the key and never the value, and changes nothing. T024 (the
// follow-up under T024, B45 Q-B2 (a)): it also names the administrator who changed it
// (`updated_by_admin_id`), and answers the value it replaced, read under the row's lock: its first
// statement is the update of `updated_by_admin_id`, which locks the row, then the value is read,
// then written (rule 1, lock then read). `valuesOf` reads the stored values of the keys asked, in
// one statement.
//
// The table's cases run on the real database inside a transaction that is rolled back, with an
// administrator and the rows they need of their own, so they read no seed and leave nothing; that
// describe carries the tag `database` (T124: skipped unless IJAZAH_DB_SPECS=1).
//
// T024's database spec (the lane's brief named `tests/db-integrity/`; R-API-4's lint refuses an
// import of the admin module from outside its tree, and R-API-6's lets only this module's
// repository files reach its tables, so it is the last describe here, tagged `database`): through
// the administrator surface's router, the writer, the kernel's idempotency and the real audit
// writer, each call on a committed transaction of its own. A change writes the value and its
// administrator, and its `setting.changed` row carries the reason, before and after; the same key
// again writes nothing more; a value outside the registry's bounds changes nothing and writes no
// row; two changes of one key at once, the second reads the first's value as «before». The two keys
// it reads are planted where no row holds them (`plantSettings`: CI migrates and never seeds),
// restored in its own teardown, and deleted there if it planted them; its other administrators,
// audit rows and idempotency keys stay, as every committed probe's do (the audit log is
// append-only).
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuditWriter } from '../../platform/audit/audit-writer.js';
import { ColumnCipher } from '../../platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  type Transaction,
} from '../../platform/db/prisma.repository.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { IdempotencyRepository } from '../../platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { createLogger } from '../../platform/logging/logger.js';
import { SETTINGS_REGISTRY } from '../../platform/settings/registry.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import { type AdminSurfaceServices, createAdminContext } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import { openSpecDatabase, rolledBack, SPEC_ENCRYPTION_KEY } from './__fixtures__/admin.js';
import { MFA_SECRET_COLUMN } from './admin-users.repository.js';
import { AuditRepository } from './audit.repository.js';
import { SettingsRepository } from './settings.repository.js';
import { settingsAdminRouter } from './settings.router.js';
import { createSettingsAdministration } from './settings.service.js';

const REGISTERED = 'chat_page_size';

async function administrator(tx: Transaction): Promise<string> {
  const id = randomUUID();
  await tx.adminUser.create({
    data: {
      id,
      email: `settings-writer-${id}@ijazah.test`,
      mfaSecretEncrypted: Uint8Array.from(
        new ColumnCipher(SPEC_ENCRYPTION_KEY).encrypt(
          randomBytes(20).toString('base64url'),
          MFA_SECRET_COLUMN,
          id,
        ),
      ),
      displayName: 'Spec Administrator',
      isActive: true,
    },
  });
  return id;
}

async function stored(tx: Transaction, key: string, value: number, adminId: string): Promise<void> {
  await tx.setting.upsert({
    where: { key },
    create: { key, value, updatedByAdminId: adminId },
    update: { value },
  });
}

/**
 * The rows `keys` names, planted where none holds them: CI migrates its database and never seeds
 * it (`.github/workflows/ci.yml:115`; CI run 44507509934; #150 Saif r1, Major 1). Each key is
 * upserted create-only (`update: {}`) at the registry's default, named to an administrator
 * `administrator` commits, so a row already there is never changed; a row naming that
 * administrator is one this run created. `remove` deletes only those rows, then that administrator
 * once no row names it.
 */
async function plantSettings(
  database: Database,
  keys: readonly string[],
  administrator: () => Promise<string>,
): Promise<{ remove(): Promise<void> }> {
  const planter = await administrator();
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

function everyRow(tx: Transaction) {
  return tx.setting.findMany({
    orderBy: { key: 'asc' },
    select: { key: true, value: true, updatedByAdminId: true, createdAt: true, updatedAt: true },
  });
}

describe('settings.update over the table (T002)', { tags: ['database'] }, () => {
  const database = openSpecDatabase();
  afterAll(() => closeDatabase(database));

  it('writes the value of a registered key and touches no other row', async () => {
    const { written, by, actor, answered, before, after } = await rolledBack(
      database,
      async (tx) => {
        await stored(tx, REGISTERED, 50, await administrator(tx));
        const actor = await administrator(tx);
        const rowsBefore = await everyRow(tx);
        const answered = await new SettingsRepository(tx).update(REGISTERED, 40, actor);
        const rowsAfter = await everyRow(tx);
        return {
          written: await new SettingsRepository(tx).valueOf(REGISTERED),
          by: (await tx.setting.findUniqueOrThrow({ where: { key: REGISTERED } })).updatedByAdminId,
          actor,
          answered,
          before: rowsBefore.filter(({ key }) => key !== REGISTERED),
          after: rowsAfter.filter(({ key }) => key !== REGISTERED),
        };
      },
    );
    expect(written).toBe(40);
    expect(by).toBe(actor);
    expect(answered).toEqual({ before: 50 });
    expect(after).toEqual(before);
  });

  it('refuses a key the registry does not name, even with a row holding it, and changes nothing', async () => {
    const unregistered = `spec_unregistered_${randomUUID().slice(0, 8)}`;
    const { failure, before, after } = await rolledBack(database, async (tx) => {
      await stored(tx, unregistered, 1, await administrator(tx));
      const rowsBefore = await everyRow(tx);
      const refused = await new SettingsRepository(tx)
        .update(unregistered, 987_654, randomUUID())
        .catch((error: unknown) => error);
      return { failure: refused, before: rowsBefore, after: await everyRow(tx) };
    });
    expect(failure).toBeInstanceOf(SettingError);
    expect(failure).toMatchObject({ key: unregistered, problem: 'missing' });
    expect((failure as Error).message).not.toContain('987654');
    expect(after).toEqual(before);
  });

  it('refuses a key neither the registry nor a row knows', async () => {
    const failure = await rolledBack(database, (tx) =>
      new SettingsRepository(tx)
        .update('no_such_setting', 1, randomUUID())
        .catch((error: unknown) => error),
    );
    expect(failure).toMatchObject({ key: 'no_such_setting', problem: 'missing' });
  });
});

/** A stand-in table: every call in order, `updateMany` answering `count`, `findUnique` `value`. */
function recording({ count = 1, value = 50 as unknown } = {}) {
  const calls: unknown[][] = [];
  const client = {
    setting: {
      updateMany: async (args: unknown) => {
        calls.push(['updateMany', args]);
        return { count };
      },
      findUnique: async (args: unknown) => {
        calls.push(['findUnique', args]);
        return { value };
      },
      findMany: async (args: unknown) => {
        calls.push(['findMany', args]);
        return [
          { key: REGISTERED, value: 50 },
          { key: 'join_window_minutes', value: 10 },
        ];
      },
    },
  } as unknown as ConstructorParameters<typeof SettingsRepository>[0];
  return { calls, client };
}

const ACTOR = '0199d0a0-0000-7000-8000-00000000a024';

describe('settings.update when no row holds a registered key (T002)', () => {
  it('is refused rather than reported done, before it reads or writes a value', async () => {
    const { calls, client } = recording({ count: 0 });
    const failure = await new SettingsRepository(client)
      .update(REGISTERED, 40, ACTOR)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SettingError);
    expect(failure).toMatchObject({ key: REGISTERED, problem: 'missing' });
    expect(calls).toEqual([
      ['updateMany', { where: { key: REGISTERED }, data: { updatedByAdminId: ACTOR } }],
    ]);
  });
});

describe('settings.update names its administrator and locks before it reads (T024)', () => {
  it('sets updated_by_admin_id first, which locks the row, then reads the value it replaces, then writes', async () => {
    const { calls, client } = recording({ value: 50 });
    expect(await new SettingsRepository(client).update(REGISTERED, 40, ACTOR)).toEqual({
      before: 50,
    });
    expect(calls).toEqual([
      ['updateMany', { where: { key: REGISTERED }, data: { updatedByAdminId: ACTOR } }],
      ['findUnique', { where: { key: REGISTERED }, select: { value: true } }],
      ['updateMany', { where: { key: REGISTERED }, data: { value: 40 } }],
    ]);
  });
});

describe('settings.valuesOf (T024)', () => {
  it('reads the stored values of the keys asked in one statement, by key', async () => {
    const { calls, client } = recording();
    const values = await new SettingsRepository(client).valuesOf([
      REGISTERED,
      'join_window_minutes',
    ]);
    expect([...values]).toEqual([
      [REGISTERED, 50],
      ['join_window_minutes', 10],
    ]);
    expect(calls).toEqual([
      [
        'findMany',
        {
          where: { key: { in: [REGISTERED, 'join_window_minutes'] } },
          select: { key: true, value: true },
        },
      ],
    ]);
  });
});

describe(
  'settings.update through the administrator surface over the real tables (005:T024)',
  { tags: ['database'] },
  () => {
    /** A key no other probe changes; its schema is a whole number from 1. */
    const KEY = REGISTERED;
    /** A key whose bound is not its schema's: a percent, at most 100 (the registry). */
    const BOUNDED_KEY = 'attendance_threshold_pct';
    const REASON = 'تعديل للاختبار';
    const database = openSpecDatabase();
    const originals = new Map<string, { value: unknown; updatedByAdminId: string }>();
    let planted: { remove(): Promise<void> } | undefined;
    const log = createLogger({ level: 'info', destination: { write: () => undefined } });
    const callerFor = createAdminCallerFactory(
      createAdminRouter({ settings: settingsAdminRouter }),
    );
    const retention: SettingsReader = { read: async (_key, schema) => schema.parse(24) };

    const rowOf = (key: string = KEY) =>
      database.setting.findUniqueOrThrow({
        where: { key },
        select: { value: true, updatedByAdminId: true },
      });

    beforeAll(async () => {
      planted = await plantSettings(database, [KEY, BOUNDED_KEY], committedAdministrator);
      for (const key of [KEY, BOUNDED_KEY]) originals.set(key, await rowOf(key));
    });

    afterAll(async () => {
      // Restored even where a case was refused, so a mutant that writes leaves nothing behind; a
      // row left as it was is not touched, so its `updated_at` stays too. Then the planted rows go.
      try {
        for (const [key, { value, updatedByAdminId }] of originals) {
          const now = await rowOf(key);
          if (now.value === value && now.updatedByAdminId === updatedByAdminId) continue;
          await database.setting.update({
            where: { key },
            data: { value: value as number, updatedByAdminId },
          });
        }
        await planted?.remove();
      } finally {
        await closeDatabase(database);
      }
    });

    async function committedAdministrator(): Promise<string> {
      const { id } = await database.adminUser.create({
        data: {
          email: `settings-probe-${randomUUID()}@example.invalid`,
          passwordHash: 'probe-hash',
          mfaSecretEncrypted: Buffer.from('probe'),
          displayName: 'Settings probe administrator',
          isActive: true,
        },
        select: { id: true },
      });
      return id;
    }

    /** How a call runs: `around` may hold its transaction open after its work, before commit. */
    type Around = (work: () => Promise<unknown>) => Promise<unknown>;

    /**
     * The caller, its services the panel's settings over the real writer, idempotency and audit
     * writer; `entered` is told when the call reaches the writer's `update`.
     */
    function callerAs(
      adminId: string,
      {
        around = (work) => work(),
        entered = () => undefined,
      }: {
        readonly around?: Around;
        readonly entered?: () => void;
      } = {},
    ) {
      const auditWriter: AuditWriter = new AuditRepository();
      const service = createSettingsAdministration({
        idempotency: new IdempotencyService<Transaction>({
          store: new IdempotencyRepository(database),
          settings: retention,
        }),
        log,
        writerOn: (tx) => {
          const writer = new SettingsRepository(tx);
          return {
            valuesOf: (keys) => writer.valuesOf(keys),
            update: (key, value, actor) => {
              entered();
              return writer.update(key, value, actor);
            },
          };
        },
        // 006:T002 (rule d): these cases never turn the programme's switch on.
        retirePreProgrammeIjazahPackages: async () => {
          throw new Error('the programme switch is not turned on in this spec');
        },
        // 006:T004 (rule d): these cases never write the programme's switch.
        lockProgrammeSwitch: async () => {
          throw new Error('the programme switch is not written in this spec');
        },
      });
      return callerFor(
        createAdminContext({
          session: { adminId, sessionId: adminId, mfaVerified: true },
          log,
          administration: {
            transactions: {
              run: <T>(work: (tx: Transaction) => Promise<T>): Promise<T> =>
                database.$transaction((tx: Transaction) => around(() => work(tx)) as Promise<T>, {
                  timeout: 30_000,
                }),
            },
            auditWriter,
          } as never,
          services: new Proxy(unusedAdminServices, {
            get: (target, name, receiver) =>
              name === 'settings' ? service : Reflect.get(target, name, receiver),
          }) as AdminSurfaceServices,
          rateLimiter: { check: async () => undefined } as unknown as RateLimiter,
          clientAddress: '203.0.113.9',
        }),
      );
    }

    const changesBy = (adminId: string) =>
      database.auditLog.findMany({
        where: { adminId, action: 'setting.changed' },
        orderBy: { id: 'asc' },
        select: {
          action: true,
          targetType: true,
          targetId: true,
          reason: true,
          before: true,
          after: true,
        },
      });

    /** A key of idempotency of its own for each call. */
    const freshKey = () => `settings-probe-${randomUUID()}`;

    it('writes the value and its administrator; the audit row carries the reason, before and after; the same key again writes nothing more', async () => {
      const adminId = await committedAdministrator();
      const before = Number((await rowOf()).value);
      const after = before + 7;
      const change = { key: KEY, value: after, reason: REASON, idempotencyKey: freshKey() };

      expect(await callerAs(adminId).settings.update(change)).toEqual({ key: KEY, value: after });
      expect(await rowOf()).toEqual({ value: after, updatedByAdminId: adminId });
      expect(await changesBy(adminId)).toEqual([
        {
          action: 'setting.changed',
          targetType: 'setting',
          targetId: KEY,
          reason: REASON,
          before: { value: before },
          after: { value: after },
        },
      ]);

      // The same key replays the first change: no second write, no second row.
      expect(await callerAs(adminId).settings.update(change)).toEqual({ key: KEY, value: after });
      expect(await changesBy(adminId)).toHaveLength(1);
    });

    it('refuses a value outside the registry’s bounds VALIDATION_FAILED out_of_bounds, changing nothing and writing no row', async () => {
      const adminId = await committedAdministrator();
      const row = await rowOf(BOUNDED_KEY);
      const refused = await callerAs(adminId)
        .settings.update({
          key: BOUNDED_KEY,
          value: 150,
          reason: REASON,
          idempotencyKey: freshKey(),
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(refused).toBeDefined();
      expect(toErrorShape(refused as Parameters<typeof toErrorShape>[0]).body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ path: 'value', code: 'out_of_bounds' }],
      });
      expect(await rowOf(BOUNDED_KEY)).toEqual(row);
      expect(await changesBy(adminId)).toEqual([]);
    });

    it('a second change of the key waits on the first’s lock and reads the first’s value as before', async () => {
      const [first, second] = [await committedAdministrator(), await committedAdministrator()];
      const start = Number((await rowOf()).value);
      const [firstValue, secondValue] = [start + 11, start + 13];

      // The first change holds its transaction open, its row lock taken, until it is let go.
      let letGo: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        letGo = resolve;
      });
      let changed: () => void = () => undefined;
      const firstChanged = new Promise<void>((resolve) => {
        changed = resolve;
      });
      const firstCall = callerAs(first, {
        around: async (work) => {
          const answer = await work();
          changed();
          await held;
          return answer;
        },
      }).settings.update({
        key: KEY,
        value: firstValue,
        reason: REASON,
        idempotencyKey: freshKey(),
      });
      await firstChanged;

      // The second reaches the writer while the first is held; its statements are given time to run
      // as far as they can (this module may not read `pg_stat_activity`: raw SQL is the kernel's,
      // R-API-6). With the code as written that is the lock's wait, so whatever the time, the value
      // it reads is the first's; a read before the lock reads the value both found.
      let reached: () => void = () => undefined;
      const secondReached = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const secondCall = callerAs(second, { entered: () => reached() }).settings.update({
        key: KEY,
        value: secondValue,
        reason: REASON,
        idempotencyKey: freshKey(),
      });
      await secondReached;
      await new Promise((resolve) => setTimeout(resolve, 500));

      letGo();
      await Promise.all([firstCall, secondCall]);

      expect(await rowOf()).toEqual({ value: secondValue, updatedByAdminId: second });
      expect((await changesBy(first)).map(({ before, after }) => [before, after])).toEqual([
        [{ value: start }, { value: firstValue }],
      ]);
      expect((await changesBy(second)).map(({ before, after }) => [before, after])).toEqual([
        [{ value: firstValue }, { value: secondValue }],
      ]);
    });
  },
);
