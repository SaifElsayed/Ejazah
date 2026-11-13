// T069 of specs/004-sessions/tasks.md (B42a) — the migration `20261113120000_ban_restorable_and_kept_data`
// on this database: its columns, rule 50, rule 34 and rule 27 as widened, the two enum values and
// the held closings' partial index (ERD §14 and §15; specs/004-sessions/data-model.md §2.13; SRS
// DEC-66, DEC-67). Rule 49 as widened is probed beside its first form, in sessions-pass.spec.ts.
//
// As in sessions-pass.spec.ts: each probe first writes the rows a rule admits, so a refusal is the
// rule and not a broken row, then each forbidden one, expecting its SQLSTATE (23514 a check, 23505
// a unique); a catalogue case holds each constraint and index by name; every probe runs as the
// application role in a transaction that is rolled back.
//
// What spans two tables is not a check: every document of a deleted person that still holds its
// key is kept or erased (rule 34's note). It is held by the deletion's own path, so it is proved
// here through the real deletion, as `main.ts` composes it (account-deletion.spec.ts's harness),
// which commits its rows as that spec's do.
//
// Observed red (N8 of B42a's conflict check): each check and index case first against a mutant of
// the migration that adds the columns without them, a column never missing; the enum values and the
// catalogue against the database before the migration; the deletion's case against a mutant of
// `documentErasureConsequence` that marks nothing. Each mutant restored and `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AccountConsequences,
  createIdentityServices,
} from '../../apps/api/src/modules/identity/index.js';
import {
  createDocumentErasure,
  documentErasureConsequence,
} from '../../apps/api/src/modules/verification/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import { hashPassword } from '../../apps/api/src/platform/crypto/hashing.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures.js';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
  insertRow,
  insertStatement,
  makeEnrollment,
  makeUser,
  type Db,
} from './harness';

const INSTANT = '2026-11-13T09:00:00Z';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

/** The SQLSTATE an insert of `values` into `table` is refused with, or null when accepted. */
async function tryInsert(table: string, values: Record<string, unknown>): Promise<string | null> {
  const { sql, params } = await insertStatement(db, table, values);
  return attempt(db, sql, params);
}

/** The names of a table's check constraints, in name order. */
async function checksOf(table: string): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `SELECT conname AS name FROM pg_constraint
      WHERE contype = 'c' AND conrelid = $1::regclass ORDER BY conname`,
    [table],
  );
  return rows.map(({ name }) => name);
}

