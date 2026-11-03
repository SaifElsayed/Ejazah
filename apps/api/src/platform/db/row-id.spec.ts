// T036 — a row's id drawn before its row is written (the note under T036 of 2026-11-03: `checkout.pay`
// hands the enrollment's id to `createCheckout` before the transaction that writes the enrollment).
// Without a database: the one statement it sends, and that it answers the id the database drew.
// Against Postgres, where `uuidv7()` is the tables' own default: the database spec at the end,
// tagged `database` (T124).
import { afterAll, describe, expect, it } from 'vitest';

import { drawRowId } from './row-id.js';
import { closeDatabase, type Database, openDatabase } from './prisma.repository.js';
import { specDatabaseUrl } from './spec-database.fixtures.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('drawRowId (T036)', () => {
  it('asks the database for one uuidv7, the tables’ own default, and answers it', async () => {
    const sent: string[] = [];
    const database = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        sent.push(strings.join('$'));
        return [{ id: '0199d0a0-0000-7000-8000-000000000001' }];
      },
    } as unknown as Pick<Database, '$queryRaw'>;
    await expect(drawRowId(database)).resolves.toBe('0199d0a0-0000-7000-8000-000000000001');
    expect(sent).toEqual(['SELECT uuidv7()::text AS id']);
  });
});

describe('drawRowId against Postgres (T036)', { tags: ['database'] }, () => {
  let database: Database | undefined;
  afterAll(async () => {
    if (database !== undefined) await closeDatabase(database);
  });

  it('draws distinct UUIDv7 ids in their creation order', async () => {
    database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
      poolMax: 1,
      statementTimeoutMs: 30_000,
      idleInTransactionTimeoutMs: 30_000,
    });
    const first = await drawRowId(database);
    const second = await drawRowId(database);
    expect(first).toMatch(UUID_V7);
    expect(second).toMatch(UUID_V7);
    expect(first < second).toBe(true);
  });
});
