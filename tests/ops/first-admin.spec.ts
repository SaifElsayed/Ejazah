// R2 T178 (`specs/002-identity/tasks.md` T178 and its R2 note; `specs/003-booking/tasks.md` T098
// item 3; SRS FR-ADMIN-1 as amended, DEC-108; ADR 0019 D3): `scripts/ops/first-admin.ts`, the
// server owner's first administrator and the recovery of one who can no longer sign in.
//
// The arguments and the environment are plain functions. The rest runs over the real database inside
// one transaction each case rolls back: the shared database holds many administrators who can sign
// in, so a first-administrator case disables them first inside that same transaction. The script
// opens and commits its own transaction; here its BEGIN, COMMIT and ROLLBACK become a savepoint of
// the case's transaction, and each statement of that kind, and each job queued, is written to one
// log, so a case can see that the invitation is queued only after the commit. `audit_logs` is
// append-only, so an entry is written only inside these transactions.
//
// No spec can hold both this script and `AdminsService.add` (R-API-4 keeps the admin module from
// tests, R-API-6 raw SQL from `apps/api`), so the column guard below fails when `admin_users`
// gains a column, as `tests/dev/admin-invite.spec.ts`'s does for the development script.
import { randomBytes, randomUUID } from 'node:crypto';

import type { QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import { ADMINISTRATOR, type Queryable } from '../../prisma/seed';
import {
  bootstrap,
  commandOf,
  type Dependencies,
  execute,
  recover,
  refusalOf,
} from '../../scripts/ops/first-admin';
import { connectAsApplication, type Db, inRollback } from '../db-integrity/harness';

describe('the arguments', () => {
  it('reads the first administrator’s --email and --name through admins.add’s input contract', () => {
    expect(commandOf(['--email', 'First@Ijazah.test', '--name', 'First Admin'])).toEqual({
      kind: 'bootstrap',
      email: 'First@Ijazah.test',
      displayName: 'First Admin',
    });
  });

  it('reads --recover with --email and the reason', () => {
    expect(
      commandOf(['--recover', '--email', 'lost@ijazah.test', '--reason', ' lost both factors ']),
    ).toEqual({ kind: 'recover', email: 'lost@ijazah.test', reason: 'lost both factors' });
  });

  it('refuses --recover without a reason, or with a blank one', () => {
    expect(commandOf(['--recover', '--email', 'lost@ijazah.test'])).toBeNull();
    expect(commandOf(['--recover', '--email', 'lost@ijazah.test', '--reason', '  '])).toBeNull();
  });

  it('refuses an unknown flag and a stray value', () => {
    expect(commandOf(['--email', 'a@ijazah.test', '--name', 'First Admin', '--force'])).toBeNull();
    expect(commandOf(['--email', 'a@ijazah.test', '--name', 'First Admin', 'extra'])).toBeNull();
  });

  it('refuses the two forms mixed, either half of one, an address the contract refuses, and nothing', () => {
    expect(
      commandOf(['--recover', '--email', 'a@ijazah.test', '--reason', 'r', '--name', 'First']),
    ).toBeNull();
    expect(commandOf(['--email', 'a@ijazah.test', '--name', 'First', '--reason', 'r'])).toBeNull();
    expect(commandOf(['--email', 'a@ijazah.test'])).toBeNull();
    expect(commandOf(['--name', 'First Admin'])).toBeNull();
    expect(commandOf(['--email', 'not-an-address', '--name', 'First Admin'])).toBeNull();
    expect(commandOf([])).toBeNull();
  });
});

/** The four values the script needs, each set; no real value. */
const HOSTED = {
  ADMIN_PANEL_ORIGIN: 'https://admin.ijazah.test',
  REDIS_URL: 'redis://redis.internal:6379',
  DATABASE_URL: 'postgresql://ijazah_app@db.internal:5432/ijazah',
  ENCRYPTION_KEY: 'a-key-in-spec',
} as const;

describe('the environment', () => {
  it('refuses without the panel’s origin, which the worker builds the link from', () => {
    expect(refusalOf({})).toBe('panel_origin_missing');
    expect(refusalOf({ ADMIN_PANEL_ORIGIN: '' })).toBe('panel_origin_missing');
  });

  it('refuses without REDIS_URL, which the invitation is queued through', () => {
    expect(refusalOf({ ...HOSTED, REDIS_URL: undefined })).toBe('redis_url_missing');
    expect(refusalOf({ ...HOSTED, REDIS_URL: '' })).toBe('redis_url_missing');
  });

  it('refuses without DATABASE_URL, which the administrator is written through', () => {
    expect(refusalOf({ ...HOSTED, DATABASE_URL: undefined })).toBe('database_url_missing');
    expect(refusalOf({ ...HOSTED, DATABASE_URL: '' })).toBe('database_url_missing');
  });

  it('refuses without ENCRYPTION_KEY, which the second factor’s secret is encrypted under', () => {
    expect(refusalOf({ ...HOSTED, ENCRYPTION_KEY: undefined })).toBe('encryption_key_missing');
    expect(refusalOf({ ...HOSTED, ENCRYPTION_KEY: '' })).toBe('encryption_key_missing');
  });

  it('runs on a hosted server: no NODE_ENV or EMAIL_PROVIDER guard', () => {
    expect(
      refusalOf({
        ...HOSTED,
        NODE_ENV: 'production',
        EMAIL_PROVIDER: 'resend',
      }),
    ).toBeNull();
  });
});

/** The script's transaction as a savepoint of the case's, and what it did in order. */
function recorded(db: Db): { readonly deps: Dependencies; readonly log: string[] } {
  const log: string[] = [];
  const nested: Record<string, string> = {
    BEGIN: 'SAVEPOINT first_admin',
    COMMIT: 'RELEASE SAVEPOINT first_admin',
    ROLLBACK: 'ROLLBACK TO SAVEPOINT first_admin',
  };
  const query = async <Row extends QueryResultRow>(text: string, values?: readonly unknown[]) => {
    const statement = nested[text.trim().toUpperCase()];
    if (statement !== undefined) log.push(text.trim().toUpperCase());
    return db.query<Row>(statement ?? text, values === undefined ? undefined : [...values]);
  };
  const queryable: Queryable = { query };
  return {
    log,
    deps: {
      db: queryable,
      cipher,
      queue: {
        add: async (name, data) => {
          log.push(`queue ${name} ${data.adminId}`);
        },
      },
    },
  };
}

const cipher = new ColumnCipher(randomBytes(32).toString('base64'));
const unique = () => `r2-first-${randomBytes(6).toString('hex')}@ijazah.test`;
const LABEL = (id: string) => `مشرف · ${id}`;

/** The seeded administrator as the seed leaves it: active, no password set, never invited. */
async function plantSeededAdministrator(db: Db): Promise<void> {
  await db.query(
    `INSERT INTO admin_users
       (id, email, password_hash, mfa_secret_encrypted, display_name, is_active, created_at, updated_at)
     VALUES ($1, $2, 'unusable', $3, $4, true, now(), now())
     ON CONFLICT (id) DO UPDATE
       SET is_active = true, disabled_at = NULL, password_set_at = NULL, invited_at = NULL`,
    [ADMINISTRATOR.id, ADMINISTRATOR.email, Buffer.from('probe'), ADMINISTRATOR.displayName],
  );
}

/** Every administrator who can sign in, disabled inside the case's transaction. */
async function disableEveryoneWhoCanSignIn(db: Db): Promise<void> {
  await db.query(
    `UPDATE admin_users SET is_active = false, disabled_at = now()
      WHERE is_active AND password_set_at IS NOT NULL`,
  );
}

interface Planted {
  readonly active: boolean;
  readonly passwordSet: boolean;
  /** A temporary lock with the count that caused it (rule 30), and an enrolled second factor. */
  readonly lockedAndEnrolled?: boolean;
}

/** An administrator in the state a case needs; its id and address. */
async function plantAdministrator(
  db: Db,
  { active, passwordSet, lockedAndEnrolled = false }: Planted,
): Promise<{ readonly id: string; readonly email: string }> {
  const id = randomUUID();
  const email = unique();
  await db.query(
    `INSERT INTO admin_users
       (id, email, password_hash, mfa_secret_encrypted, display_name, is_active, disabled_at,
        password_set_at, mfa_enrolled_at, mfa_last_accepted_step, failed_sign_in_count,
        locked_until_at, invited_at, created_at, updated_at)
     VALUES ($1, $2, CASE WHEN $4 THEN 'a-password-hash' END, $5, 'R2 Probe', $3,
             CASE WHEN $3 THEN NULL ELSE now() - interval '1 day' END,
             CASE WHEN $4 THEN now() - interval '20 days' END,
             CASE WHEN $6 THEN now() - interval '20 days' END,
             CASE WHEN $6 THEN 123 END,
             CASE WHEN $6 THEN 5 ELSE 0 END,
             CASE WHEN $6 THEN now() + interval '10 minutes' END,
             now() - interval '21 days', now() - interval '21 days', now() - interval '21 days')`,
    [id, email, active, passwordSet, Buffer.from('old-secret'), lockedAndEnrolled],
  );
  return { id, email };
}

async function recoveryCodes(db: Db, adminId: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await db.query('INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ($1, $2)', [
      adminId,
      `hash-${randomBytes(4).toString('hex')}`,
    ]);
  }
}