/** The definition of one index, as the database prints it. */
async function indexDefinition(name: string): Promise<string | undefined> {
  const { rows } = await db.query<{ definition: string }>(
    `SELECT indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
    [name],
  );
  return rows[0]?.definition;
}

/** A teacher's profile row of `userId`, with the columns given. */
function profile(userId: string, values: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: userId,
    bio: 'Probe',
    qualification_summary: 'Probe',
    verification_status: 'pending',
    ...values,
  };
}

/** A document row of `userId`'s holding a key, with the columns given. */
function document(userId: string, values: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: userId,
    document_type: 'national_id',
    storage_key_encrypted: Buffer.from('probe'),
    ...values,
  };
}

describe('the migration on ijazah_integrity: its columns, each NULL on every row it found (T069)', () => {
  it('adds the eight columns, each nullable, with its type', async () => {
    const { rows } = await db.query<{ column: string; type: string; nullable: string }>(
      `SELECT table_name || '.' || column_name AS column, udt_name AS type, is_nullable AS nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
                ('users', 'banned_at'), ('enrollments', 'slot_released_at'),
                ('teacher_profiles', 'kept_at'), ('teacher_profiles', 'kept_erase_at'),
                ('teacher_profiles', 'kept_erased_at'),
                ('teacher_profiles', 'verification_status_before_ban'),
                ('teacher_profiles', 'application_status_before_ban'),
                ('verification_documents', 'kept_at'))
        ORDER BY 1`,
    );
    expect(rows).toEqual([
      { column: 'enrollments.slot_released_at', type: 'timestamptz', nullable: 'YES' },
      {
        column: 'teacher_profiles.application_status_before_ban',
        type: 'teacher_application_status',
        nullable: 'YES',
      },
      { column: 'teacher_profiles.kept_at', type: 'timestamptz', nullable: 'YES' },
      { column: 'teacher_profiles.kept_erase_at', type: 'timestamptz', nullable: 'YES' },
      { column: 'teacher_profiles.kept_erased_at', type: 'timestamptz', nullable: 'YES' },
      {
        column: 'teacher_profiles.verification_status_before_ban',
        type: 'teacher_verification_status',
        nullable: 'YES',
      },
      { column: 'users.banned_at', type: 'timestamptz', nullable: 'YES' },
      { column: 'verification_documents.kept_at', type: 'timestamptz', nullable: 'YES' },
    ]);
  });

  it('admits a profile holding the two statuses before a ban, each of its own enum', async () => {
    await inRollback(db, async () => {
      // An applicant banned while asked for a document: `needs_document` is the application's
      // word only, so each column is seen to carry its own enum.
      const userId = await makeUser(db, { account_status: 'banned', banned_at: INSTANT });
      expect(
        await tryInsert(
          'teacher_profiles',
          profile(userId, {
            verification_status: 'banned',
            application_status: 'banned',
            verification_status_before_ban: 'pending',
            application_status_before_ban: 'needs_document',
          }),
        ),
      ).toBeNull();
    });
  });
});

describe('ERD §15 rule 50: a ban’s instant only on a banned account (T069)', () => {
  it('admits banned_at on a banned account, and none on every status', async () => {
    await inRollback(db, async () => {
      expect(
        await tryInsert(
          'users',
          await userValues({ account_status: 'banned', banned_at: INSTANT }),
        ),
      ).toBeNull();
      for (const status of ['active', 'suspended', 'verification_required', 'banned']) {
        expect(await tryInsert('users', await userValues({ account_status: status }))).toBeNull();
      }
    });
  });

  it('refuses banned_at on an account that is not banned, and a lift that leaves it behind', async () => {
    await inRollback(db, async () => {
      for (const status of ['active', 'suspended', 'verification_required']) {
        expect(
          await tryInsert(
            'users',
            await userValues({ account_status: status, banned_at: INSTANT }),
          ),
          status,
        ).toBe(SQLSTATE.checkViolation);
      }
      const banned = await makeUser(db, { account_status: 'banned', banned_at: INSTANT });
      expect(
        await attempt(db, `UPDATE users SET account_status = 'active' WHERE id = $1`, [banned]),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await attempt(
          db,
          `UPDATE users SET account_status = 'active', banned_at = NULL WHERE id = $1`,
          [banned],
        ),
      ).toBeNull();
    });
  });

  it('holds its check by name', async () => {
    expect(await checksOf('users')).toEqual(expect.arrayContaining(['users_banned_at_check']));
  });
});

/** A users row through the harness's own columns, without inserting it. */
async function userValues(values: Record<string, unknown>): Promise<Record<string, unknown>> {
  return {
    email: `probe-${randomUUID()}@example.invalid`,
    gender: 'male',
    date_of_birth: '1990-01-01',
    display_name: 'Probe user',
    preferred_language: 'ar',
    timezone: 'Africa/Cairo',
    ...values,
  };
}

describe('ERD §15 rule 34, widened: a document kept or erased, never both (T069)', () => {
  it('admits a document neither kept nor erased, a kept one holding its key, and an erased one with or without its key', async () => {
    await inRollback(db, async () => {
      const userId = await makeUser(db);
      expect(await tryInsert('verification_documents', document(userId))).toBeNull();
      expect(
        await tryInsert('verification_documents', document(userId, { kept_at: INSTANT })),
      ).toBeNull();
      expect(
        await tryInsert('verification_documents', document(userId, { erased_at: INSTANT })),
      ).toBeNull();
      expect(
        await tryInsert(
          'verification_documents',
          document(userId, { erased_at: INSTANT, storage_key_encrypted: null }),
        ),
      ).toBeNull();
    });
  });

  it('refuses a document both kept and erased, with or without its key, and a kept one with no key', async () => {
    await inRollback(db, async () => {
      const userId = await makeUser(db);
      expect(
        await tryInsert(
          'verification_documents',
          document(userId, { kept_at: INSTANT, erased_at: INSTANT }),
        ),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryInsert(
          'verification_documents',
          document(userId, { kept_at: INSTANT, erased_at: INSTANT, storage_key_encrypted: null }),
        ),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryInsert(
          'verification_documents',
          document(userId, { kept_at: INSTANT, storage_key_encrypted: null }),
        ),
      ).toBe(SQLSTATE.checkViolation);
      const kept = await insertRow(
        db,
        'verification_documents',
        document(userId, { kept_at: INSTANT }),
      );
      expect(
        await attempt(db, `UPDATE verification_documents SET erased_at = $2 WHERE id = $1`, [
          kept,
          INSTANT,
        ]),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('holds its two checks by name', async () => {
    expect(await checksOf('verification_documents')).toEqual(
      expect.arrayContaining([
        'verification_documents_erased_key_check',
        'verification_documents_kept_or_erased_check',
      ]),
    );
  });
});

describe('ERD §15 rule 27, widened: the payout hash unique among the profiles not kept (T069, Q-E (a))', () => {
  it('admits a live profile and a kept one holding one hash, and two kept ones', async () => {
    await inRollback(db, async () => {
      const hash = `payout-${randomUUID()}`;
      const [kept, otherKept, live] = [await makeUser(db), await makeUser(db), await makeUser(db)];
      expect(
        await tryInsert(
          'teacher_profiles',
          profile(kept, { payout_account_ref_hash: hash, kept_at: INSTANT }),
        ),
      ).toBeNull();
      expect(
        await tryInsert(
          'teacher_profiles',
          profile(otherKept, { payout_account_ref_hash: hash, kept_at: INSTANT }),
        ),
      ).toBeNull();
      expect(
        await tryInsert('teacher_profiles', profile(live, { payout_account_ref_hash: hash })),
      ).toBeNull();
    });
  });

  it('refuses two live profiles holding one hash, and a kept one returned to live beside a live one', async () => {
    await inRollback(db, async () => {
      const hash = `payout-${randomUUID()}`;
      const [first, second, third] = [await makeUser(db), await makeUser(db), await makeUser(db)];
      expect(
        await tryInsert('teacher_profiles', profile(first, { payout_account_ref_hash: hash })),
      ).toBeNull();
      expect(
        await tryInsert('teacher_profiles', profile(second, { payout_account_ref_hash: hash })),
      ).toBe(SQLSTATE.uniqueViolation);
      const kept = await insertRow(
        db,
        'teacher_profiles',
        profile(third, { payout_account_ref_hash: hash, kept_at: INSTANT }),
      );
      expect(
        await attempt(db, `UPDATE teacher_profiles SET kept_at = NULL WHERE id = $1`, [kept]),
      ).toBe(SQLSTATE.uniqueViolation);
    });
  });

  it('holds its partial unique by name, over the profiles not kept', async () => {
    expect(await indexDefinition('teacher_profiles_payout_account_ref_hash_key')).toBe(
      'CREATE UNIQUE INDEX teacher_profiles_payout_account_ref_hash_key ON public.teacher_profiles USING btree (payout_account_ref_hash) WHERE (kept_at IS NULL)',
    );
  });
});

describe('enrollment_event_kind gains slot_released and slot_hold_ended (T069; FR-503, FR-505)', () => {
  it('holds the eight kinds, the two new ones last', async () => {
    const { rows } = await db.query<{ label: string }>(
      `SELECT unnest(enum_range(NULL::enrollment_event_kind))::text AS label`,
    );
    expect(rows.map(({ label }) => label)).toEqual([
      'confirmed',
      'order_failed',
      'cancelled',
      'completed',
      'terminated_no_show',
      'restored',
      'slot_released',
      'slot_hold_ended',
    ]);
  });

  it('admits a row of each new kind, with no reason and no payment (rule 39)', async () => {
    await inRollback(db, async () => {
      const { enrollmentId } = await makeEnrollment(db);
      for (const kind of ['slot_released', 'slot_hold_ended']) {
        expect(
          await tryInsert('enrollment_events', {
            enrollment_id: enrollmentId,
            kind,
            occurred_at: INSTANT,
          }),
          kind,
        ).toBeNull();
      }
    });
  });
});

describe('ERD §14: the held closings’ partial index, for the hourly sweep (T069, T074; DEC-69)', () => {
  it('holds it by name, over every held closing and none a deletion or a gender correction ended', async () => {
    expect(await indexDefinition('enrollments_held_closing_idx')).toBe(
      "CREATE INDEX enrollments_held_closing_idx ON public.enrollments USING btree (id) WHERE ((confirmed_at IS NOT NULL) AND ((status = 'terminated_no_show'::enrollment_status) OR ((status = 'cancelled'::enrollment_status) AND (cancellation_reason = ANY (ARRAY['admin'::cancellation_reason, 'teacher_suspended'::cancellation_reason])))))",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Rule 34's note: a deleted person's documents, through the real deletion.

const KEY = Buffer.alloc(32, 7).toString('base64');
const cipher = new ColumnCipher(KEY);
const COLUMN = 'verification_documents.storage_key_encrypted';
const PASSWORD = 'a long probe passphrase 69';

const SETTINGS: Readonly<Record<string, unknown>> = {
  otp_code_ttl_minutes: 10,
  otp_max_attempts: 5,
  onboarding_token_ttl_minutes: 15,
  session_access_ttl_minutes: 15,
  session_refresh_ttl_days: 30,
  session_refresh_grace_seconds: 30,
  provider_nonce_ttl_minutes: 10,
  idempotency_key_ttl_hours: 24,
};

const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};

/** The storage port's removal, failing for the keys it is told to. */
const storage = {
  failing: new Set<string>(),
  async remove(key: string) {
    if (this.failing.has(key)) throw new Error('probe storage: unreachable');
  },
  async temporaryLink(key: string) {
    return `https://storage.invalid/${key}`;
  },
};

