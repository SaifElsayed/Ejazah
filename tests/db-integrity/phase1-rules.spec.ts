// T008 — the integrity rules Phase 1 adds, each shown by an insert the database refuses (SC-113;
// specs/002-identity/data-model.md §5, ERD §15 rules 22 to 32).
//
// Rules 22, 23, 24, 25, 27, 30, 31 and 32 were probed by B2; rule 26 (the idempotency actor) and
// rule 29 (the audit label) joined in batch B4 with their writers (T018, T021), since the Phase 0
// repositories and probes wrote those rows without the new columns until then; rule 28 is rule 7
// as re-keyed, in `constraints.spec.ts`. The last cases prove the five credential tables keep
// DELETE for the application role: a session, an identity, a code, a recovery code is a
// credential or a key, not a record of something that happened (data-model §5).
//
// Each probe first writes a valid row, so a refusal is the rule and not a broken row, then the
// forbidden one, expecting the SQLSTATE of the constraint kind: 23505 for a unique, 23514 for a
// check. Every probe runs as the application role in a transaction that is rolled back. Observed
// red before the migrations of T009 to T012: every table and column below was missing.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
  insertStatement,
  makeAdmin,
  makeCredential,
  makeSubject,
  makeUser,
  type Db,
} from './harness';

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

const INSTANT = '2026-10-18T09:00:00Z';
const LATER = '2026-11-17T09:00:00Z';

function sessionValues(userId: string, hash: string): Record<string, unknown> {
  return { user_id: userId, refresh_token_hash: hash, issued_at: INSTANT, expires_at: LATER };
}

function adminSessionValues(adminId: string, hash: string): Record<string, unknown> {
  return {
    admin_id: adminId,
    token_hash: hash,
    issued_at: INSTANT,
    last_seen_at: INSTANT,
    expires_at: LATER,
  };
}

function adminValues(values: Record<string, unknown>): Record<string, unknown> {
  return {
    email: `probe-${randomUUID()}@example.invalid`,
    password_hash: 'probe-hash',
    mfa_secret_encrypted: Buffer.from('probe'),
    display_name: 'Probe administrator',
    is_active: true,
    ...values,
  };
}

function profileValues(userId: string, values: Record<string, unknown>): Record<string, unknown> {
  return {
    user_id: userId,
    bio: 'Probe',
    qualification_summary: 'Probe',
    verification_status: 'pending',
    ...values,
  };
}

