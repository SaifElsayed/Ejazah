// T060 (FR-170 to FR-174, SC-109, research R-107): an administrator's sign-in and second factor.
//
// - Sign-in answers one `ADMIN_SIGN_IN_FAILED` for an unknown email, a wrong password, a disabled
//   account, an unset password and a locked account: the same code and message, no details, and the
//   same work, since each refusal verifies a password once (the decoy where there is no usable hash).
// - The lockout is the pair of settings `admin_lockout_attempts` and `admin_lockout_minutes`; a wrong
//   password and a wrong second-factor code count alike, and an expired lock resets the count.
// - TOTP is RFC 6238 (its vectors are `platform/crypto/totp.spec.ts`'s); a code is accepted once in
//   its step.
// - Recovery codes are single use and regenerable; setup confirms a code of a secret drawn for that
//   sign-in and enrolls; `resetMfa` clears, rotates, deletes the codes and revokes the sessions.
// - The invite link is single use by `password_set_at`.
//
// The authentication throttle runs before all of this in the procedure kind's middleware (FR-172);
// its order is asserted through the router (T067, B12b), where the throttle is.
//
// Over the real database and a clock of the spec's own.
import { randomBytes } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../platform/crypto/hashing.js';
import { totpCode } from '../../platform/crypto/totp.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import {
  type AdminWorld,
  buildAdmin,
  inTransaction,
  openSpecDatabase,
  type SpecAdmin,
  SPEC_PANEL_ORIGIN,
  uniqueEmail,
} from './__fixtures__/admin.js';
import type { PasswordHashing } from './admin-auth.service.js';
import { AdminInvites } from './admin-invite.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let world: AdminWorld;
beforeEach(() => {
  world = buildAdmin(database);
});

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const STEP = 30;

/** The domain error `work` rejects with. */
async function refusal(work: Promise<unknown>): Promise<DomainError> {
  const error: unknown = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof DomainError)) throw new Error(`expected a DomainError, got ${String(error)}`);
  return error;
}

/** Signs in and passes the second factor: the verified session's token. */
async function verified(admin: SpecAdmin): Promise<string> {
  const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
  await world.auth.verifyMfa(sessionToken, await world.currentCode(admin.adminId));
  return sessionToken;
}

