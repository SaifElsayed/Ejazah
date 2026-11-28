// B12b — `scripts/dev/admin-invite.ts`, the seeded administrator's password through the invite job's
// own path (T066's note, owner's decision 2026-10-21). It refuses anywhere but a development machine
// whose email is the stand-in, so it never sends a real mail, and without the panel's origin the
// link needs; it marks the invitation and queues `deliver-admin-invite` with the id alone, and does
// neither for an administrator who already set a password. Over the real database, in a
// transaction rolled back, with the queue a recorder. The pipeline's database is migrated, not
// seeded, so each case plants the seeded administrator's row itself, in the state it needs.
//
// T097: with `--email` and `--name` it invites a new administrator instead, through `admins.add`'s
// input contract, invited by nobody (`invited_by_admin_id` NULL), with a secret bound to the row, and
// queues the invite; an address another administrator holds is refused and nothing is queued. Inside
// a rolled-back transaction, as above. No spec can hold both the script and `AdminsService.add`
// (R-API-4 keeps the admin module from tests, R-API-6 raw SQL from `apps/api`), so the column guard
// below fails when `admin_users` gains a column, and `admins.service.spec.ts` pins the same values
// for the service's row that these cases pin for the script's.
import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import { ADMINISTRATOR } from '../../prisma/seed';
import {
  inviteNewAdministrator,
  inviteSeededAdministrator,
  newAdministratorOf,
  refusalOf,
} from '../../scripts/dev/admin-invite';
import { connectAsApplication, type Db, inRollback } from '../db-integrity/harness';

const DEVELOPMENT = {
  NODE_ENV: 'development',
  EMAIL_PROVIDER: 'fake',
  ADMIN_PANEL_ORIGIN: 'http://localhost:5173',
};

describe('the guard', () => {
  it('runs on a development machine whose email is the stand-in and which names the panel', () => {
    expect(refusalOf(DEVELOPMENT)).toBeNull();
    expect(refusalOf({ ...DEVELOPMENT, EMAIL_PROVIDER: undefined })).toBeNull();
  });

  it('refuses outside development', () => {
    for (const NODE_ENV of ['test', 'production', undefined]) {
      expect(refusalOf({ ...DEVELOPMENT, NODE_ENV })).toMatch(/NODE_ENV is development/);
    }
  });

  it('refuses any email provider but the stand-in, so no real mail is ever sent', () => {
    expect(refusalOf({ ...DEVELOPMENT, EMAIL_PROVIDER: 'resend' })).toMatch(
      /stand-in email provider/,
    );
  });

  it('refuses without the panel’s origin, which the link needs', () => {
    expect(refusalOf({ ...DEVELOPMENT, ADMIN_PANEL_ORIGIN: undefined })).toMatch(
      /ADMIN_PANEL_ORIGIN/,
    );
    expect(refusalOf({ ...DEVELOPMENT, ADMIN_PANEL_ORIGIN: '' })).toMatch(/ADMIN_PANEL_ORIGIN/);
  });
});

/**
 * The seeded administrator's row as the seed leaves it (no password, never invited, active),
 * written where it is absent and put back in that state where it is not; inside the case's rollback.
 */
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

// T124: skipped unless IJAZAH_DB_SPECS=1.
describe('the invite', { tags: ['database'] }, () => {
  let db: Db;
  beforeAll(async () => {
    db = await connectAsApplication();
  });
  afterAll(async () => {
    await db.end();
  });

  it('marks the seeded administrator invited now and queues deliver-admin-invite with the id alone', async () => {
    const queued: unknown[][] = [];
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      expect(
        await inviteSeededAdministrator(db, { add: async (...args) => queued.push(args) }),
      ).toBe(true);
      const { rows } = await db.query<{ invited: boolean }>(
        'SELECT invited_at = now() AS invited FROM admin_users WHERE id = $1',
        [ADMINISTRATOR.id],
      );
      expect(rows[0]?.invited).toBe(true);
    });
    expect(queued).toEqual([['deliver-admin-invite', { adminId: ADMINISTRATOR.id }]]);
  });

  it('queues nothing for an administrator who already set a password', async () => {
    const queued: unknown[][] = [];
    await inRollback(db, async () => {
      await plantSeededAdministrator(db);
      await db.query('UPDATE admin_users SET password_set_at = now() WHERE id = $1', [
        ADMINISTRATOR.id,
      ]);
      expect(
        await inviteSeededAdministrator(db, { add: async (...args) => queued.push(args) }),
      ).toBe(false);
    });
    expect(queued).toEqual([]);
  });
});

