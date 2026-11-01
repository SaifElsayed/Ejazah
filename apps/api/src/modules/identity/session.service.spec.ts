// T044: a device's session (research R-101, FR-135, FR-108). The access token is
// `v1.<session id>.<expiry>.<HMAC-SHA256>` under `ijazah:access-token:v1`, fifteen minutes, a
// pointer and never a claim set: every request resolves the row and the account's standing
// (data-model §6). The refresh token is 32 random bytes, stored only as its SHA-256; each refresh
// rotates it, the retired hash kept for the grace window: presented within it, it is answered once
// more; presented after it, it revokes the session (reuse detection). A refused token says nothing
// of why. Over the real database and a clock of the spec's own.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { createHash, createHmac } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { deriveSubkey } from '../../platform/crypto/encryption.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import {
  buildIdentity,
  createAccount,
  createTeacherProfile,
  type Identity,
  openSpecDatabase,
  rowsOf,
  SPEC_ENCRYPTION_KEY,
} from './__fixtures__/identity.js';
import { landingFor } from './session.service.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let identity: Identity;
beforeEach(() => {
  identity = buildIdentity(database);
});

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

async function signedIn(options: Parameters<typeof createAccount>[1] = {}) {
  const account = await createAccount(database, options);
  const tokens = await identity.sessions.issue(account.userId);
  return { ...account, ...tokens };
}

const sessionRows = (userId: string) => rowsOf(database).sessions(userId);

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

describe('issue', () => {
  it('signs a short access token that points at the row, and stores the refresh token as its hash', async () => {
    const { userId, accessToken, refreshToken } = await signedIn();
    const [row] = await sessionRows(userId);
    const [version, sessionId, expiry, mac] = accessToken.split('.');
    expect(version).toBe('v1');
    expect(sessionId).toBe(row?.id);
    expect(expiry).toBe('2026-10-20T08:15:00Z');
    const key = deriveSubkey(SPEC_ENCRYPTION_KEY, 'ijazah:access-token:v1');
    expect(mac).toBe(
      createHmac('sha256', key).update(`v1.${sessionId}.${expiry}`).digest('base64url'),
    );
    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row?.refreshTokenHash).toBe(sha256(refreshToken));
    expect(JSON.stringify(row)).not.toContain(refreshToken);
    expect(row?.issuedAt.toISOString()).toBe('2026-10-20T08:00:00.000Z');
    expect(row?.expiresAt.toISOString()).toBe('2026-11-19T08:00:00.000Z');
  });
});

describe('resolveUserSession', () => {
  it('yields the standing of data-model §6 for a live session', async () => {
    const { userId, accessToken } = await signedIn({ gender: 'male' });
    const [row] = await sessionRows(userId);
    await expect(identity.sessions.resolveUserSession(accessToken)).resolves.toEqual({
      userId,
      sessionId: row?.id,
      role: 'student',
      gender: 'male',
      preferredLanguage: 'ar',
      accountStatus: 'active',
    });
  });

  it('reads a teacher’s standing from the profile, and none before there is one', async () => {
    const applicant = await signedIn({ role: 'teacher' });
    const resolved = await identity.sessions.resolveUserSession(applicant.accessToken);
    expect(resolved?.role).toBe('teacher');
    expect(resolved?.teacher).toBeUndefined();
    const approved = await signedIn({ role: 'teacher' });
    await createTeacherProfile(database, approved.userId, {
      verificationStatus: 'approved',
      applicationStatus: 'approved',
      payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    });
    expect((await identity.sessions.resolveUserSession(approved.accessToken))?.teacher).toEqual({
      verificationStatus: 'approved',
      payoutVerified: true,
      applicationStatus: 'approved',
    });
  });

  it('reads the standing on every call, so a suspension shows at once', async () => {
    const { userId, accessToken } = await signedIn();
    await rowsOf(database).setAccountStatus(userId, 'suspended');
    expect((await identity.sessions.resolveUserSession(accessToken))?.accountStatus).toBe(
      'suspended',
    );
  });

  it('answers null, never a throw, for a token it does not accept', async () => {
    const { userId, accessToken } = await signedIn();
    const [version, sessionId, expiry, mac] = accessToken.split('.');
    const tampered = [
      `${version}.${sessionId}.2027-01-01T00:00:00Z.${mac}`,
      `${version}.${sessionId}.${expiry}.${mac?.slice(1)}A`,
      `v2.${sessionId}.${expiry}.${mac}`,
      'garbage',
      '',
      `${accessToken}.extra`,
    ];
    for (const token of tampered) {
      await expect(identity.sessions.resolveUserSession(token), token).resolves.toBeNull();
    }
    // The same shape under another key.
    const other = buildIdentity(database);
    const otherKey = deriveSubkey(Buffer.alloc(32, 7).toString('base64'), 'ijazah:access-token:v1');
    const forged = `v1.${sessionId}.${expiry}.${createHmac('sha256', otherKey)
      .update(`v1.${sessionId}.${expiry}`)
      .digest('base64url')}`;
    await expect(other.sessions.resolveUserSession(forged)).resolves.toBeNull();
    // Expired, then revoked.
    identity.clock.advance(15 * MINUTE);
    await expect(identity.sessions.resolveUserSession(accessToken)).resolves.toBeNull();
    const fresh = await identity.sessions.issue(userId);
    await identity.sessions.revokeAll(userId, 'admin_action');
    await expect(identity.sessions.resolveUserSession(fresh.accessToken)).resolves.toBeNull();
  });

  it('answers null for a deleted account’s session', async () => {
    const { userId, accessToken } = await signedIn();
    await rowsOf(database).softDelete(userId);
    await expect(identity.sessions.resolveUserSession(accessToken)).resolves.toBeNull();
  });
});

