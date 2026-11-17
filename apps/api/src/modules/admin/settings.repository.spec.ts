// T002 of specs/005-certification (R-410; R-PROC-11): the settings table's one writer,
// `update(key, value)`, the panel's (T024). It writes the value of a key the registry names and a
// row holds, and nothing else; a key the registry does not name, or no row holds, is refused with
// the kernel's `SettingError`, naming the key and never the value, and changes nothing.
//
// The table's cases run on the real database inside a transaction that is rolled back, with an
// administrator and the rows they need of their own, so they read no seed and leave nothing; that
// describe carries the tag `database` (T124: skipped unless IJAZAH_DB_SPECS=1).
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { ColumnCipher } from '../../platform/crypto/encryption.js';
import { closeDatabase, type Transaction } from '../../platform/db/prisma.repository.js';
import { SettingError } from '../../platform/settings/settings-reader.js';
import { openSpecDatabase, rolledBack, SPEC_ENCRYPTION_KEY } from './__fixtures__/admin.js';
import { MFA_SECRET_COLUMN } from './admin-users.repository.js';
import { SettingsRepository } from './settings.repository.js';

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
    const { written, before, after } = await rolledBack(database, async (tx) => {
      await stored(tx, REGISTERED, 50, await administrator(tx));
      const rowsBefore = await everyRow(tx);
      await new SettingsRepository(tx).update(REGISTERED, 40);
      const rowsAfter = await everyRow(tx);
      return {
        written: await new SettingsRepository(tx).valueOf(REGISTERED),
        before: rowsBefore.filter(({ key }) => key !== REGISTERED),
        after: rowsAfter.filter(({ key }) => key !== REGISTERED),
      };
    });
    expect(written).toBe(40);
    expect(after).toEqual(before);
  });

  it('refuses a key the registry does not name, even with a row holding it, and changes nothing', async () => {
    const unregistered = `spec_unregistered_${randomUUID().slice(0, 8)}`;
    const { failure, before, after } = await rolledBack(database, async (tx) => {
      await stored(tx, unregistered, 1, await administrator(tx));
      const rowsBefore = await everyRow(tx);
      const refused = await new SettingsRepository(tx)
        .update(unregistered, 987_654)
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
      new SettingsRepository(tx).update('no_such_setting', 1).catch((error: unknown) => error),
    );
    expect(failure).toMatchObject({ key: 'no_such_setting', problem: 'missing' });
  });
});

describe('settings.update when no row holds a registered key (T002)', () => {
  it('is refused rather than reported done', async () => {
    const asked: unknown[] = [];
    const client = {
      setting: {
        updateMany: async (args: unknown) => {
          asked.push(args);
          return { count: 0 };
        },
      },
    } as unknown as ConstructorParameters<typeof SettingsRepository>[0];
    const failure = await new SettingsRepository(client)
      .update(REGISTERED, 40)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SettingError);
    expect(failure).toMatchObject({ key: REGISTERED, problem: 'missing' });
    expect(asked).toEqual([{ where: { key: REGISTERED }, data: { value: 40 } }]);
  });
});