describe('rule 34’s note: every document of a deleted person still holding its key is kept or erased (T069)', () => {
  let database: Database;
  let deletion: ReturnType<typeof createIdentityServices>['deletion'];

  beforeAll(async () => {
    database = openDatabase(process.env['DATABASE_URL'] ?? '', {
      poolMax: 2,
      statementTimeoutMs: 30_000,
      idleInTransactionTimeoutMs: 60_000,
    });
    const consequences = new AccountConsequences();
    consequences.subscribe(documentErasureConsequence());
    const unreachable = () => Promise.reject(new Error('probe: not reached'));
    deletion = createIdentityServices({
      database,
      settings,
      encryptionKey: KEY,
      cipher,
      marks: new MemorySingleUseMarks(() => new Date()),
      signIn: {
        verifyIdentityToken: unreachable,
        exchangeAuthorization: unreachable,
        revoke: unreachable,
      },
      email: { deliver: async () => undefined },
      storage,
      log: { warn: () => undefined },
      payment: { registerPayoutRecipient: unreachable },
      idempotency: new IdempotencyService<Transaction>({
        store: new IdempotencyRepository(database),
        settings,
      }),
      consequences,
      fileErasures: [createDocumentErasure({ database, cipher, storage })],
      report: () => undefined,
    }).deletion;
  });

  afterAll(async () => {
    await closeDatabase(database);
  });

  it('a teacher ever approved, an identity, a credential and another document, one file failing to go', async () => {
    const userId = await makeUser(db, { password_hash: await hashPassword(PASSWORD) });
    await insertRow(db, 'user_roles', { user_id: userId, role: 'teacher', status: 'active' });
    const keys: string[] = [];
    for (const type of ['national_id', 'credential', 'other']) {
      const id = randomUUID();
      const key = `documents/${id}.pdf`;
      await insertRow(db, 'verification_documents', {
        id,
        user_id: userId,
        document_type: type,
        storage_key_encrypted: Buffer.from(cipher.encrypt(key, COLUMN, id)),
      });
      keys.push(key);
    }
    await insertRow(
      db,
      'teacher_profiles',
      profile(userId, { verification_status: 'approved', approved_at: INSTANT }),
    );
    storage.failing.add(keys[2] ?? '');

    await deletion.deleteAccount(userId, {
      confirmation: 'DELETE',
      reauth: { kind: 'password', password: PASSWORD },
      idempotencyKey: randomUUID(),
    });

    await vi.waitFor(async () => {
      const { rows } = await db.query<{ kept: boolean; erased: boolean; has_key: boolean }>(
        `SELECT d.kept_at IS NOT NULL AS kept, d.erased_at IS NOT NULL AS erased,
                d.storage_key_encrypted IS NOT NULL AS has_key
           FROM verification_documents d JOIN users u ON u.id = d.user_id
          WHERE u.id = $1 AND u.deleted_at IS NOT NULL`,
        [userId],
      );
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.kept && row.erased).toBe(false);
        if (row.has_key) expect(row.kept || row.erased).toBe(true);
      }
      expect(rows.some((row) => row.has_key)).toBe(true);
    });
  });
});