describe('signIn', () => {
  it('opens an unverified session and answers mfa for an enrolled administrator', async () => {
    const admin = await world.createAdministrator();
    const { next, sessionToken } = await world.auth.signIn(admin.email, admin.password);
    expect(next).toBe('mfa');
    expect(await world.sessions.resolve(sessionToken)).toMatchObject({
      adminId: admin.adminId,
      mfaVerified: false,
    });
  });

  it('answers setup for an administrator not yet enrolled', async () => {
    const admin = await world.createAdministrator({ enrolled: false });
    expect((await world.auth.signIn(admin.email, admin.password)).next).toBe('setup');
  });

  it('compares the address trimmed and in lower case', async () => {
    const admin = await world.createAdministrator();
    const { next } = await world.auth.signIn(` ${admin.email.toUpperCase()} `, admin.password);
    expect(next).toBe('mfa');
  });

  it('answers one refusal for every failure, with no details and no attempts count (SC-109)', async () => {
    const usable = await world.createAdministrator();
    const disabled = await world.createAdministrator({ isActive: false });
    const unset = await world.createAdministrator({ password: null });
    const locked = await world.createAdministrator({
      failedSignInCount: 5,
      lockedUntilAt: new Date('2026-10-20T08:10:00Z'),
    });
    const refusals = await Promise.all([
      refusal(world.auth.signIn(uniqueEmail(), 'whatever password')),
      refusal(world.auth.signIn(usable.email, 'a wrong password')),
      refusal(world.auth.signIn(disabled.email, disabled.password)),
      refusal(world.auth.signIn(unset.email, 'any password at all')),
      refusal(world.auth.signIn(locked.email, locked.password)),
    ]);
    for (const error of refusals) {
      expect(error.code).toBe('ADMIN_SIGN_IN_FAILED');
      expect(error.message).toBe(refusals[0]?.message);
      expect(error.details).toBeUndefined();
    }
    expect(await world.rows.sessions(locked.adminId)).toHaveLength(0);
  });

  it('verifies a password once on every refusal, the decoy where no usable hash is, so the timings agree', async () => {
    const DELAY_MS = 100;
    const verified: string[] = [];
    const slow: PasswordHashing = {
      hash: hashPassword,
      // Every case here is a refusal: the stand-in answers no after the time a verify takes.
      async verify(_password, stored) {
        verified.push(stored);
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
        return { valid: false, needsRehash: false };
      },
    };
    world = buildAdmin(database, { passwords: slow });
    const usable = await world.createAdministrator();
    const disabled = await world.createAdministrator({ isActive: false });
    const unset = await world.createAdministrator({ password: null });
    const locked = await world.createAdministrator({
      failedSignInCount: 5,
      lockedUntilAt: new Date('2026-10-20T08:10:00Z'),
    });
    const cases = [
      () => world.auth.signIn(uniqueEmail(), 'whatever password'),
      () => world.auth.signIn(usable.email, 'a wrong password'),
      () => world.auth.signIn(disabled.email, disabled.password),
      () => world.auth.signIn(unset.email, 'any password at all'),
      () => world.auth.signIn(locked.email, locked.password),
    ];
    // The fastest of three runs of each case, so a pause of the runner is not read as a difference.
    const timings: number[] = [];
    for (const attempt of cases) {
      let fastest = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run += 1) {
        verified.length = 0;
        const started = performance.now();
        await refusal(attempt());
        fastest = Math.min(fastest, performance.now() - started);
        expect(verified).toHaveLength(1);
      }
      timings.push(fastest);
    }
    // Every refusal waits on one verify, and nothing else in any branch costs a verify's time: the
    // tolerance is one verify, wide enough for a database shared with the rest of the suite.
    for (const timing of timings) {
      expect(timing).toBeGreaterThanOrEqual(DELAY_MS - 1);
      expect(timing).toBeLessThan(2 * DELAY_MS);
    }
    expect(Math.max(...timings) - Math.min(...timings)).toBeLessThan(DELAY_MS);
  });

  it('locks the account at the configured count of failures, for the configured time', async () => {
    const admin = await world.createAdministrator();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await refusal(world.auth.signIn(admin.email, 'a wrong password'));
    }
    const row = await world.rows.administrator(admin.adminId);
    expect(row.failedSignInCount).toBe(5);
    expect(row.lockedUntilAt).toEqual(new Date('2026-10-20T08:15:00Z'));
    // The right password is refused while the lock stands, with the same answer.
    world.clock.advance(14 * MINUTE);
    expect((await refusal(world.auth.signIn(admin.email, admin.password))).code).toBe(
      'ADMIN_SIGN_IN_FAILED',
    );
    // An expired lock resets the count on the next attempt, and the right password passes.
    world.clock.advance(MINUTE);
    expect((await world.auth.signIn(admin.email, admin.password)).next).toBe('mfa');
    const after = await world.rows.administrator(admin.adminId);
    expect(after.lockedUntilAt).toBeNull();
    expect(after.failedSignInCount).toBe(0);
  });

  it('reads the lockout pair from settings', async () => {
    world = buildAdmin(database, {
      settings: { admin_lockout_attempts: 3, admin_lockout_minutes: 2 },
    });
    const admin = await world.createAdministrator();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await refusal(world.auth.signIn(admin.email, 'a wrong password'));
    }
    expect((await world.rows.administrator(admin.adminId)).lockedUntilAt).toBeNull();
    await refusal(world.auth.signIn(admin.email, 'a wrong password'));
    expect((await world.rows.administrator(admin.adminId)).lockedUntilAt).toEqual(
      new Date('2026-10-20T08:02:00Z'),
    );
  });

  it('an expired lock followed by a wrong password counts from one', async () => {
    const admin = await world.createAdministrator({
      failedSignInCount: 5,
      lockedUntilAt: new Date('2026-10-20T07:59:00Z'),
    });
    await refusal(world.auth.signIn(admin.email, 'a wrong password'));
    const row = await world.rows.administrator(admin.adminId);
    expect(row.failedSignInCount).toBe(1);
    expect(row.lockedUntilAt).toBeNull();
  });
});

