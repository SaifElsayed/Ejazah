// T043: the first sign-in (FR-124 to FR-127, research R-102, SC-103). A proven identity rides in a
// signed, stateless onboarding token, `v1.<payload>.<HMAC>` under `ijazah:onboarding-token:v1`, for
// `onboarding_token_ttl_minutes`. `complete` writes the person, the identity or the password hash,
// the one role and the terms acceptance and a session in one transaction, and only then; a failure
// mid-way leaves no row; the token's `jti` is claimed once in Redis; nothing of the person is stored
// before `complete` commits, so an abandoned flow leaves no row anywhere. Over the real database,
// the stand-ins and in-memory marks.
import { createHmac } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createColumnCipher, deriveSubkey } from '../../platform/crypto/encryption.js';
import { verifyPassword } from '../../platform/crypto/hashing.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import {
  buildIdentity,
  codeMailedTo,
  createAccount,
  type Identity,
  openSpecDatabase,
  rowsNaming,
  specIdentityToken,
  SPEC_ENCRYPTION_KEY,
  uniqueEmail,
  uniqueSubject,
} from './identity.fixtures.js';
import { OnboardingService } from './onboarding.service.js';
import type { SessionService } from './session.service.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let identity: Identity;
beforeEach(() => {
  identity = buildIdentity(database);
});

const answers = {
  role: 'student',
  displayName: 'سارة عادل',
  gender: 'female',
  dateOfBirth: '1990-04-12',
  timezone: 'Africa/Cairo',
  termsVersion: '2026-10',
} as const;

async function providerToken(
  provider: 'google' | 'apple',
  {
    subject = uniqueSubject(),
    email = uniqueEmail() as string | null,
    emailVerified = true,
    authorizationCode,
  }: {
    subject?: string;
    email?: string | null;
    emailVerified?: boolean;
    authorizationCode?: string;
  } = {},
) {
  const { nonce } = await identity.signIn.providerNonce();
  const answer = await identity.signIn.signInWithProvider({
    provider,
    nonce,
    identityToken: specIdentityToken({ provider, subject, email, emailVerified, nonce }),
    ...(authorizationCode === undefined ? {} : { authorizationCode }),
  });
  if (answer.outcome !== 'onboarding') throw new Error('expected an onboarding token');
  return { onboardingToken: answer.onboardingToken, subject, email };
}

async function emailToken(address = uniqueEmail()) {
  await identity.emailAuth.requestSignUpCode(address);
  await vi.waitFor(() => expect(identity.mails().some((mail) => mail.to === address)).toBe(true));
  const { onboardingToken } = await identity.emailAuth.verifySignUpCode(
    address,
    codeMailedTo(identity.mails(), address),
  );
  return { onboardingToken, email: address };
}

describe('the onboarding token', () => {
  it('is a signed payload under its own key', async () => {
    const { onboardingToken } = await providerToken('google');
    const [version, payload, mac] = onboardingToken.split('.');
    expect(version).toBe('v1');
    const key = deriveSubkey(SPEC_ENCRYPTION_KEY, 'ijazah:onboarding-token:v1');
    expect(mac).toBe(createHmac('sha256', key).update(`v1.${payload}`).digest('base64url'));
  });

  it('is refused once it lapses, or once a byte of it changes', async () => {
    const lapsed = await providerToken('google');
    identity.clock.advance(15 * 60);
    await expect(
      identity.onboarding.complete({ ...answers, onboardingToken: lapsed.onboardingToken }),
    ).rejects.toMatchObject({ code: 'ONBOARDING_TOKEN_INVALID' });
    const fresh = await providerToken('google');
    const [version, payload, mac] = fresh.onboardingToken.split('.');
    const altered = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as Record<
      string,
      unknown
    >;
    const forged = Buffer.from(JSON.stringify({ ...altered, jti: 'other' })).toString('base64url');
    for (const token of [`${version}.${forged}.${mac}`, 'v1.x.y', 'garbage']) {
      await expect(
        identity.onboarding.complete({ ...answers, onboardingToken: token }),
      ).rejects.toMatchObject({ code: 'ONBOARDING_TOKEN_INVALID' });
    }
  });
});

