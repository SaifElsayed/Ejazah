// T061 (FR-170, research R-107, data-model §6): an administrator's session. One opaque token, stored
// only as its SHA-256 lookup hash on `admin_sessions`; `mfa_verified_at` null until the second factor
// passes on it, which is what the administrator caller kind refuses; an idle limit and an absolute
// limit, both read from settings; `resolveAdminSession` yields `mfaVerified` and the session's id;
// sign-out ends the one session and `revokeAll` every session of the administrator. Over the real
// database and a clock of the spec's own.
import { createHash } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../../platform/db/prisma.repository.js';
import {
  type AdminWorld,
  buildAdmin,
  inTransaction,
  openSpecDatabase,
} from './__fixtures__/admin.js';
import { resolveAdminSession } from './index.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let world: AdminWorld;
beforeEach(() => {
  world = buildAdmin(database);
});

const MINUTE = 60;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

async function signedIn() {
  const admin = await world.createAdministrator();
  const issued = await world.sessions.issue(admin.adminId);
  return { ...admin, ...issued };
}

describe('issue', () => {
  it('hands out an opaque token and stores only its hash, unverified, with both limits from now', async () => {
    const { adminId, token, sessionId } = await signedIn();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await world.rows.sessions(adminId);
    expect(row?.id).toBe(sessionId);
    expect(row?.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row?.mfaVerifiedAt).toBeNull();
    expect(row?.issuedAt).toEqual(world.clock.now());
    expect(row?.lastSeenAt).toEqual(world.clock.now());
    expect(row?.expiresAt).toEqual(new Date('2026-10-20T20:00:00Z'));
    expect(row?.revokedAt).toBeNull();
  });
});

describe('resolve', () => {
  it('yields the administrator, the session and mfaVerified false until the second factor passes', async () => {
    const { adminId, token, sessionId } = await signedIn();
    expect(await world.sessions.resolve(token)).toEqual({ adminId, sessionId, mfaVerified: false });
    await inTransaction(database, (tx) => world.sessions.markVerified(sessionId, tx));
    expect(await world.sessions.resolve(token)).toEqual({ adminId, sessionId, mfaVerified: true });
    const [row] = await world.rows.sessions(adminId);
    expect(row?.mfaVerifiedAt).toEqual(world.clock.now());
  });

  it('the module entry resolves a bearer the same way', async () => {
    const { adminId, token, sessionId } = await signedIn();
    const resolve = resolveAdminSession({
      database,
      settings: world.settings,
      now: world.clock.now,
    });
    expect(await resolve(token)).toEqual({ adminId, sessionId, mfaVerified: false });
    expect(await resolve('not-a-token')).toBeNull();
  });

  it('ends after the idle limit and counts it from the last request, which each resolve moves', async () => {
    const { adminId, token } = await signedIn();
    world.clock.advance(59 * MINUTE);
    expect(await world.sessions.resolve(token)).not.toBeNull();
    const [touched] = await world.rows.sessions(adminId);
    expect(touched?.lastSeenAt).toEqual(world.clock.now());
    world.clock.advance(59 * MINUTE);
    expect(await world.sessions.resolve(token)).not.toBeNull();
    world.clock.advance(60 * MINUTE);
    expect(await world.sessions.resolve(token)).toBeNull();
  });

  it('ends at the absolute limit however recently it was used, and use never extends it', async () => {
    const { adminId, token } = await signedIn();
    for (let visit = 0; visit < 14; visit += 1) {
      world.clock.advance(50 * MINUTE);
      expect(await world.sessions.resolve(token)).not.toBeNull();
    }
    const [row] = await world.rows.sessions(adminId);
    expect(row?.expiresAt).toEqual(new Date('2026-10-20T20:00:00Z'));
    world.clock.advance(30 * MINUTE);
    expect(await world.sessions.resolve(token)).toBeNull();
  });

  it('reads both limits from settings', async () => {
    world = buildAdmin(database, {
      settings: { admin_session_idle_minutes: 5, admin_session_max_hours: 1 },
    });
    const idle = await signedIn();
    world.clock.advance(5 * MINUTE);
    expect(await world.sessions.resolve(idle.token)).toBeNull();

    const busy = await signedIn();
    for (let step = 0; step < 15; step += 1) {
      world.clock.advance(4 * MINUTE);
      const answer = await world.sessions.resolve(busy.token);
      expect(answer === null).toBe(step >= 14);
    }
  });

  it('is null for an unknown token, a revoked session, a disabled administrator or one without a password', async () => {
    expect(await world.sessions.resolve('unknown')).toBeNull();

    const revoked = await signedIn();
    await inTransaction(database, (tx) => world.sessions.signOut(revoked.sessionId, tx));
    expect(await world.sessions.resolve(revoked.token)).toBeNull();

    const disabled = await world.createAdministrator({ isActive: false });
    const disabledSession = await world.sessions.issue(disabled.adminId);
    expect(await world.sessions.resolve(disabledSession.token)).toBeNull();

    const unset = await world.createAdministrator({ password: null });
    const unsetSession = await world.sessions.issue(unset.adminId);
    expect(await world.sessions.resolve(unsetSession.token)).toBeNull();
  });

  it('is mfaVerified false for an administrator who is not enrolled, whatever the session says', async () => {
    const admin = await world.createAdministrator({ enrolled: false });
    const { token, sessionId } = await world.sessions.issue(admin.adminId);
    await inTransaction(database, (tx) => world.sessions.markVerified(sessionId, tx));
    expect(await world.sessions.resolve(token)).toEqual({
      adminId: admin.adminId,
      sessionId,
      mfaVerified: false,
    });
  });
});

