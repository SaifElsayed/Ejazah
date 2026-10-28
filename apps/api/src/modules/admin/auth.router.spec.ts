// T067 — the administrator surface's `auth` namespace as it is served (admin-surface.md "`auth`" and
// "Rate-limit subjects"; FR-170 to FR-172). The router is thin: the input schema, the declared rate
// limit, one service call, the output schema. These cases prove the wiring through the caller
// kinds, as over HTTP: what each procedure counts (the budget first, then the subject the contract
// names), the throttle standing in front of the lockout (FR-172), one refusal for every failed
// sign-in whatever the cause, and the two signed-in procedures audited like any other call. What
// the services decide is proven by their own specs (B12a).
import { createHash } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { toErrorShape } from '../../surfaces/procedures.js';
import {
  type AdminWorld,
  buildAdmin,
  openSpecDatabase,
  SPEC_PASSWORD,
  uniqueEmail,
} from './__fixtures__/admin.js';
import { type AdminSurface, metaOf, surfaceOf, verifiedToken } from './__fixtures__/surface.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let world: AdminWorld;
let surface: AdminSurface;
beforeEach(() => {
  world = buildAdmin(database);
  surface = surfaceOf(world, database);
});

const TOTP_STEP_SECONDS = 30;

const sha256 = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** What a caller was refused with, as the surface sends it. */
async function refusalOf(call: Promise<unknown>) {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return toErrorShape(thrown as Parameters<typeof toErrorShape>[0]);
}

describe('the namespace', () => {
  it('declares the six sign-in procedures on the anonymous kind with the authentication limit, and signOut and me on the administrator kind', () => {
    const limited = { surface: 'admin', rateLimit: 'rate_limit_authentication' };
    for (const path of [
      'auth.signIn',
      'auth.mfa.verify',
      'auth.mfa.recover',
      'auth.mfa.setup.begin',
      'auth.mfa.setup.confirm',
      'auth.setPassword',
    ]) {
      expect(metaOf(path)).toEqual(limited);
    }
    expect(metaOf('auth.signOut')).toEqual({ surface: 'admin' });
    expect(metaOf('auth.me')).toEqual({ surface: 'admin' });
  });
});