describe('ERD §15 rules 22 to 32, each refused by the database (T008, SC-113)', () => {
  it('rule 22: one provider subject belongs to one account', async () => {
    await inRollback(db, async () => {
      const first = await makeUser(db);
      const second = await makeUser(db);
      const subject = `sub-${randomUUID()}`;
      const identity = (userId: string) => ({
        user_id: userId,
        provider: 'google',
        provider_subject: subject,
      });
      expect(await tryInsert('auth_identities', identity(first))).toBeNull();
      expect(await tryInsert('auth_identities', identity(second))).toBe(SQLSTATE.uniqueViolation);
      // The same subject under the other provider is another identity.
      expect(
        await tryInsert('auth_identities', { ...identity(second), provider: 'apple' }),
      ).toBeNull();
    });
  });

  it('rule 23: one approved credential per teacher and subject; a rejected one stays as history', async () => {
    await inRollback(db, async () => {
      const teacher = await makeUser(db);
      const subject = await makeSubject(db);
      const admin = await makeAdmin(db);
      await makeCredential(db, { teacherId: teacher, subjectId: subject, status: 'approved' });
      await expect(
        makeCredential(db, { teacherId: teacher, subjectId: subject, status: 'rejected', admin }),
      ).resolves.toBeDefined();
      await expect(
        makeCredential(db, { teacherId: teacher, subjectId: subject, status: 'pending' }),
      ).resolves.toBeDefined();
      await expect(
        makeCredential(db, { teacherId: teacher, subjectId: subject, status: 'approved', admin }),
      ).rejects.toMatchObject({ code: SQLSTATE.uniqueViolation });
    });
  });

  it('rule 24: one role row per user (ADR 0016 D3)', async () => {
    await inRollback(db, async () => {
      const user = await makeUser(db);
      const role = (name: string) => ({ user_id: user, role: name, status: 'active' });
      expect(await tryInsert('user_roles', role('student'))).toBeNull();
      expect(await tryInsert('user_roles', role('teacher'))).toBe(SQLSTATE.uniqueViolation);
    });
  });

  it('rule 25: a refresh token hash and an admin session token hash are each unique', async () => {
    await inRollback(db, async () => {
      const user = await makeUser(db);
      const other = await makeUser(db);
      const hash = `hash-${randomUUID()}`;
      expect(await tryInsert('user_sessions', sessionValues(user, hash))).toBeNull();
      expect(await tryInsert('user_sessions', sessionValues(other, hash))).toBe(
        SQLSTATE.uniqueViolation,
      );

      const admin = await makeAdmin(db);
      const otherAdmin = await makeAdmin(db);
      const token = `token-${randomUUID()}`;
      expect(await tryInsert('admin_sessions', adminSessionValues(admin, token))).toBeNull();
      expect(await tryInsert('admin_sessions', adminSessionValues(otherAdmin, token))).toBe(
        SQLSTATE.uniqueViolation,
      );
    });
  });

  it('rule 27: a payout reference hash is unique where present; an unset one is not a collision', async () => {
    await inRollback(db, async () => {
      const first = await makeUser(db);
      const second = await makeUser(db);
      const third = await makeUser(db);
      const hash = `payout-${randomUUID()}`;
      expect(
        await tryInsert(
          'teacher_profiles',
          profileValues(first, { payout_account_ref_hash: hash }),
        ),
      ).toBeNull();
      expect(
        await tryInsert(
          'teacher_profiles',
          profileValues(second, { payout_account_ref_hash: hash }),
        ),
      ).toBe(SQLSTATE.uniqueViolation);
      expect(await tryInsert('teacher_profiles', profileValues(second, {}))).toBeNull();
      expect(await tryInsert('teacher_profiles', profileValues(third, {}))).toBeNull();
    });
  });

  it('rule 30: a lock never exists without the failed attempts that caused it', async () => {
    await inRollback(db, async () => {
      expect(
        await tryInsert(
          'admin_users',
          adminValues({ failed_sign_in_count: 5, locked_until_at: LATER }),
        ),
      ).toBeNull();
      expect(
        await tryInsert(
          'admin_users',
          adminValues({ failed_sign_in_count: 0, locked_until_at: LATER }),
        ),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('rule 31: is_active is exactly "not disabled"', async () => {
    await inRollback(db, async () => {
      expect(await tryInsert('admin_users', adminValues({ is_active: true }))).toBeNull();
      expect(
        await tryInsert('admin_users', adminValues({ is_active: false, disabled_at: INSTANT })),
      ).toBeNull();
      expect(
        await tryInsert('admin_users', adminValues({ is_active: true, disabled_at: INSTANT })),
      ).toBe(SQLSTATE.checkViolation);
      expect(await tryInsert('admin_users', adminValues({ is_active: false }))).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });

  it('rule 32: a live user keeps name, birth date and email; a deleted one may have them erased (FR-141)', async () => {
    await inRollback(db, async () => {
      const live = (values: Record<string, unknown>) => ({
        phone: null,
        email: `probe-${randomUUID()}@example.invalid`,
        gender: 'female',
        date_of_birth: '1995-05-05',
        display_name: 'Probe user',
        preferred_language: 'ar',
        timezone: 'Africa/Cairo',
        account_status: 'active',
        ...values,
      });
      expect(await tryInsert('users', live({}))).toBeNull();
      expect(await tryInsert('users', live({ display_name: null }))).toBe(SQLSTATE.checkViolation);
      expect(await tryInsert('users', live({ date_of_birth: null }))).toBe(SQLSTATE.checkViolation);
      expect(await tryInsert('users', live({ email: null, phone: '+201000000001' }))).toBe(
        SQLSTATE.checkViolation,
      );
      // The one transaction of FR-141: deleted, with every personal column erased, and no contact.
      expect(
        await tryInsert(
          'users',
          live({
            deleted_at: INSTANT,
            display_name: null,
            date_of_birth: null,
            email: null,
            phone: null,
          }),
        ),
      ).toBeNull();
    });
  });

  // T018 (batch B4): the column and its writer arrive together (conflict review, 2026-10-18).
  it('rule 26: an idempotency key is the actor’s: two actors may share one key, one actor cannot reuse it, and no row is anonymous (FR-106)', async () => {
    await inRollback(db, async () => {
      const key = `probe-key-${randomUUID()}`;
      const row = (actor: string | null) => ({
        scope: 'teacher.application.submit',
        actor_id: actor,
        key,
        request_hash: 'probe-hash',
        status: 'completed',
        expires_at: LATER,
      });
      expect(await tryInsert('idempotency_keys', row('probe-actor-1'))).toBeNull();
      expect(await tryInsert('idempotency_keys', row('probe-actor-2'))).toBeNull();
      expect(await tryInsert('idempotency_keys', row('probe-actor-1'))).toBe(
        SQLSTATE.uniqueViolation,
      );
      expect(await tryInsert('idempotency_keys', row(null))).toBe(SQLSTATE.notNullViolation);
    });
  });

  // T021 (batch B4): the column and its writer arrive together (conflict review, 2026-10-18).
  it('rule 29: an audit entry carries a target label of at most 200 characters, and never none (FR-180)', async () => {
    await inRollback(db, async () => {
      const adminId = await makeAdmin(db);
      const entry = (label: string | null) => ({
        admin_id: adminId,
        action: 'probe.recorded',
        target_type: 'admin',
        target_id: adminId,
        target_label: label,
      });
      expect(await tryInsert('audit_logs', entry(`مشرف · ${adminId}`))).toBeNull();
      expect(await tryInsert('audit_logs', entry('م'.repeat(200)))).toBeNull();
      expect(await tryInsert('audit_logs', entry('م'.repeat(201)))).toBe(SQLSTATE.checkViolation);
      expect(await tryInsert('audit_logs', entry(null))).toBe(SQLSTATE.notNullViolation);
    });
  });
});

describe('a session keeps every hash its rotations retired (T094, ERD §15 rule 33)', () => {
  it('rule 33: a retired hash names one session, and the retired rows go with their session', async () => {
    await inRollback(db, async () => {
      const user = await makeUser(db);
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO user_sessions (user_id, refresh_token_hash, issued_at, expires_at, updated_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        [user, `hash-${randomUUID()}`, INSTANT, LATER],
      );
      const sessionId = rows[0]?.id;
      const retired = `retired-${randomUUID()}`;
      const row = { session_id: sessionId, token_hash: retired, retired_at: INSTANT };
      expect(await tryInsert('user_session_retired_tokens', row)).toBeNull();
      expect(await tryInsert('user_session_retired_tokens', row)).toBe(SQLSTATE.uniqueViolation);
      expect(await attempt(db, 'DELETE FROM user_sessions WHERE id = $1', [sessionId])).toBeNull();
      const { rows: left } = await db.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM user_session_retired_tokens WHERE token_hash = $1',
        [retired],
      );
      expect(left).toEqual([{ n: '0' }]);
    });
  });
});

describe('the credential tables keep DELETE for the application role (T008, data-model §5)', () => {
  const credentialTables = [
    'auth_identities',
    'user_sessions',
    'user_session_retired_tokens',
    'admin_sessions',
    'admin_recovery_codes',
    'otp_codes',
  ] as const;

  it.each(credentialTables)(
    '%s: DELETE allowed, so a credential can be destroyed',
    async (table) => {
      await inRollback(db, async () => {
        expect(await attempt(db, `SELECT count(*) FROM "${table}"`)).toBeNull();
        expect(await attempt(db, `DELETE FROM "${table}" WHERE false`)).toBeNull();
      });
    },
  );
});
