// T097 (FR-155; ERD §15 rule 35; specs/002-identity/data-model.md §5): a banned person's deleted
// account leaves its identifiers in `banned_identifiers` as keyed hashes, one row per hash. Each
// probe first writes a valid row, so a refusal is the rule and not a broken row, then the forbidden
// one, as the application role in a transaction that is rolled back (SC-113). Observed red before
// `20261026000100_banned_identifiers`: the table was missing.
import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
  insertStatement,
  type Db,
} from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

async function tryInsert(values: Record<string, unknown>): Promise<string | null> {
  const { sql, params } = await insertStatement(db, 'banned_identifiers', values);
  return attempt(db, sql, params);
}

const INVALID_ENUM_VALUE = '22P02';
const hash = () => randomBytes(32).toString('hex');

describe('banned_identifiers holds one row per keyed hash (T097, ERD §15 rule 35)', () => {
  it('rule 35: a hash is stored once, whatever its kind', async () => {
    await inRollback(db, async () => {
      const identifier = hash();
      expect(await tryInsert({ kind: 'email', identifier_hmac: identifier })).toBeNull();
      expect(await tryInsert({ kind: 'email', identifier_hmac: identifier })).toBe(
        SQLSTATE.uniqueViolation,
      );
      expect(await tryInsert({ kind: 'provider', identifier_hmac: identifier })).toBe(
        SQLSTATE.uniqueViolation,
      );
    });
  });

  it('refuses a row without its hash or with a kind outside email and provider', async () => {
    await inRollback(db, async () => {
      expect(await tryInsert({ kind: 'provider', identifier_hmac: hash() })).toBeNull();
      expect(await tryInsert({ kind: 'email', identifier_hmac: null })).toBe(
        SQLSTATE.notNullViolation,
      );
      // 22P02: `kind` is the `banned_identifier_kind` enum, so another word is not a value of it.
      expect(await tryInsert({ kind: 'phone', identifier_hmac: hash() })).toBe(INVALID_ENUM_VALUE);
    });
  });

  it('has the hash, its kind and created_at, and no other column', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'banned_identifiers' ORDER BY column_name`,
    );
    expect(rows.map(({ column_name: column }) => column)).toEqual([
      'created_at',
      'id',
      'identifier_hmac',
      'kind',
    ]);
  });
});