describe('complete', () => {
  it('writes the account, its identity, its role and its terms, then a session, and lands it', async () => {
    const { onboardingToken, subject, email } = await providerToken('google');
    const answer = await identity.onboarding.complete({ ...answers, onboardingToken });
    expect(answer.landing).toBe('student_home');
    const session = await identity.sessions.resolveUserSession(answer.accessToken);
    expect(session).toMatchObject({ role: 'student', gender: 'female', accountStatus: 'active' });
    const userId = session?.userId ?? '';
    const user = await database.user.findUnique({ where: { id: userId } });
    expect(user).toMatchObject({
      email,
      passwordHash: null,
      displayName: 'سارة عادل',
      timezone: 'Africa/Cairo',
      preferredLanguage: 'ar',
    });
    expect(user?.dateOfBirth?.toISOString()).toBe('1990-04-12T00:00:00.000Z');
    await expect(
      database.authIdentity.findMany({
        where: { userId },
        select: { provider: true, providerSubject: true },
      }),
    ).resolves.toEqual([{ provider: 'google', providerSubject: subject }]);
    await expect(
      database.userRole.findMany({ where: { userId }, select: { role: true, status: true } }),
    ).resolves.toEqual([{ role: 'student', status: 'active' }]);
    const terms = await database.termsAcceptance.findMany({ where: { userId } });
    expect(terms.map((row) => row.termsVersion)).toEqual(['2026-10']);
    expect(terms[0]?.acceptedAt.toISOString()).toBe('2026-10-20T08:00:00.000Z');
  });

  it('lands a teacher on the application', async () => {
    const { onboardingToken } = await providerToken('apple');
    await expect(
      identity.onboarding.complete({ ...answers, role: 'teacher', onboardingToken }),
    ).resolves.toMatchObject({ landing: 'teacher_application' });
  });

  it('writes Apple’s grant from the token’s blob, encrypted to the identity’s row', async () => {
    const { onboardingToken } = await providerToken('apple', { authorizationCode: 'code-1' });
    const answer = await identity.onboarding.complete({ ...answers, onboardingToken });
    const userId = (await identity.sessions.resolveUserSession(answer.accessToken))?.userId ?? '';
    const [row] = await database.authIdentity.findMany({ where: { userId } });
    const cipher = createColumnCipher({ ENCRYPTION_KEY: SPEC_ENCRYPTION_KEY });
    expect(
      cipher.decrypt(
        row?.providerRefreshTokenEncrypted ?? new Uint8Array(),
        'auth_identities.provider_refresh_token_encrypted',
        row?.id ?? '',
      ),
    ).toBe('fake-refresh.apple.code-1');
  });

  it('hashes the password of an email identity, and requires one exactly there', async () => {
    const { onboardingToken, email } = await emailToken();
    await expect(
      identity.onboarding.complete({ ...answers, onboardingToken }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'password' }] });
    await identity.onboarding.complete({
      ...answers,
      onboardingToken,
      password: 'a long passphrase',
    });
    const user = await database.user.findFirst({ where: { email } });
    expect((await verifyPassword('a long passphrase', user?.passwordHash ?? '')).valid).toBe(true);
    await expect(database.authIdentity.count({ where: { userId: user?.id } })).resolves.toBe(0);
    const provider = await providerToken('google');
    await expect(
      identity.onboarding.complete({
        ...answers,
        onboardingToken: provider.onboardingToken,
        password: 'a long passphrase',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'password' }] });
  });

  it('refuses a breached password with PASSWORD_WEAK, the token still good', async () => {
    const { onboardingToken } = await emailToken();
    await expect(
      identity.onboarding.complete({ ...answers, onboardingToken, password: 'password123' }),
    ).rejects.toMatchObject({ code: 'PASSWORD_WEAK' });
    await expect(
      identity.onboarding.complete({ ...answers, onboardingToken, password: 'a long passphrase' }),
    ).resolves.toMatchObject({ landing: 'student_home' });
  });

  it('claims the token once: a second presentation is refused', async () => {
    const { onboardingToken } = await providerToken('google');
    await identity.onboarding.complete({ ...answers, onboardingToken });
    await expect(
      identity.onboarding.complete({ ...answers, onboardingToken }),
    ).rejects.toMatchObject({ code: 'ONBOARDING_TOKEN_INVALID' });
  });

  it('requires the current terms version', async () => {
    const { onboardingToken } = await providerToken('google');
    await expect(
      identity.onboarding.complete({ ...answers, onboardingToken, termsVersion: '2025-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'termsVersion' }] });
  });

  it('requires an IANA zone the time package knows', async () => {
    const { onboardingToken } = await providerToken('google');
    for (const timezone of ['+02:00', 'UTC', 'Mars/Olympus']) {
      await expect(
        identity.onboarding.complete({ ...answers, onboardingToken, timezone }),
        timezone,
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'timezone' }] });
    }
  });

  it('refuses the account when its address came to belong to another meanwhile', async () => {
    const { onboardingToken, email } = await providerToken('google');
    await createAccount(database, { email: email ?? '' });
    await expect(
      identity.onboarding.complete({ ...answers, onboardingToken }),
    ).rejects.toMatchObject({ code: 'EMAIL_IN_USE_BY_OTHER_METHOD' });
  });
});