describe('a new administrator’s arguments (T097)', () => {
  it('answers null without --email and --name, so the seeded administrator’s invite runs', () => {
    expect(newAdministratorOf([])).toBeNull();
  });

  it('reads --email and --name through admins.add’s input contract', () => {
    expect(newAdministratorOf(['--email', 'new@ijazah.test', '--name', 'New Admin'])).toEqual({
      email: 'new@ijazah.test',
      displayName: 'New Admin',
    });
  });

  it('refuses an address the contract refuses, and either value without the other', () => {
    expect(() => newAdministratorOf(['--email', 'not-an-address', '--name', 'X'])).toThrow();
    expect(() => newAdministratorOf(['--email', 'new@ijazah.test'])).toThrow();
    expect(() => newAdministratorOf(['--name', 'New Admin'])).toThrow();
  });
});

// T124: skipped unless IJAZAH_DB_SPECS=1.
describe('a new administrator’s invite (T097)', { tags: ['database'] }, () => {
  let db: Db;
  const cipher = new ColumnCipher(randomBytes(32).toString('base64'));
  const unique = () => `t097-${randomBytes(6).toString('hex')}@ijazah.test`;
  beforeAll(async () => {
    db = await connectAsApplication();
  });
  afterAll(async () => {
    await db.end();
  });

  // The column guard (T097): the script writes the row `AdminsService.add` writes, with SQL, since
  // R-API-4 and R-API-6 keep a spec from holding both. Every column of `admin_users` is one the script
  // writes or one it leaves to its default or NULL, exactly; a column added to the table fails here
  // until both writers are read again.
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
      'review scripts/dev/admin-invite.ts, scripts/ops/first-admin.ts and AdminsService.add together',
    ).toEqual([...written, ...left].sort());
  });

  it('writes the administrator invited by nobody, unenrolled, without a password, and queues the invite', async () => {
    const queued: unknown[][] = [];
    const email = unique();
    await inRollback(db, async () => {
      const invited = await inviteNewAdministrator(
        db,
        cipher,
        { add: async (...args) => queued.push(args) },
        { email: ` ${email.toUpperCase()} `, displayName: 'Dev Admin' },
      );
      expect(invited).not.toBeNull();
      const adminId = invited?.adminId ?? '';
      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT email, display_name, password_hash, password_set_at, mfa_enrolled_at, is_active,
                invited_by_admin_id, invited_at = now() AS invited_now, mfa_secret_encrypted
           FROM admin_users WHERE id = $1`,
        [adminId],
      );
      expect(rows[0]).toMatchObject({
        email,
        display_name: 'Dev Admin',
        password_hash: null,
        password_set_at: null,
        mfa_enrolled_at: null,
        is_active: true,
        invited_by_admin_id: null,
        invited_now: true,
      });
      // The secret is bound to the row: it decrypts under this id and is a base32 TOTP secret.
      expect(
        cipher.decrypt(
          rows[0]?.['mfa_secret_encrypted'] as Buffer,
          'admin_users.mfa_secret_encrypted',
          adminId,
        ),
      ).toMatch(/^[A-Z2-7]{32}$/);
      expect(queued).toEqual([['deliver-admin-invite', { adminId }]]);
    });
  });

  it('refuses an address another administrator holds, writing and queueing nothing', async () => {
    const email = unique();
    const queued: unknown[][] = [];
    await inRollback(db, async () => {
      expect(
        await inviteNewAdministrator(
          db,
          cipher,
          { add: async () => undefined },
          {
            email,
            displayName: 'First',
          },
        ),
      ).not.toBeNull();
      await db.query('SAVEPOINT taken');
      expect(
        await inviteNewAdministrator(
          db,
          cipher,
          { add: async (...args) => queued.push(args) },
          {
            email: email.toUpperCase(),
            displayName: 'Second',
          },
        ),
      ).toBeNull();
      await db.query('ROLLBACK TO SAVEPOINT taken');
      const { rows } = await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM admin_users WHERE email = $1',
        [email],
      );
      expect(rows[0]?.n).toBe('1');
    });
    expect(queued).toEqual([]);
  });
});