/** A session of the administrator: open, or revoked long ago. */
async function session(db: Db, adminId: string, revokedLongAgo: boolean): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO admin_sessions
       (admin_id, token_hash, mfa_verified_at, issued_at, last_seen_at, expires_at, revoked_at, updated_at)
     VALUES ($1, $2, now(), now() - interval '1 hour', now() - interval '1 hour', now() + interval '1 hour',
             CASE WHEN $3 THEN now() - interval '3 days' END, now() - interval '1 hour')
     RETURNING id`,
    [adminId, randomBytes(32).toString('hex'), revokedLongAgo],
  );
  return rows[0]?.id ?? '';
}

async function auditOf(db: Db, targetId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT admin_id, action, target_type, target_id, target_label, reason, before, after
       FROM audit_logs WHERE target_type = 'admin' AND target_id = $1`,
    [targetId],
  );
  return rows;
}

async function countWithEmail(db: Db, email: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM admin_users WHERE email = $1',
    [email],
  );
  return rows[0]?.n ?? -1;
}

// T124: skipped unless IJAZAH_DB_SPECS=1.
describe('the first administrator', { tags: ['database'] }, () => {
  let db: Db;
  beforeAll(async () => {
    db = await connectAsApplication();
  });
  afterAll(async () => {
    await db.end();
  });

  // The column guard (T097, T178): this script writes the row `AdminsService.add` writes, with SQL,
  // as `scripts/dev/admin-invite.ts` does. Every column of `admin_users` is one it writes or one it
  // leaves to its default or NULL, exactly; a column added to the table fails here until the three
  // writers are read again.
  it('knows every column of admin_users: the ones it writes and the ones it leaves', async () => {
    const written = [
      'id',
      'email',
      'password_hash',
      'mfa_secret_encrypted',
      'display_name',
      'is_active',
      'invited_by_admin_id',
      'invited_at',
      'created_at',
      'updated_at',
    ];
    const left = [
      'disabled_at',
      'failed_sign_in_count',
      'last_sign_in_at',
      'locked_until_at',
      'mfa_enrolled_at',
      'mfa_last_accepted_step',
      'password_set_at',
    ];
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'admin_users'`,
    );
    expect(
      rows.map((row) => row.column_name).sort(),
      'review scripts/ops/first-admin.ts, scripts/dev/admin-invite.ts and AdminsService.add together',
    ).toEqual([...written, ...left].sort());
  });

  it('is refused while an active administrator who can sign in exists, writing and queueing nothing', async () => {
    const email = unique();
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      await disableEveryoneWhoCanSignIn(db);
      await plantAdministrator(db, { active: true, passwordSet: true });
      const { deps, log } = recorded(db);
      expect(await bootstrap(deps, { email, displayName: 'First Admin' })).toEqual({
        ok: false,
        refusal: 'administrator_can_sign_in',
      });
      expect(await countWithEmail(db, email)).toBe(0);
      expect(log).toEqual(['BEGIN', 'ROLLBACK']);
    });
  });

  it('counts an administrator under a temporary lock as one who can sign in', async () => {
    const email = unique();
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      await disableEveryoneWhoCanSignIn(db);
      await plantAdministrator(db, { active: true, passwordSet: true, lockedAndEnrolled: true });
      const { deps, log } = recorded(db);
      expect(await bootstrap(deps, { email, displayName: 'First Admin' })).toEqual({
        ok: false,
        refusal: 'administrator_can_sign_in',
      });
      expect(log).toEqual(['BEGIN', 'ROLLBACK']);
    });
  });

  it('does not count the seeded administrator, a disabled one, or one never given a password', async () => {
    const email = unique();
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      await disableEveryoneWhoCanSignIn(db);
      await plantAdministrator(db, { active: false, passwordSet: true });
      await plantAdministrator(db, { active: true, passwordSet: false });
      const { deps } = recorded(db);
      expect(await bootstrap(deps, { email, displayName: 'First Admin' })).toMatchObject({
        ok: true,
        queued: true,
      });
    });
  });

  it('writes the row admins.add writes, one audit entry under the seeded administrator, and queues the invitation after the commit', async () => {
    const email = unique();
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      await disableEveryoneWhoCanSignIn(db);
      const { deps, log } = recorded(db);
      const outcome = await bootstrap(deps, {
        email: ` ${email.toUpperCase()} `,
        displayName: 'First Admin',
      });
      expect(outcome).toMatchObject({ ok: true, queued: true });
      const adminId = outcome.ok ? outcome.adminId : '';
      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT email, display_name, password_hash, password_set_at, mfa_enrolled_at, is_active,
                disabled_at, invited_by_admin_id, invited_at = now() AS invited_now,
                created_at = now() AS created_now, mfa_secret_encrypted
           FROM admin_users WHERE id = $1`,
        [adminId],
      );
      expect(rows[0]).toMatchObject({
        email,
        display_name: 'First Admin',
        password_hash: null,
        password_set_at: null,
        mfa_enrolled_at: null,
        is_active: true,
        disabled_at: null,
        invited_by_admin_id: null,
        invited_now: true,
        created_now: true,
      });
      expect(
        cipher.decrypt(
          rows[0]?.['mfa_secret_encrypted'] as Buffer,
          'admin_users.mfa_secret_encrypted',
          adminId,
        ),
      ).toMatch(/^[A-Z2-7]{32}$/);
      expect(await auditOf(db, adminId)).toEqual([
        {
          admin_id: ADMINISTRATOR.id,
          action: 'admin.bootstrap',
          target_type: 'admin',
          target_id: adminId,
          target_label: LABEL(adminId),
          reason: 'first-admin script',
          before: null,
          after: null,
        },
      ]);
      expect(log).toEqual(['BEGIN', 'COMMIT', `queue deliver-admin-invite ${adminId}`]);
    });
  });

  it('refuses an address another administrator holds, writing and queueing nothing', async () => {
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      await disableEveryoneWhoCanSignIn(db);
      const taken = await plantAdministrator(db, { active: true, passwordSet: false });
      const { deps, log } = recorded(db);
      expect(
        await bootstrap(deps, { email: taken.email.toUpperCase(), displayName: 'Second' }),
      ).toEqual({ ok: false, refusal: 'email_taken' });
      expect(await countWithEmail(db, taken.email)).toBe(1);
      expect(await auditOf(db, taken.id)).toEqual([]);
      expect(log).toEqual(['BEGIN', 'ROLLBACK']);
    });
  });

  it('is refused when the seeded administrator, the audit entry’s actor, is absent', async () => {
    const email = unique();
    await inRollback(db, async () => {
      await disableEveryoneWhoCanSignIn(db);
      const { deps, log } = recorded(db);
      expect(
        await bootstrap({ ...deps, actorId: randomUUID() }, { email, displayName: 'First Admin' }),
      ).toEqual({ ok: false, refusal: 'seed_missing' });
      expect(await countWithEmail(db, email)).toBe(0);
      expect(log).toEqual(['BEGIN', 'ROLLBACK']);
    });
  });
});

