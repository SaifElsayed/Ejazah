// T066 (FR-174, research R-110): the invite the `deliver-admin-invite` job sends. The link is a
// stateless token signed under `ijazah:admin-invite:v1`, its lifetime `admin_invite_ttl_hours` from
// the invitation, minted at send time; the same invitation always yields the same link, so a repeated
// delivery repeats the mail rather than making a second link. The mail is written in both languages,
// Arabic first, since an administrator has no language column. Nothing is prepared for an
// administrator who needs no link, and a missing one is an error, for the queue to retry.
import { createHmac } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { deriveSubkey } from '../../platform/crypto/encryption.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import {
  type AdminWorld,
  buildAdmin,
  inTransaction,
  openSpecDatabase,
  SPEC_ENCRYPTION_KEY,
  SPEC_PANEL_ORIGIN,
} from './__fixtures__/admin.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let world: AdminWorld;
beforeEach(() => {
  world = buildAdmin(database);
});

const HOUR = 3600;

async function invitedAdministrator() {
  const inviter = await world.createAdministrator();
  return world.createAdministrator({
    password: null,
    enrolled: false,
    invitedAt: world.clock.now(),
    invitedByAdminId: inviter.adminId,
  });
}

describe('prepare', () => {
  it('mints a link to the panel’s set-password page, signed, expiring with the invitation', async () => {
    const admin = await invitedAdministrator();
    const prepared = await world.invites.prepare(admin.adminId);
    expect(prepared?.to).toBe(admin.email);
    const link = new URL(prepared?.link ?? '');
    expect(`${link.origin}${link.pathname}`).toBe(`${SPEC_PANEL_ORIGIN}/set-password`);
    // In the fragment, which a browser never sends to a server or a log.
    expect(link.search).toBe('');
    const token = link.hash.replace('#token=', '');
    const [version, adminId, expiry, mac] = token.split('.');
    expect(version).toBe('v1');
    expect(adminId).toBe(admin.adminId);
    expect(expiry).toBe('2026-10-22T08:00:00Z');
    expect(prepared?.expiresAt).toEqual(new Date('2026-10-22T08:00:00Z'));
    const key = deriveSubkey(SPEC_ENCRYPTION_KEY, 'ijazah:admin-invite:v1');
    expect(mac).toBe(
      createHmac('sha256', key).update(`v1.${adminId}.${expiry}`).digest('base64url'),
    );
    expect(prepared?.mark).toMatch(/^[0-9a-f]{64}$/);
  });

  it('yields the same link on every preparation of one invitation, whenever it runs', async () => {
    const admin = await invitedAdministrator();
    const first = await world.invites.prepare(admin.adminId);
    world.clock.advance(HOUR);
    const second = await world.invites.prepare(admin.adminId);
    expect(second).toEqual(first);
  });

  it('writes the mail in Arabic and then English, with the link and its lifetime', async () => {
    const admin = await invitedAdministrator();
    const prepared = await world.invites.prepare(admin.adminId);
    const text = prepared?.mail.text ?? '';
    expect(prepared?.mail.subject).toContain('إجازة');
    expect(prepared?.mail.subject).toContain('Ijazah');
    expect(text.indexOf('48')).toBeGreaterThan(-1);
    expect(text.split(prepared?.link ?? '\u0000')).toHaveLength(3);
    expect(text.search(/[؀-ۿ]/)).toBeLessThan(text.search(/[A-Za-z]{4}/));
  });

  it('prepares nothing once the password is set, the account disabled or the link’s lifetime gone', async () => {
    const set = await invitedAdministrator();
    await world.rows.setAdministrator(set.adminId, { passwordSetAt: world.clock.now() });
    expect(await world.invites.prepare(set.adminId)).toBeNull();

    const disabled = await invitedAdministrator();
    const actor = await world.createAdministrator();
    await inTransaction(database, (tx) =>
      world.admins.disable(tx, actor.adminId, disabled.adminId),
    );
    expect(await world.invites.prepare(disabled.adminId)).toBeNull();

    const late = await invitedAdministrator();
    world.clock.advance(48 * HOUR);
    expect(await world.invites.prepare(late.adminId)).toBeNull();
  });

  it('prepares nothing for an administrator never invited', async () => {
    const seeded = await world.createAdministrator({ password: null, enrolled: false });
    expect(await world.invites.prepare(seeded.adminId)).toBeNull();
  });

  it('throws for an administrator who does not exist, so the queue tries again', async () => {
    await expect(world.invites.prepare('00000000-0000-7000-8000-000000000000')).rejects.toThrow();
  });
});