describe('sign-out and revoke-all', () => {
  it('sign-out ends that session and leaves the administrator’s others', async () => {
    const { adminId, token, sessionId } = await signedIn();
    const other = await world.sessions.issue(adminId);
    await inTransaction(database, (tx) => world.sessions.signOut(sessionId, tx));
    expect(await world.sessions.resolve(token)).toBeNull();
    expect(await world.sessions.resolve(other.token)).not.toBeNull();
    const rows = await world.rows.sessions(adminId);
    expect(rows.find(({ id }) => id === sessionId)?.revokedAt).toEqual(world.clock.now());
  });

  it('a second factor passed on a session ended meanwhile answers ADMIN_SIGN_IN_FAILED, so the panel starts again', async () => {
    const { sessionId } = await signedIn();
    await inTransaction(database, (tx) => world.sessions.signOut(sessionId, tx));
    const error = await inTransaction(database, (tx) =>
      world.sessions.markVerified(sessionId, tx),
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toMatchObject({ code: 'ADMIN_SIGN_IN_FAILED' });
  });

  it('signing out twice changes nothing the first did not', async () => {
    const { adminId, sessionId } = await signedIn();
    await inTransaction(database, (tx) => world.sessions.signOut(sessionId, tx));
    const [first] = await world.rows.sessions(adminId);
    world.clock.advance(MINUTE);
    await inTransaction(database, (tx) => world.sessions.signOut(sessionId, tx));
    const [second] = await world.rows.sessions(adminId);
    expect(second?.revokedAt).toEqual(first?.revokedAt);
  });

  it('revoke-all ends every live session of the administrator and no one else’s', async () => {
    const { adminId, token } = await signedIn();
    const second = await world.sessions.issue(adminId);
    const stranger = await signedIn();
    const revoked = await inTransaction(database, (tx) => world.sessions.revokeAll(adminId, tx));
    expect(revoked).toBe(2);
    expect(await world.sessions.resolve(token)).toBeNull();
    expect(await world.sessions.resolve(second.token)).toBeNull();
    expect(await world.sessions.resolve(stranger.token)).not.toBeNull();
  });
});