describe('verifyMfa', () => {
  it('marks the session verified, records the step, clears the count and stamps the sign-in', async () => {
    const admin = await world.createAdministrator({ failedSignInCount: 2 });
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    await world.auth.verifyMfa(sessionToken, await world.currentCode(admin.adminId));
    expect(await world.sessions.resolve(sessionToken)).toMatchObject({ mfaVerified: true });
    const row = await world.rows.administrator(admin.adminId);
    // 2026-10-20T08:00:00Z, the spec clock, in steps of thirty seconds.
    expect(row.mfaLastAcceptedStep).toBe(59_749_440n);
    expect(row.failedSignInCount).toBe(0);
    expect(row.lastSignInAt).toEqual(world.clock.now());
  });

  it('refuses a code already accepted in its step, on another session too (RFC 6238 §5.2)', async () => {
    const admin = await world.createAdministrator();
    const code = await world.currentCode(admin.adminId);
    const first = await world.auth.signIn(admin.email, admin.password);
    await world.auth.verifyMfa(first.sessionToken, code);
    const second = await world.auth.signIn(admin.email, admin.password);
    expect((await refusal(world.auth.verifyMfa(second.sessionToken, code))).code).toBe(
      'CODE_INVALID',
    );
    world.clock.advance(STEP);
    await world.auth.verifyMfa(second.sessionToken, await world.currentCode(admin.adminId));
  });

  it('a wrong code is CODE_INVALID and counts toward the lockout', async () => {
    const admin = await world.createAdministrator();
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    expect((await refusal(world.auth.verifyMfa(sessionToken, '000000'))).code).toBe('CODE_INVALID');
    expect((await world.rows.administrator(admin.adminId)).failedSignInCount).toBe(1);
  });

  it('a wrong code completes a lock that wrong passwords began, after which nothing passes', async () => {
    const admin = await world.createAdministrator();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await refusal(world.auth.signIn(admin.email, 'a wrong password'));
    }
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    await refusal(world.auth.verifyMfa(sessionToken, '000000'));
    const row = await world.rows.administrator(admin.adminId);
    expect(row.failedSignInCount).toBe(5);
    expect(row.lockedUntilAt).toEqual(new Date('2026-10-20T08:15:00Z'));
    const answer = await refusal(
      world.auth.verifyMfa(sessionToken, await world.currentCode(admin.adminId)),
    );
    expect(answer.code).toBe('ADMIN_SIGN_IN_FAILED');
    expect(await world.sessions.resolve(sessionToken)).toMatchObject({ mfaVerified: false });
  });

  it('answers MFA_SETUP_REQUIRED for an administrator not yet enrolled', async () => {
    const admin = await world.createAdministrator({ enrolled: false });
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    expect((await refusal(world.auth.verifyMfa(sessionToken, '123456'))).code).toBe(
      'MFA_SETUP_REQUIRED',
    );
  });

  it('answers ADMIN_SIGN_IN_FAILED for a token that is no pending session', async () => {
    const admin = await world.createAdministrator();
    const token = await verified(admin);
    const code = await world.currentCode(admin.adminId);
    expect((await refusal(world.auth.verifyMfa('unknown', code))).code).toBe('ADMIN_SIGN_IN_FAILED');
    expect((await refusal(world.auth.verifyMfa(token, code))).code).toBe('ADMIN_SIGN_IN_FAILED');
  });
});

