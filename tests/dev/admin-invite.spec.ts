// B12b — `scripts/dev/admin-invite.ts`, the seeded administrator's password through the invite job's
// own path (T066's note, owner's decision 2026-10-21). It refuses anywhere but a development machine
// whose email is the stand-in, so it never sends a real mail, and without the panel's origin the
// link needs; it marks the invitation and queues `deliver-admin-invite` with the id alone, and does
// neither for an administrator who already set a password. Over the real database, in a
// transaction rolled back, with the queue a recorder. The pipeline's database is migrated, not
// seeded, so each case plants the seeded administrator's row itself, in the state it needs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMINISTRATOR } from '../../prisma/seed';
import { inviteSeededAdministrator, refusalOf } from '../../scripts/dev/admin-invite';
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

describe('the invite', () => {
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
