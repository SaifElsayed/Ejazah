// T097 (FR-155; ADR 0015 D1 and D3; the note under T097): a banned person's deletion keeps their
// sign-in identifiers, so the ban outlives the account.
//
// - The deletion of an account whose `account_status` is `banned` writes, in its one transaction, a
//   keyed hash of the normalized email and of each linked `(provider, provider_subject)` to
//   `banned_identifiers`: HMAC-SHA256 under a subkey of ENCRYPTION_KEY derived by HKDF under
//   `ijazah:banned-identifier:v1`. The table holds the hash, its kind and `created_at`, nothing of
//   the person. A deletion that rolls back writes none; an ordinary or a suspended person's none.
// - The three checks run after the person proved the address or the account, never before:
//   `auth.email.verifySignUpCode` after the right code, `auth.signInWithProvider` on the
//   new-account path after the token, `onboarding.complete` before the row is written (an
//   onboarding token minted before the deletion is refused too). A match is ACCOUNT_RESTRICTED with
//   no detail, and no token of any kind is issued; the code request answers the address as any
//   other (R-104), so nothing tells another person of the ban.
// - An ordinary person, and a suspended one, deletes and signs up again with the same address and
//   the same provider subject (SC-111).
import { createHmac, hkdfSync, randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashPassword } from '../../platform/crypto/hashing.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';

import { buildDeletion, type Deletion } from './__fixtures__/deletion.js';
import {
  codeMailedTo,
  createAccount,
  openSpecDatabase,
  rowsNaming,
  rowsOf,
  SPEC_ENCRYPTION_KEY,
  specIdentityToken,
  uniqueEmail,
  uniqueSubject,
} from './__fixtures__/identity.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let spec: Deletion;
beforeEach(() => {
  spec = buildDeletion(database);
});

const rows = () => rowsOf(database);
const PASSWORD = 'a long spec passphrase 41';
const NEW_PASSWORD = 'a brand new passphrase 77';
type Provider = 'google' | 'apple';
type Standing = 'active' | 'suspended' | 'banned';

/** The refusal T097 names: ACCOUNT_RESTRICTED, and no detail that could say why. */
const restricted = expect.objectContaining({ code: 'ACCOUNT_RESTRICTED', details: undefined });

/** The keyed hash, derived here independently of the module: HKDF-SHA256, then HMAC-SHA256. */
function keyedHash(input: string): string {
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(SPEC_ENCRYPTION_KEY, 'base64'),
      Buffer.alloc(0),
      'ijazah:banned-identifier:v1',
      32,
    ),
  );
  return createHmac('sha256', key).update(input, 'utf8').digest('hex');
}

const emailHash = (email: string) => keyedHash(`email\u0000${email}`);
const providerHash = (provider: Provider, subject: string) =>
  keyedHash(`provider\u0000${provider}\u0000${subject}`);

/** An email account at a standing, deleted by its own password (`account.delete`). */
async function deletedEmailAccount(standing: Standing) {
  const { userId, email } = await createAccount(database, {
    accountStatus: standing,
    passwordHash: await hashPassword(PASSWORD),
  });
  await spec.deletion.deleteAccount(userId, {
    confirmation: 'حذف',
    reauth: { kind: 'password', password: PASSWORD },
    idempotencyKey: randomUUID(),
  });
  await spec.settle();
  return { userId, email };
}

/** A fresh provider proof naming `subject`, and the address the provider reports. */
async function providerRequest(
  provider: Provider,
  subject: string,
  email: string | null = null,
  authorizationCode?: string,
) {
  const { nonce } = await spec.identity.signIn.providerNonce();
  return {
    provider,
    nonce,
    identityToken: specIdentityToken({
      provider,
      subject,
      email,
      emailVerified: email !== null,
      nonce,
    }),
    ...(authorizationCode === undefined ? {} : { authorizationCode }),
  };
}

/** A provider account at a standing, deleted by a fresh token of its own subject. */
async function deletedProviderAccount(provider: Provider, standing: Standing) {
  const subject = uniqueSubject();
  const { userId, email } = await createAccount(database, {
    accountStatus: standing,
    provider: { provider, subject },
  });
  const proof = await providerRequest(provider, subject);
  await spec.deletion.deleteAccount(userId, {
    confirmation: 'DELETE',
    reauth: { kind: 'provider', identityToken: proof.identityToken, nonce: proof.nonce },
    idempotencyKey: randomUUID(),
  });
  await spec.settle();
  return { userId, email, subject };
}

/** The six-digit sign-up code mailed to `email` once it was asked for. */
async function signUpCode(email: string): Promise<string> {
  await spec.identity.emailAuth.requestSignUpCode(email);
  await vi.waitFor(() => expect(codeMailedTo(spec.identity.mails(), email)).toMatch(/^\d{6}$/));
  return codeMailedTo(spec.identity.mails(), email);
}