describe('setup', () => {
  it('draws a fresh secret on each begin, shows it once as a URI and a key, and stores the last', async () => {
    const admin = await world.createAdministrator({ enrolled: false });
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    const first = await world.auth.beginSetup(sessionToken);
    const second = await world.auth.beginSetup(sessionToken);
    expect(second.manualKey).not.toBe(first.manualKey);
    expect(second.manualKey).not.toBe(admin.secret);
    expect(await world.storedSecret(admin.adminId)).toBe(second.manualKey);
    const uri = new URL(second.otpauthUri);
    expect(uri.searchParams.get('secret')).toBe(second.manualKey);
    expect(decodeURIComponent(uri.pathname)).toBe(`/Ijazah:${admin.email}`);
    // A code of the first secret no longer confirms.
    const stale = await totpCode(first.manualKey, world.clock.now());
    expect((await refusal(world.auth.confirmSetup(sessionToken, stale))).code).toBe('CODE_INVALID');
  });

  it('confirming enrolls, issues the configured count of recovery codes once, and verifies the session', async () => {
    world = buildAdmin(database, { settings: { admin_recovery_code_count: 4 } });
    const admin = await world.createAdministrator({ enrolled: false });
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    const { manualKey } = await world.auth.beginSetup(sessionToken);
    const { recoveryCodes } = await world.auth.confirmSetup(
      sessionToken,
      await totpCode(manualKey, world.clock.now()),
    );
    expect(recoveryCodes).toHaveLength(4);
    for (const code of recoveryCodes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    const row = await world.rows.administrator(admin.adminId);
    expect(row.mfaEnrolledAt).toEqual(world.clock.now());
    expect(await world.sessions.resolve(sessionToken)).toMatchObject({ mfaVerified: true });
    const stored = await world.rows.recoveryCodes(admin.adminId);
    expect(stored).toHaveLength(4);
    for (const code of recoveryCodes) {
      expect(JSON.stringify(stored)).not.toContain(code);
    }
  });

  it('a wrong confirmation code counts toward the lockout', async () => {
    const admin = await world.createAdministrator({ enrolled: false });
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    await world.auth.beginSetup(sessionToken);
    expect((await refusal(world.auth.confirmSetup(sessionToken, '000000'))).code).toBe(
      'CODE_INVALID',
    );
    expect((await world.rows.administrator(admin.adminId)).failedSignInCount).toBe(1);
  });

  it('is refused once enrolled', async () => {
    const admin = await world.createAdministrator();
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    expect((await refusal(world.auth.beginSetup(sessionToken))).code).toBe('FORBIDDEN');
    expect((await refusal(world.auth.confirmSetup(sessionToken, '123456'))).code).toBe('FORBIDDEN');
  });
});

// Each case enrols and hashes its codes, ten peppered Argon2id hashes and their checks: past the
// default five seconds under the full suite's parallel load (B13a review, follow-up 7).
describe('recovery codes', { timeout: 15_000 }, () => {
  async function enrolledWithCodes() {
    const admin = await world.createAdministrator({ enrolled: false });
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    const { manualKey } = await world.auth.beginSetup(sessionToken);
    const { recoveryCodes } = await world.auth.confirmSetup(
      sessionToken,
      await totpCode(manualKey, world.clock.now()),
    );
    return { admin, recoveryCodes };
  }

  it('a code verifies a new session once, and is spent', async () => {
    const { admin, recoveryCodes } = await enrolledWithCodes();
    const [code] = recoveryCodes;
    const first = await world.auth.signIn(admin.email, admin.password);
    expect(await world.auth.recover(first.sessionToken, code ?? '')).toEqual({ remainingCodes: 9 });
    expect(await world.sessions.resolve(first.sessionToken)).toMatchObject({ mfaVerified: true });
    const used = await world.rows.recoveryCodes(admin.adminId);
    expect(used.filter(({ usedAt }) => usedAt !== null)).toHaveLength(1);

    const second = await world.auth.signIn(admin.email, admin.password);
    expect((await refusal(world.auth.recover(second.sessionToken, code ?? ''))).code).toBe(
      'CODE_INVALID',
    );
    expect((await world.rows.administrator(admin.adminId)).failedSignInCount).toBe(1);
  });

  it('accepts a code typed in lower case or grouped with a hyphen or spaces', async () => {
    const { admin, recoveryCodes } = await enrolledWithCodes();
    const [code = ''] = recoveryCodes;
    const typed = `${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase();
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    expect(await world.auth.recover(sessionToken, ` ${typed} `)).toEqual({ remainingCodes: 9 });
  });

  it('a wrong code is CODE_INVALID and counts', async () => {
    const { admin } = await enrolledWithCodes();
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    expect((await refusal(world.auth.recover(sessionToken, '0000000000'))).code).toBe('CODE_INVALID');
    expect((await refusal(world.auth.recover(sessionToken, 'short'))).code).toBe('CODE_INVALID');
    expect((await world.rows.administrator(admin.adminId)).failedSignInCount).toBe(2);
  });

  it('regenerating replaces the set: the old codes are refused, the new ones pass', async () => {
    const { admin, recoveryCodes } = await enrolledWithCodes();
    const fresh = await inTransaction(database, (tx) =>
      world.admins.regenerateRecoveryCodes(tx, admin.adminId),
    );
    expect(fresh.recoveryCodes).toHaveLength(10);
    expect(await world.rows.recoveryCodes(admin.adminId)).toHaveLength(10);
    const { sessionToken } = await world.auth.signIn(admin.email, admin.password);
    await refusal(world.auth.recover(sessionToken, recoveryCodes[0] ?? ''));
    expect(await world.auth.recover(sessionToken, fresh.recoveryCodes[0] ?? '')).toEqual({
      remainingCodes: 9,
    });
  });
});

describe('resetMfa', () => {
  it('clears the enrolment, rotates the secret, deletes the codes and ends every session', async () => {
    const actor = await world.createAdministrator();
    const target = await world.createAdministrator();
    const token = await verified(target);
    await inTransaction(database, (tx) =>
      world.admins.regenerateRecoveryCodes(tx, target.adminId),
    );
    await inTransaction(database, (tx) => world.admins.resetMfa(tx, actor.adminId, target.adminId));
    const row = await world.rows.administrator(target.adminId);
    expect(row.mfaEnrolledAt).toBeNull();
    expect(row.mfaLastAcceptedStep).toBeNull();
    expect(await world.storedSecret(target.adminId)).not.toBe(target.secret);
    expect(await world.rows.recoveryCodes(target.adminId)).toHaveLength(0);
    expect(await world.sessions.resolve(token)).toBeNull();
    // The next sign-in repeats the setup.
    expect((await world.auth.signIn(target.email, target.password)).next).toBe('setup');
  });

  it('refuses the administrator’s own reset', async () => {
    const actor = await world.createAdministrator();
    const answer = await refusal(
      inTransaction(database, (tx) => world.admins.resetMfa(tx, actor.adminId, actor.adminId)),
    );
    expect(answer.code).toBe('FORBIDDEN');
  });
});

describe('setPassword: the invite link, single use by password_set_at', () => {
  async function invited() {
    const inviter = await world.createAdministrator();
    const admin = await world.createAdministrator({
      password: null,
      enrolled: false,
      invitedAt: world.clock.now(),
      invitedByAdminId: inviter.adminId,
    });
    const prepared = await world.invites.prepare(admin.adminId);
    if (prepared === null) throw new Error('the invite was not prepared');
    const token = new URL(prepared.link).hash.replace('#token=', '');
    return { admin, token };
  }

  it('sets the password once; the administrator then signs in and is sent to setup', async () => {
    const { admin, token } = await invited();
    await world.auth.setPassword(token, 'a new admin passphrase');
    const row = await world.rows.administrator(admin.adminId);
    expect(row.passwordSetAt).toEqual(world.clock.now());
    expect((await world.auth.signIn(admin.email, 'a new admin passphrase')).next).toBe('setup');
    expect((await refusal(world.auth.setPassword(token, 'another passphrase'))).code).toBe(
      'INVITE_INVALID',
    );
  });

  it('refuses a link past its lifetime, read from settings', async () => {
    const { token } = await invited();
    world.clock.advance(48 * HOUR);
    expect((await refusal(world.auth.setPassword(token, 'a new admin passphrase'))).code).toBe(
      'INVITE_INVALID',
    );
  });

  it('refuses a link altered in any part, or signed under another key', async () => {
    const { admin, token } = await invited();
    const [version, adminId, expiry, mac = ''] = token.split('.');
    // Each alteration differs from what was signed whatever the random id and MAC hold: a
    // character replaced by one it is not (CI found the id starting with "0" one time in sixteen).
    const other = (character: string) => (character === '0' ? '1' : '0');
    const altered = [
      [version, adminId, '2099-01-01T00:00:00Z', mac].join('.'),
      [version, admin.adminId.replace(/^./, other), expiry, mac].join('.'),
      [version, adminId, expiry, mac.replace(/.$/, (last) => (last === 'A' ? 'B' : 'A'))].join('.'),
      'not-a-token',
    ];
    for (const candidate of altered) {
      expect((await refusal(world.auth.setPassword(candidate, 'a new admin passphrase'))).code).toBe(
        'INVITE_INVALID',
      );
    }
    const otherKey = new AdminInvites({
      database,
      settings: world.settings,
      encryptionKey: randomBytes(32).toString('base64'),
      panelOrigin: SPEC_PANEL_ORIGIN,
      now: world.clock.now,
    });
    const foreign = await otherKey.prepare(admin.adminId);
    const foreignToken = new URL(foreign?.link ?? 'https://x.invalid').hash.replace('#token=', '');
    expect(foreignToken).not.toBe('');
    expect((await refusal(world.auth.setPassword(foreignToken, 'a new admin passphrase'))).code).toBe(
      'INVITE_INVALID',
    );
  });

  it('refuses a disabled administrator’s link', async () => {
    const { admin, token } = await invited();
    const actor = await world.createAdministrator();
    await inTransaction(database, (tx) => world.admins.disable(tx, actor.adminId, admin.adminId));
    expect((await refusal(world.auth.setPassword(token, 'a new admin passphrase'))).code).toBe(
      'INVITE_INVALID',
    );
  });

  it('refuses a breached password with PASSWORD_WEAK and keeps the link usable', async () => {
    const { token } = await invited();
    expect((await refusal(world.auth.setPassword(token, 'password123'))).code).toBe('PASSWORD_WEAK');
    await world.auth.setPassword(token, 'a new admin passphrase');
  });
});