describe('landing', () => {
  it.each([
    [{ role: 'student', accountStatus: 'active' }, 'student_home'],
    [{ role: 'student', accountStatus: 'verification_required' }, 'student_home'],
    [{ role: 'student', accountStatus: 'suspended' }, 'restricted'],
    [{ role: 'teacher', accountStatus: 'banned' }, 'restricted'],
    [{ role: 'teacher', accountStatus: 'active' }, 'teacher_application'],
    [
      { role: 'teacher', accountStatus: 'active', teacher: { verificationStatus: 'pending' } },
      'teacher_application',
    ],
    [
      { role: 'teacher', accountStatus: 'active', teacher: { verificationStatus: 'revoked' } },
      'teacher_application',
    ],
    [
      { role: 'teacher', accountStatus: 'active', teacher: { verificationStatus: 'approved' } },
      'teacher_home',
    ],
  ] as const)('%o lands on %s', (standing, landing) => {
    expect(landingFor(standing)).toBe(landing);
  });
});

describe('refresh', () => {
  it('rotates: a new pair, the absolute expiry kept', async () => {
    const { userId, refreshToken } = await signedIn();
    identity.clock.advance(DAY);
    const next = await identity.sessions.refresh(refreshToken);
    expect(next.refreshToken).not.toBe(refreshToken);
    await expect(identity.sessions.resolveUserSession(next.accessToken)).resolves.toMatchObject({
      userId,
    });
    const [row] = await sessionRows(userId);
    expect(row?.refreshTokenHash).toBe(sha256(next.refreshToken));
    expect(row?.previousRefreshTokenHash).toBe(sha256(refreshToken));
    expect(row?.refreshedAt?.toISOString()).toBe('2026-10-21T08:00:00.000Z');
    expect(row?.expiresAt.toISOString()).toBe('2026-11-19T08:00:00.000Z');
  });

  it('answers the retired token once within the grace, and the session goes on', async () => {
    const { userId, refreshToken } = await signedIn();
    await identity.sessions.refresh(refreshToken);
    identity.clock.advance(20);
    const again = await identity.sessions.refresh(refreshToken);
    await expect(identity.sessions.resolveUserSession(again.accessToken)).resolves.toMatchObject({
      userId,
    });
    const latest = await identity.sessions.refresh(again.refreshToken);
    await expect(identity.sessions.resolveUserSession(latest.accessToken)).resolves.toMatchObject({
      userId,
    });
  });

  it('revokes the session when a token already answered once comes back, even within the grace (T094)', async () => {
    const { userId, refreshToken } = await signedIn();
    await identity.sessions.refresh(refreshToken);
    identity.clock.advance(10);
    const again = await identity.sessions.refresh(refreshToken);
    identity.clock.advance(5);
    await expect(identity.sessions.refresh(refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect((await sessionRows(userId))[0]?.revokedReason).toBe('reuse_detected');
    await expect(identity.sessions.resolveUserSession(again.accessToken)).resolves.toBeNull();
  });

  it('catches a stolen token rotated twice: the device’s token then revokes the session for both (T094)', async () => {
    const { userId, refreshToken: devices } = await signedIn();
    // The thief presents the stolen token first, twice in a row, so the device's token is no longer
    // the one the row remembers as retired.
    const first = await identity.sessions.refresh(devices);
    const thiefs = await identity.sessions.refresh(first.refreshToken);
    identity.clock.advance(15 * MINUTE);
    await expect(identity.sessions.refresh(devices)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect((await sessionRows(userId))[0]?.revokedReason).toBe('reuse_detected');
    await expect(identity.sessions.refresh(thiefs.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(identity.sessions.resolveUserSession(thiefs.accessToken)).resolves.toBeNull();
  });

  it('keeps every hash a rotation retires, and only its hash (T094)', async () => {
    const { userId, refreshToken } = await signedIn();
    const first = await identity.sessions.refresh(refreshToken);
    await identity.sessions.refresh(first.refreshToken);
    const [session] = await sessionRows(userId);
    const retired = await rowsOf(database).retiredTokens(session?.id ?? '');
    expect(retired.map((row) => row.tokenHash)).toEqual([
      sha256(refreshToken),
      sha256(first.refreshToken),
    ]);
    expect(JSON.stringify(retired)).not.toContain(refreshToken);
  });

  it('revokes the whole session when the retired token comes back after the grace', async () => {
    const { userId, refreshToken } = await signedIn();
    const next = await identity.sessions.refresh(refreshToken);
    identity.clock.advance(31);
    await expect(identity.sessions.refresh(refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const [row] = await sessionRows(userId);
    expect(row?.revokedReason).toBe('reuse_detected');
    await expect(identity.sessions.refresh(next.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(identity.sessions.resolveUserSession(next.accessToken)).resolves.toBeNull();
  });

  it('refuses an unknown, a revoked and an expired token alike, saying nothing of which', async () => {
    const unknown = await identity.sessions
      .refresh('A'.repeat(43))
      .catch((error: unknown) => error);
    const { userId, refreshToken } = await signedIn();
    await identity.sessions.revokeAll(userId, 'admin_action');
    const revoked = await identity.sessions.refresh(refreshToken).catch((error: unknown) => error);
    const old = await signedIn();
    identity.clock.advance(30 * DAY);
    const expired = await identity.sessions
      .refresh(old.refreshToken)
      .catch((error: unknown) => error);
    for (const refusal of [unknown, revoked, expired]) {
      expect(refusal).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.' });
      expect((refusal as { details?: unknown }).details).toBeUndefined();
    }
  });
});

describe('sign-out and revokeAll', () => {
  it('signs out one device and leaves the others', async () => {
    const { userId, accessToken } = await signedIn();
    identity.clock.advance(1);
    const other = await identity.sessions.issue(userId);
    const resolved = await identity.sessions.resolveUserSession(accessToken);
    await identity.sessions.signOut(resolved?.sessionId ?? '');
    await expect(identity.sessions.resolveUserSession(accessToken)).resolves.toBeNull();
    await expect(identity.sessions.resolveUserSession(other.accessToken)).resolves.not.toBeNull();
    const reasons = (await sessionRows(userId)).map((row) => row.revokedReason);
    expect(reasons).toEqual(['sign_out', null]);
  });

  it('revokes every session of the person with the reason, keeping one when told', async () => {
    const { userId } = await signedIn();
    identity.clock.advance(1);
    await identity.sessions.issue(userId);
    identity.clock.advance(1);
    const kept = await identity.sessions.issue(userId);
    const keptId = (await identity.sessions.resolveUserSession(kept.accessToken))?.sessionId;
    await expect(
      identity.sessions.revokeAll(userId, 'password_reset', { except: keptId }),
    ).resolves.toBe(2);
    const rows = await sessionRows(userId);
    expect(rows.map((row) => row.revokedReason)).toEqual([
      'password_reset',
      'password_reset',
      null,
    ]);
    await expect(identity.sessions.revokeAll(userId, 'account_banned')).resolves.toBe(1);
  });

  it('touches no other person’s session', async () => {
    const one = await signedIn();
    const two = await signedIn();
    await identity.sessions.revokeAll(one.userId, 'account_suspended');
    await expect(identity.sessions.resolveUserSession(two.accessToken)).resolves.not.toBeNull();
  });
});