describe('auth.signIn', () => {
  it('counts the authentication budget, then the address in lower case, and answers what comes next', async () => {
    const admin = await world.createAdministrator();
    const answer = await surface
      .anonymous()
      .auth.signIn({ email: admin.email.toUpperCase(), password: admin.password });
    expect(answer).toEqual({ next: 'mfa', sessionToken: expect.any(String) });
    expect(surface.counts()).toEqual([
      ['rate_limit_authentication_budget', '*'],
      ['rate_limit_authentication', admin.email],
    ]);
  });

  it('answers one refusal, byte for byte, for an unknown address, a wrong password, a disabled account and an unset password', async () => {
    const active = await world.createAdministrator();
    const disabled = await world.createAdministrator({ isActive: false });
    const unset = await world.createAdministrator({ password: null });
    const shapes = [
      await refusalOf(
        surface.anonymous().auth.signIn({ email: uniqueEmail(), password: SPEC_PASSWORD }),
      ),
      await refusalOf(
        surface.anonymous().auth.signIn({ email: active.email, password: 'not the password' }),
      ),
      await refusalOf(
        surface.anonymous().auth.signIn({ email: disabled.email, password: SPEC_PASSWORD }),
      ),
      await refusalOf(
        surface.anonymous().auth.signIn({ email: unset.email, password: SPEC_PASSWORD }),
      ),
    ];
    for (const shape of shapes) expect(JSON.stringify(shape)).toBe(JSON.stringify(shapes[0]));
    expect(shapes[0]?.body).toMatchObject({ code: 'ADMIN_SIGN_IN_FAILED' });
    expect(JSON.stringify(shapes[0])).not.toMatch(/attempt|remaining|count/i);
  });

  it('stands the throttle in front of the lockout: a refused attempt never reaches the password, so it never counts', async () => {
    const throttled = surfaceOf(world, database, { refuseAfter: { rate_limit_authentication: 2 } });
    const admin = await world.createAdministrator();
    const answers: unknown[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const shape = await refusalOf(
        throttled.anonymous().auth.signIn({ email: admin.email, password: 'not the password' }),
      );
      answers.push((shape.body as { code: string }).code);
    }
    expect(answers).toEqual([
      'ADMIN_SIGN_IN_FAILED',
      'ADMIN_SIGN_IN_FAILED',
      'RATE_LIMITED',
      'RATE_LIMITED',
      'RATE_LIMITED',
      'RATE_LIMITED',
      'RATE_LIMITED',
    ]);
    const row = await world.rows.administrator(admin.adminId);
    expect(row.failedSignInCount).toBe(2);
    expect(row.lockedUntilAt).toBeNull();
  });

  it('refuses an input outside the schema before anything is counted', async () => {
    const shape = await refusalOf(
      surface.anonymous().auth.signIn({ email: 'not an address', password: SPEC_PASSWORD }),
    );
    expect(shape.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(surface.counts()).toEqual([]);
  });
});

describe('the second factor', () => {
  it('auth.mfa.verify counts the session token’s SHA-256 and verifies the session', async () => {
    const admin = await world.createAdministrator();
    const { sessionToken } = await surface
      .anonymous()
      .auth.signIn({ email: admin.email, password: admin.password });
    await expect(
      surface
        .anonymous()
        .auth.mfa.verify({ sessionToken, code: await world.currentCode(admin.adminId) }),
    ).resolves.toBeUndefined();
    expect(surface.counts().at(-1)).toEqual(['rate_limit_authentication', sha256(sessionToken)]);
    expect(await world.sessions.resolve(sessionToken)).toMatchObject({ mfaVerified: true });
  });

  it('auth.mfa.recover, setup.begin and setup.confirm count the session token’s SHA-256', async () => {
    const enrolled = await world.createAdministrator();
    const first = await surface
      .anonymous()
      .auth.signIn({ email: enrolled.email, password: enrolled.password });
    const wrong = await refusalOf(
      surface
        .anonymous()
        .auth.mfa.recover({ sessionToken: first.sessionToken, recoveryCode: 'AAAAA-AAAAA' }),
    );
    expect(wrong.body).toMatchObject({ code: 'CODE_INVALID' });
    expect(surface.counts().at(-1)).toEqual([
      'rate_limit_authentication',
      sha256(first.sessionToken),
    ]);

    const newcomer = await world.createAdministrator({ enrolled: false });
    const second = await surface
      .anonymous()
      .auth.signIn({ email: newcomer.email, password: newcomer.password });
    expect(second.next).toBe('setup');
    const begun = await surface
      .anonymous()
      .auth.mfa.setup.begin({ sessionToken: second.sessionToken });
    expect(begun).toEqual({
      otpauthUri: expect.stringMatching(/^otpauth:\/\/totp\//),
      manualKey: expect.any(String),
    });
    expect(surface.counts().at(-1)).toEqual([
      'rate_limit_authentication',
      sha256(second.sessionToken),
    ]);
    const confirmed = await surface.anonymous().auth.mfa.setup.confirm({
      sessionToken: second.sessionToken,
      code: await world.currentCode(newcomer.adminId),
    });
    expect(confirmed.recoveryCodes).toHaveLength(10);
    expect(surface.counts().at(-1)).toEqual([
      'rate_limit_authentication',
      sha256(second.sessionToken),
    ]);
  });

  it('auth.setPassword counts the invite token’s SHA-256', async () => {
    const shape = await refusalOf(
      surface
        .anonymous()
        .auth.setPassword({ inviteToken: 'v1.altered', password: 'a long enough password' }),
    );
    expect(shape.body).toMatchObject({ code: 'INVITE_INVALID' });
    expect(surface.counts()).toEqual([['rate_limit_authentication', sha256('v1.altered')]]);
  });
});

describe('auth.me and auth.signOut', () => {
  it('auth.me answers the sidebar’s administrator and is audited as a read naming the reader', async () => {
    const admin = await world.createAdministrator({ displayName: 'سلمى نبيل' });
    const token = await verifiedToken(surface, world, admin);
    const me = await (await surface.bearing(token)).auth.me();
    expect(me).toEqual({ adminId: admin.adminId, displayName: 'سلمى نبيل', email: admin.email });
    const [entry] = await world.rows.auditEntriesOf(admin.adminId);
    expect(entry).toMatchObject({
      adminId: admin.adminId,
      action: 'auth.read',
      targetType: 'admin',
    });
  });

  it('auth.signOut ends this session only, audited as admin.sign_out', async () => {
    const admin = await world.createAdministrator();
    const token = await verifiedToken(surface, world, admin);
    // A code is accepted once per time step (RFC 6238 §5.2), so the second session waits for the next.
    world.clock.advance(TOTP_STEP_SECONDS);
    const other = await verifiedToken(surface, world, admin);
    await expect((await surface.bearing(token)).auth.signOut({})).resolves.toBeUndefined();
    expect(await world.sessions.resolve(token)).toBeNull();
    expect(await world.sessions.resolve(other)).not.toBeNull();
    const [entry] = await world.rows.auditEntriesOf(admin.adminId);
    expect(entry).toMatchObject({
      action: 'admin.sign_out',
      targetType: 'admin',
      targetId: admin.adminId,
    });
  });

  it('refuses both to an anonymous caller and to a session whose second factor is not passed', async () => {
    const admin = await world.createAdministrator();
    const { sessionToken } = await surface
      .anonymous()
      .auth.signIn({ email: admin.email, password: admin.password });
    expect((await refusalOf(surface.anonymous().auth.me())).body).toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(
      (await refusalOf((await surface.bearing(sessionToken)).auth.signOut({}))).body,
    ).toMatchObject({
      code: 'MFA_REQUIRED',
    });
  });
});