const answers = {
  role: 'student',
  displayName: 'سارة عادل',
  gender: 'female',
  dateOfBirth: '1990-04-12',
  timezone: 'Africa/Cairo',
  termsVersion: '2026-10',
} as const;

describe('the deletion of a banned account keeps its identifiers as keyed hashes (FR-155)', () => {
  it('writes the hash of the address and of each provider identity, with its kind and created_at only', async () => {
    const subject = uniqueSubject();
    const { userId, email } = await createAccount(database, {
      accountStatus: 'banned',
      passwordHash: await hashPassword(PASSWORD),
      provider: { provider: 'google', subject },
    });
    await spec.deletion.deleteAccount(userId, {
      confirmation: 'حذف',
      reauth: { kind: 'password', password: PASSWORD },
      idempotencyKey: randomUUID(),
    });

    const byEmail = await rows().bannedIdentifier(emailHash(email));
    const byProvider = await rows().bannedIdentifier(providerHash('google', subject));
    expect(byEmail).toEqual({
      id: expect.any(String),
      kind: 'email',
      identifierHmac: emailHash(email),
      createdAt: expect.any(Date),
    });
    expect(byProvider).toMatchObject({ kind: 'provider' });
    // A sweep of every table: no address, subject or name of the person outside their erased row.
    const found = await rowsNaming([email, subject]);
    expect(found.filter((column) => column.startsWith('banned_identifiers.'))).toEqual([]);
  });

  it('writes them in the deletion’s transaction: a rolled-back deletion leaves none', async () => {
    const { userId, email } = await createAccount(database, {
      accountStatus: 'banned',
      passwordHash: await hashPassword(PASSWORD),
    });
    spec.consequences.subscribe(async () => {
      throw new Error('a module refused the deletion');
    });
    await expect(
      spec.deletion.deleteAccount(userId, {
        confirmation: 'حذف',
        reauth: { kind: 'password', password: PASSWORD },
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow('a module refused the deletion');
    expect(await rows().bannedIdentifier(emailHash(email))).toBeNull();
  });

  it('writes the same on the web’s deletion', async () => {
    const { email } = await createAccount(database, { accountStatus: 'banned' });
    await spec.deletion.requestWebCode(email);
    await vi.waitFor(() => expect(codeMailedTo(spec.identity.mails(), email)).toMatch(/^\d{6}$/));
    await spec.deletion.confirmWebDeletion(email, codeMailedTo(spec.identity.mails(), email));
    expect(await rows().bannedIdentifier(emailHash(email))).toMatchObject({ kind: 'email' });
  });

  it.each(['active', 'suspended'] as const)('writes nothing for a %s account', async (standing) => {
    const { email } = await deletedEmailAccount(standing);
    expect(await rows().bannedIdentifier(emailHash(email))).toBeNull();
  });
});

describe('auth.email: the banned address after its deletion', () => {
  it('answers the code request as for any other address: a code written and mailed', async () => {
    const { email } = await deletedEmailAccount('banned');
    const other = uniqueEmail();
    await expect(spec.identity.emailAuth.requestSignUpCode(email)).resolves.toBeUndefined();
    await expect(spec.identity.emailAuth.requestSignUpCode(other)).resolves.toBeUndefined();
    for (const address of [email, other]) {
      expect(await rows().codes(address)).toEqual([expect.objectContaining({ purpose: 'signup' })]);
      await vi.waitFor(() =>
        expect(codeMailedTo(spec.identity.mails(), address)).toMatch(/^\d{6}$/),
      );
    }
  });

  it('refuses verifySignUpCode after the right code with ACCOUNT_RESTRICTED and no token, in any spelling', async () => {
    const { email } = await deletedEmailAccount('banned');
    const code = await signUpCode(email);
    await expect(
      spec.identity.emailAuth.verifySignUpCode(` ${email.toUpperCase()} `, code),
    ).rejects.toEqual(restricted);
  });

  it('checks only after the code: a wrong code is CODE_INVALID, as for any address', async () => {
    const { email } = await deletedEmailAccount('banned');
    const code = await signUpCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(spec.identity.emailAuth.verifySignUpCode(email, wrong)).rejects.toMatchObject({
      code: 'CODE_INVALID',
    });
  });
});

describe('auth.signInWithProvider: the banned subject after its deletion', () => {
  it.each(['google', 'apple'] as const)(
    'refuses the same %s subject on the new-account path with ACCOUNT_RESTRICTED and no token',
    async (provider) => {
      const { subject } = await deletedProviderAccount(provider, 'banned');
      const request = await providerRequest(provider, subject, null, 'spec-authorization-code');
      await expect(spec.identity.signIn.signInWithProvider(request)).rejects.toEqual(restricted);
      // Apple's grant is not even asked for: the refusal comes before the exchange.
      expect(
        spec.identity.signInPort.calls.filter(
          ({ operation }) => operation === 'exchangeAuthorization',
        ),
      ).toEqual([]);
      expect(await spec.identity.marks.has('provider-nonce', request.nonce)).toBe(false);
    },
  );

  it('refuses a new subject whose verified address is the banned one', async () => {
    const { email } = await deletedEmailAccount('banned');
    const request = await providerRequest('google', uniqueSubject(), email);
    await expect(spec.identity.signIn.signInWithProvider(request)).rejects.toEqual(restricted);
  });

  it('checks only after the token: a token the port refuses is UNAUTHENTICATED', async () => {
    const { subject } = await deletedProviderAccount('google', 'banned');
    const request = await providerRequest('google', subject);
    await expect(
      spec.identity.signIn.signInWithProvider({ ...request, identityToken: 'not-a-token' }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('onboarding.complete: a token minted before the deletion', () => {
  it('refuses an email token for the banned address before any row is written', async () => {
    const { userId, email } = await createAccount(database, {
      accountStatus: 'banned',
      passwordHash: await hashPassword(PASSWORD),
    });
    const onboardingToken = await spec.identity.onboarding.mint({ kind: 'email', email });
    await spec.deletion.deleteAccount(userId, {
      confirmation: 'حذف',
      reauth: { kind: 'password', password: PASSWORD },
      idempotencyKey: randomUUID(),
    });
    await expect(
      spec.identity.onboarding.complete({ ...answers, onboardingToken, password: NEW_PASSWORD }),
    ).rejects.toEqual(restricted);
    expect(await rows().userByEmail(email)).toBeNull();
  });

  it.each(['google', 'apple'] as const)(
    'refuses a %s token for the banned subject before any row is written',
    async (provider) => {
      const subject = uniqueSubject();
      const { userId } = await createAccount(database, {
        accountStatus: 'banned',
        provider: { provider, subject },
      });
      const fresh = uniqueEmail();
      const onboardingToken = await spec.identity.onboarding.mint({
        kind: 'provider',
        provider,
        subject,
        email: fresh,
        emailVerified: true,
        displayName: null,
      });
      const proof = await providerRequest(provider, subject);
      await spec.deletion.deleteAccount(userId, {
        confirmation: 'DELETE',
        reauth: { kind: 'provider', identityToken: proof.identityToken, nonce: proof.nonce },
        idempotencyKey: randomUUID(),
      });
      await expect(
        spec.identity.onboarding.complete({ ...answers, onboardingToken }),
      ).rejects.toEqual(restricted);
      expect(await rows().userByEmail(fresh)).toBeNull();
    },
  );

  it('refuses the banned address entered with its code for a provider without a verified one', async () => {
    const { email } = await deletedEmailAccount('banned');
    const onboardingToken = await spec.identity.onboarding.mint({
      kind: 'provider',
      provider: 'google',
      subject: uniqueSubject(),
      email: null,
      emailVerified: false,
      displayName: null,
    });
    await spec.identity.onboarding.requestEmailCode(onboardingToken, email);
    await vi.waitFor(() => expect(codeMailedTo(spec.identity.mails(), email)).toMatch(/^\d{6}$/));
    await expect(
      spec.identity.onboarding.complete({
        ...answers,
        onboardingToken,
        email,
        emailCode: codeMailedTo(spec.identity.mails(), email),
      }),
    ).rejects.toEqual(restricted);
    expect(await rows().userByEmail(email)).toBeNull();
  });
});

describe('an ordinary or a suspended person deletes and signs up again (SC-111)', () => {
  it.each(['active', 'suspended'] as const)(
    'a %s person signs up again with the same address',
    async (standing) => {
      const { userId, email } = await deletedEmailAccount(standing);
      const code = await signUpCode(email);
      const { onboardingToken } = await spec.identity.emailAuth.verifySignUpCode(email, code);
      await expect(
        spec.identity.onboarding.complete({ ...answers, onboardingToken, password: NEW_PASSWORD }),
      ).resolves.toMatchObject({ landing: 'student_home' });
      expect((await rows().userByEmail(email))?.id).not.toBe(userId);
    },
  );

  it.each([
    ['google', 'active'],
    ['apple', 'active'],
    ['google', 'suspended'],
  ] as const)(
    'a %s account, %s, signs up again with the same subject',
    async (provider, standing) => {
      const { userId, subject } = await deletedProviderAccount(provider, standing);
      const fresh = uniqueEmail();
      const outcome = await spec.identity.signIn.signInWithProvider(
        await providerRequest(provider, subject, fresh),
      );
      expect(outcome).toMatchObject({ outcome: 'onboarding' });
      if (outcome.outcome !== 'onboarding') return;
      await expect(
        spec.identity.onboarding.complete({ ...answers, onboardingToken: outcome.onboardingToken }),
      ).resolves.toMatchObject({ landing: 'student_home' });
      expect((await rows().userByEmail(fresh))?.id).not.toBe(userId);
    },
  );
});