// T124: skipped unless IJAZAH_DB_SPECS=1.
describe('--recover', { tags: ['database'] }, () => {
  let db: Db;
  beforeAll(async () => {
    db = await connectAsApplication();
  });
  afterAll(async () => {
    await db.end();
  });

  it('clears the password, the second factor and the lock, deletes the codes, revokes the open sessions, audits the reason and queues after the commit', async () => {
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      const target = await plantAdministrator(db, {
        active: true,
        passwordSet: true,
        lockedAndEnrolled: true,
      });
      const other = await plantAdministrator(db, { active: true, passwordSet: true });
      await recoveryCodes(db, target.id, 3);
      await recoveryCodes(db, other.id, 1);
      const open = [await session(db, target.id, false), await session(db, target.id, false)];
      const revokedBefore = await session(db, target.id, true);
      const othersOpen = await session(db, other.id, false);
      const { deps, log } = recorded(db);

      expect(
        await recover(deps, { email: ` ${target.email.toUpperCase()} `, reason: 'lost both' }),
      ).toEqual({ ok: true, adminId: target.id, queued: true });

      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT password_hash, password_set_at, mfa_enrolled_at, mfa_last_accepted_step,
                failed_sign_in_count, locked_until_at, is_active, invited_at = now() AS invited_now,
                updated_at = now() AS updated_now, mfa_secret_encrypted
           FROM admin_users WHERE id = $1`,
        [target.id],
      );
      expect(rows[0]).toMatchObject({
        password_hash: null,
        password_set_at: null,
        mfa_enrolled_at: null,
        mfa_last_accepted_step: null,
        failed_sign_in_count: 0,
        locked_until_at: null,
        is_active: true,
        invited_now: true,
        updated_now: true,
      });
      expect(
        cipher.decrypt(
          rows[0]?.['mfa_secret_encrypted'] as Buffer,
          'admin_users.mfa_secret_encrypted',
          target.id,
        ),
      ).toMatch(/^[A-Z2-7]{32}$/);

      const codes = await db.query<{ admin_id: string; n: number }>(
        `SELECT admin_id, count(*)::int AS n FROM admin_recovery_codes
          WHERE admin_id = ANY($1::uuid[]) GROUP BY admin_id`,
        [[target.id, other.id]],
      );
      expect(codes.rows).toEqual([{ admin_id: other.id, n: 1 }]);

      const sessions = await db.query<{ id: string; revoked_now: boolean; open: boolean }>(
        `SELECT id, revoked_at = now() AS revoked_now, revoked_at IS NULL AS open
           FROM admin_sessions WHERE id = ANY($1::uuid[])`,
        [[...open, revokedBefore, othersOpen]],
      );
      const byId = new Map(sessions.rows.map((row) => [row.id, row]));
      for (const id of open) expect(byId.get(id)).toMatchObject({ revoked_now: true });
      expect(byId.get(revokedBefore)).toMatchObject({ revoked_now: false, open: false });
      expect(byId.get(othersOpen)).toMatchObject({ open: true });

      expect(await auditOf(db, target.id)).toEqual([
        {
          admin_id: ADMINISTRATOR.id,
          action: 'admin.recover',
          target_type: 'admin',
          target_id: target.id,
          target_label: LABEL(target.id),
          reason: 'lost both',
          before: null,
          after: null,
        },
      ]);
      expect(log).toEqual(['BEGIN', 'COMMIT', `queue deliver-admin-invite ${target.id}`]);
    });
  });

  it('refuses a disabled administrator, changing and queueing nothing', async () => {
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      const target = await plantAdministrator(db, { active: false, passwordSet: true });
      await recoveryCodes(db, target.id, 2);
      const { deps, log } = recorded(db);
      expect(await recover(deps, { email: target.email, reason: 'lost both' })).toEqual({
        ok: false,
        refusal: 'administrator_disabled',
      });
      const { rows } = await db.query<{ password_set: boolean; codes: number }>(
        `SELECT password_set_at IS NOT NULL AS password_set,
                (SELECT count(*)::int FROM admin_recovery_codes WHERE admin_id = $1) AS codes
           FROM admin_users WHERE id = $1`,
        [target.id],
      );
      expect(rows[0]).toEqual({ password_set: true, codes: 2 });
      expect(await auditOf(db, target.id)).toEqual([]);
      expect(log).toEqual(['BEGIN', 'ROLLBACK']);
    });
  });

  it('refuses an address no administrator holds', async () => {
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      const { deps, log } = recorded(db);
      expect(await recover(deps, { email: unique(), reason: 'lost both' })).toEqual({
        ok: false,
        refusal: 'administrator_unknown',
      });
      expect(log).toEqual(['BEGIN', 'ROLLBACK']);
    });
  });

  it('is refused when the seeded administrator, the audit entry’s actor, is absent', async () => {
    await inRollback(db, async () => {
      const target = await plantAdministrator(db, { active: true, passwordSet: true });
      const { deps, log } = recorded(db);
      expect(
        await recover(
          { ...deps, actorId: randomUUID() },
          { email: target.email, reason: 'lost both' },
        ),
      ).toEqual({ ok: false, refusal: 'seed_missing' });
      const { rows } = await db.query<{ password_set: boolean }>(
        'SELECT password_set_at IS NOT NULL AS password_set FROM admin_users WHERE id = $1',
        [target.id],
      );
      expect(rows[0]).toEqual({ password_set: true });
      expect(log).toEqual(['BEGIN', 'ROLLBACK']);
    });
  });
});

// T124: skipped unless IJAZAH_DB_SPECS=1.
describe('the output', { tags: ['database'] }, () => {
  let db: Db;
  beforeAll(async () => {
    db = await connectAsApplication();
  });
  afterAll(async () => {
    await db.end();
  });

  function lines(): {
    readonly out: string[];
    readonly err: string[];
    readonly output: { out(line: string): void; err(line: string): void };
  } {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, output: { out: (line) => out.push(line), err: (line) => err.push(line) } };
  }

  it('names what was done and the administrator’s id, never the address, and that the worker sends the invitation', async () => {
    const email = unique();
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      await disableEveryoneWhoCanSignIn(db);
      const first = lines();
      expect(
        await execute(
          { kind: 'bootstrap', email: email.toUpperCase(), displayName: 'First Admin' },
          recorded(db).deps,
          first.output,
        ),
      ).toBe(0);
      const { rows } = await db.query<{ id: string }>(
        'SELECT id FROM admin_users WHERE email = $1',
        [email],
      );
      const adminId = rows[0]?.id ?? 'missing';
      expect(first.err).toEqual([]);
      expect(first.out).toHaveLength(1);
      expect(first.out[0]).toContain(adminId);
      expect(first.out[0]).toContain('admin.bootstrap');
      expect(first.out[0]).toMatch(/worker/);

      const again = lines();
      expect(
        await execute(
          { kind: 'recover', email, reason: 'lost both' },
          recorded(db).deps,
          again.output,
        ),
      ).toBe(0);
      expect(again.out).toHaveLength(1);
      expect(again.out[0]).toContain(adminId);
      expect(again.out[0]).toContain('admin.recover');
      expect(again.out[0]).toMatch(/worker/);

      for (const line of [...first.out, ...first.err, ...again.out, ...again.err]) {
        expect(line.toLowerCase()).not.toContain(email);
      }
    });
  });

  it('writes a refusal to stderr with its reason code, exit 1, never the address', async () => {
    const email = unique();
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      const refused = lines();
      expect(
        await execute(
          { kind: 'recover', email, reason: 'lost both' },
          recorded(db).deps,
          refused.output,
        ),
      ).toBe(1);
      expect(refused.out).toEqual([]);
      expect(refused.err).toHaveLength(1);
      expect(refused.err[0]).toContain('administrator_unknown');
      expect(refused.err[0]?.toLowerCase()).not.toContain(email);
    });
  });

  it('says so, exit 1, when the invitation cannot be queued after the commit, naming --recover', async () => {
    const email = unique();
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      await disableEveryoneWhoCanSignIn(db);
      const { deps } = recorded(db);
      const failed = lines();
      expect(
        await execute(
          { kind: 'bootstrap', email, displayName: 'First Admin' },
          {
            ...deps,
            queue: {
              add: async () => {
                throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
              },
            },
          },
          failed.output,
        ),
      ).toBe(1);
      expect(await countWithEmail(db, email)).toBe(1);
      expect(failed.out).toEqual([]);
      expect(failed.err).toHaveLength(1);
      expect(failed.err[0]).toContain('invitation_not_queued');
      expect(failed.err[0]).toContain('--recover');
      expect(failed.err[0]?.toLowerCase()).not.toContain(email);
    });
  });

  // BullMQ with `maxRetriesPerRequest: null` neither resolves nor rejects `add` while Redis does not
  // answer (PR #162's review, round 1, Minor 1): the bound ends the wait.
  it('says so, exit 1, within the bound, when the queue never answers', async () => {
    const email = unique();
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      await disableEveryoneWhoCanSignIn(db);
      const { deps } = recorded(db);
      const failed = lines();
      const started = performance.now();
      expect(
        await execute(
          { kind: 'bootstrap', email, displayName: 'First Admin' },
          {
            ...deps,
            queue: { add: () => new Promise<never>(() => undefined) },
            queueTimeoutMilliseconds: 50,
          },
          failed.output,
        ),
      ).toBe(1);
      expect(performance.now() - started).toBeLessThan(2_000);
      expect(await countWithEmail(db, email)).toBe(1);
      expect(failed.out).toEqual([]);
      expect(failed.err).toHaveLength(1);
      expect(failed.err[0]).toContain('invitation_not_queued');
      expect(failed.err[0]).toContain('--recover');
    });
  });

  // PR #162's review, round 2 (mutant R2-F7): once the queue has answered, the bound's timer is
  // cleared, so it never keeps the process alive for its 5 s.
  it('clears the bound once the queue has answered', async () => {
    const email = unique();
    const bound = 4_321;
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      await disableEveryoneWhoCanSignIn(db);
      const { deps } = recorded(db);
      const done = lines();
      const set = vi.spyOn(globalThis, 'setTimeout');
      const cleared = vi.spyOn(globalThis, 'clearTimeout');
      try {
        expect(
          await execute(
            { kind: 'bootstrap', email, displayName: 'First Admin' },
            { ...deps, queueTimeoutMilliseconds: bound },
            done.output,
          ),
        ).toBe(0);
        const timers = set.mock.calls.flatMap((call, i) =>
          call[1] === bound ? [set.mock.results[i]?.value] : [],
        );
        expect(timers).toHaveLength(1);
        expect(cleared.mock.calls.map((call) => call[0])).toContain(timers[0]);
      } finally {
        set.mockRestore();
        cleared.mockRestore();
      }
    });
  });
});