describe('an identity without a verified email (FR-122)', () => {
  it('requires an email and its code before the account is written', async () => {
    const { onboardingToken } = await providerToken('apple', { email: null, emailVerified: false });
    await expect(
      identity.onboarding.complete({ ...answers, onboardingToken }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'email' }] });
    const address = uniqueEmail();
    await expect(
      identity.onboarding.requestEmailCode(onboardingToken, address),
    ).resolves.toBeUndefined();
    await vi.waitFor(() => expect(identity.mails().some((mail) => mail.to === address)).toBe(true));
    const code = codeMailedTo(identity.mails(), address);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(
      identity.onboarding.complete({
        ...answers,
        onboardingToken,
        email: address,
        emailCode: wrong,
      }),
    ).rejects.toMatchObject({ code: 'CODE_INVALID' });
    const answer = await identity.onboarding.complete({
      ...answers,
      onboardingToken,
      email: address,
      emailCode: code,
    });
    const userId = (await identity.sessions.resolveUserSession(answer.accessToken))?.userId;
    await expect(database.user.findUnique({ where: { id: userId ?? '' } })).resolves.toMatchObject({
      email: address,
    });
  });

  it('refuses an email and a code for an identity whose address is already verified', async () => {
    const { onboardingToken } = await providerToken('google');
    await expect(
      identity.onboarding.requestEmailCode(onboardingToken, uniqueEmail()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'onboardingToken' }] });
    await expect(
      identity.onboarding.complete({
        ...answers,
        onboardingToken,
        email: uniqueEmail(),
        emailCode: '123456',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'email' }] });
  });
});

describe('nothing before the account', () => {
  it('leaves no row anywhere when the flow is abandoned after the sign-in', async () => {
    const { subject, email } = await providerToken('google');
    await expect(rowsNaming([subject, email ?? ''])).resolves.toEqual([]);
  });

  it('leaves no row anywhere when the writing fails mid-way, and the token can try again', async () => {
    const { onboardingToken, subject, email } = await providerToken('google');
    const failingSessions = {
      issue: () => Promise.reject(new Error('the session could not be written')),
    } as unknown as SessionService;
    const failing = new OnboardingService({
      database,
      settings: identity.settings,
      encryptionKey: SPEC_ENCRYPTION_KEY,
      now: identity.clock.now,
      marks: identity.marks,
      sessions: failingSessions,
      codes: identity.codes,
    });
    await expect(failing.complete({ ...answers, onboardingToken })).rejects.toThrow(
      'the session could not be written',
    );
    await expect(rowsNaming([subject, email ?? ''])).resolves.toEqual([]);
    await expect(
      identity.onboarding.complete({ ...answers, onboardingToken }),
    ).resolves.toMatchObject({ landing: 'student_home' });
  });
});
