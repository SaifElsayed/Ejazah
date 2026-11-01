// T045: the email account (FR-120, FR-129, research R-104, R-105). A sign-up code goes to every
// well-formed address with the same answer, and an address already in use is told only after its
// code verifies, so nothing is enumerated. A code is six digits, hashed, capped at
// `otp_max_attempts`, spent on first success; a new request supersedes the old. A sign-in with an
// unknown or a provider address verifies against a decoy hash and answers SIGN_IN_FAILED, one
// message, the same work. A reset request answers every address with the same sentence and the same
// work, and its mail leaves after the commit without being awaited; a reset signs in and revokes
// every other session. The mails are the stand-in's, read back for their codes.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashPassword, OtpHasher, verifyPassword } from '../../platform/crypto/hashing.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import type { EmailPort } from '../../platform/ports/email/email.port.js';
import {
  buildIdentity,
  codeMailedTo,
  createAccount,
  type Identity,
  openSpecDatabase,
  rowsOf,
  SPEC_ENCRYPTION_KEY,
  uniqueEmail,
  uniqueSubject,
} from './__fixtures__/identity.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

const PASSWORD = 'correct horse battery';

function spies() {
  const codes = new OtpHasher(SPEC_ENCRYPTION_KEY);
  return {
    passwords: { hash: vi.fn(hashPassword), verify: vi.fn(verifyPassword) },
    codeHasher: {
      hash: vi.fn((code: string) => codes.hash(code)),
      verify: vi.fn((code: string, stored: string) => codes.verify(code, stored)),
    },
  };
}

let identity: Identity;
let hashers: ReturnType<typeof spies>;
beforeEach(() => {
  hashers = spies();
  identity = buildIdentity(database, hashers);
});

const emailAccount = () =>
  hashPassword(PASSWORD).then((passwordHash) => createAccount(database, { passwordHash }));

describe('the sign-up code', () => {
  it('goes to a new address and to an address in use alike, with the same answer', async () => {
    const fresh = uniqueEmail();
    const taken = (await emailAccount()).email;
    await expect(identity.emailAuth.requestSignUpCode(fresh)).resolves.toBeUndefined();
    await expect(identity.emailAuth.requestSignUpCode(taken)).resolves.toBeUndefined();
    await vi.waitFor(() => expect(identity.mails()).toHaveLength(2));
    expect(codeMailedTo(identity.mails(), fresh)).toMatch(/^\d{6}$/);
    expect(codeMailedTo(identity.mails(), taken)).toMatch(/^\d{6}$/);
  });

  it('is stored as its hash only, with its lifetime', async () => {
    const address = uniqueEmail();
    await identity.emailAuth.requestSignUpCode(address);
    await vi.waitFor(() => expect(identity.mails()).toHaveLength(1));
    const code = codeMailedTo(identity.mails(), address);
    const rows = await rowsOf(database).codes(address);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(rows[0]?.purpose).toBe('signup');
    expect(rows[0]?.expiresAt.toISOString()).toBe('2026-10-20T08:10:00.000Z');
  });

  it('is written in both languages, Arabic first, with its lifetime', async () => {
    const address = uniqueEmail();
    await identity.emailAuth.requestSignUpCode(address);
    await vi.waitFor(() => expect(identity.mails()).toHaveLength(1));
    const [mail] = identity.mails();
    expect(mail?.subject).toContain('إجازة');
    expect(mail?.subject).toContain('Ijazah');
    const text = mail?.text ?? '';
    expect(text.indexOf('رمز التحقق')).toBeLessThan(text.indexOf('verification code'));
    expect(text).toContain('10');
  });

  // T137 (the owner's decision of 2026-11-01): the password travels with the request, so a breached
  // one is told at the step that holds its field, for a new address and one in use alike.
  it('refuses a breached password with PASSWORD_WEAK before any code, for every address', async () => {
    const fresh = uniqueEmail();
    const taken = (await emailAccount()).email;
    for (const address of [fresh, taken]) {
      await expect(
        identity.emailAuth.requestSignUpCode(address, 'password123'),
      ).rejects.toMatchObject({ code: 'PASSWORD_WEAK' });
      expect(await rowsOf(database).codes(address)).toEqual([]);
    }
    // The one code hash is the decoy the code store makes when it is built; none is made for a send.
    expect(hashers.codeHasher.hash).toHaveBeenCalledTimes(1);
    expect(identity.mails()).toEqual([]);
  });

  it('sends the code for a sound password, which it keeps nowhere', async () => {
    const address = uniqueEmail();
    await expect(
      identity.emailAuth.requestSignUpCode(address, 'a new long passphrase'),
    ).resolves.toBeUndefined();
    await vi.waitFor(() => expect(identity.mails()).toHaveLength(1));
    expect(codeMailedTo(identity.mails(), address)).toMatch(/^\d{6}$/);
    expect(JSON.stringify(await rowsOf(database).codes(address))).not.toContain(
      'a new long passphrase',
    );
    expect(hashers.passwords.hash).not.toHaveBeenCalledWith('a new long passphrase');
  });
});

describe('verifySignUpCode', () => {
  it('turns a right code into an onboarding token for the verified address', async () => {
    const address = uniqueEmail();
    await identity.emailAuth.requestSignUpCode(address);
    await vi.waitFor(() => expect(identity.mails()).toHaveLength(1));
    const answer = await identity.emailAuth.verifySignUpCode(
      address,
      codeMailedTo(identity.mails(), address),
    );
    expect(answer.onboardingToken).toMatch(/^v1\./);
  });

  it('tells an address in use only once its code verifies, with the method', async () => {
    for (const [owner, method] of [
      ['password', 'email'],
      ['google', 'google'],
      ['apple', 'apple'],
    ] as const) {
      const account =
        owner === 'password'
          ? await emailAccount()
          : await createAccount(database, {
              provider: { provider: owner, subject: uniqueSubject() },
            });
      await identity.emailAuth.requestSignUpCode(account.email);
      await vi.waitFor(() =>
        expect(identity.mails().some((mail) => mail.to === account.email)).toBe(true),
      );
      await expect(
        identity.emailAuth.verifySignUpCode(account.email, '000000'),
      ).rejects.toMatchObject({ code: 'CODE_INVALID' });
      await expect(
        identity.emailAuth.verifySignUpCode(
          account.email,
          codeMailedTo(identity.mails(), account.email),
        ),
      ).rejects.toMatchObject({
        code: 'EMAIL_IN_USE_BY_OTHER_METHOD',
        details: [{ path: 'email', code: method }],
      });
    }
  });
});

describe('a one-time code', () => {
  async function requested() {
    const address = uniqueEmail();
    await identity.emailAuth.requestSignUpCode(address);
    await vi.waitFor(() => expect(identity.mails().some((mail) => mail.to === address)).toBe(true));
    return { address, code: codeMailedTo(identity.mails(), address) };
  }

  it('is spent on its first success', async () => {
    const { address, code } = await requested();
    await identity.emailAuth.verifySignUpCode(address, code);
    await expect(identity.emailAuth.verifySignUpCode(address, code)).rejects.toMatchObject({
      code: 'CODE_INVALID',
    });
  });

  it('is spent after `otp_max_attempts` wrong tries, right or not afterwards', async () => {
    const { address, code } = await requested();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(identity.emailAuth.verifySignUpCode(address, wrong)).rejects.toMatchObject({
        code: 'CODE_INVALID',
      });
    }
    await expect(identity.emailAuth.verifySignUpCode(address, code)).rejects.toMatchObject({
      code: 'CODE_INVALID',
    });
  });

  it('lapses after `otp_code_ttl_minutes`', async () => {
    const { address, code } = await requested();
    identity.clock.advance(10 * 60);
    await expect(identity.emailAuth.verifySignUpCode(address, code)).rejects.toMatchObject({
      code: 'CODE_INVALID',
    });
  });

  it('is superseded by a new request: only the newest code verifies', async () => {
    const { address, code: first } = await requested();
    await identity.emailAuth.requestSignUpCode(address);
    await vi.waitFor(() =>
      expect(identity.mails().filter((mail) => mail.to === address)).toHaveLength(2),
    );
    const second = codeMailedTo(identity.mails(), address);
    if (first !== second) {
      await expect(identity.emailAuth.verifySignUpCode(address, first)).rejects.toMatchObject({
        code: 'CODE_INVALID',
      });
    }
    await expect(identity.emailAuth.verifySignUpCode(address, second)).resolves.toMatchObject({
      onboardingToken: expect.any(String),
    });
  });
});

describe('auth.email.signIn', () => {
  it('signs in with the right password, landing by the standing', async () => {
    const account = await emailAccount();
    const answer = await identity.emailAuth.signIn(account.email, PASSWORD);
    expect(answer.landing).toBe('student_home');
    await expect(identity.sessions.resolveUserSession(answer.accessToken)).resolves.toMatchObject({
      userId: account.userId,
    });
  });

  it('answers SIGN_IN_FAILED, one message and the same work, for a wrong password, an unknown address and a provider account', async () => {
    const account = await emailAccount();
    const provider = await createAccount(database, {
      provider: { provider: 'google', subject: uniqueSubject() },
    });
    const refusals = [];
    for (const [address, password] of [
      [account.email, 'wrong password here'],
      [uniqueEmail(), PASSWORD],
      [provider.email, PASSWORD],
    ] as const) {
      hashers.passwords.verify.mockClear();
      refusals.push(
        await identity.emailAuth.signIn(address, password).catch((error: unknown) => error),
      );
      expect(hashers.passwords.verify, address).toHaveBeenCalledTimes(1);
    }
    for (const refusal of refusals) {
      expect(refusal).toMatchObject({
        code: 'SIGN_IN_FAILED',
        message: 'The email or password is not correct.',
      });
    }
  });

  it('compares the address without its case', async () => {
    const account = await emailAccount();
    await expect(
      identity.emailAuth.signIn(account.email.toUpperCase(), PASSWORD),
    ).resolves.toMatchObject({ landing: 'student_home' });
  });
});

describe('the password reset request', () => {
  it('answers every address the same, with the same work, and mails a code only to an email account', async () => {
    const account = await emailAccount();
    const provider = await createAccount(database, {
      provider: { provider: 'apple', subject: uniqueSubject() },
    });
    for (const address of [account.email, uniqueEmail(), provider.email]) {
      hashers.codeHasher.hash.mockClear();
      await expect(identity.emailAuth.requestPasswordReset(address)).resolves.toBeUndefined();
      expect(hashers.codeHasher.hash, address).toHaveBeenCalledTimes(1);
    }
    await vi.waitFor(() => expect(identity.mails()).toHaveLength(1));
    expect(identity.mails()[0]?.to).toBe(account.email);
    await expect(rowsOf(database).codes(provider.email)).resolves.toEqual([]);
  });

  it('does not wait for the mail, and a mail that fails fails nothing', async () => {
    const hanging: EmailPort = { deliver: () => new Promise<void>(() => undefined) };
    const slow = buildIdentity(database, { email: hanging });
    const account = await emailAccount();
    await expect(slow.emailAuth.requestPasswordReset(account.email)).resolves.toBeUndefined();
    const failing: EmailPort = { deliver: () => Promise.reject(new Error('provider down')) };
    const broken = buildIdentity(database, { email: failing });
    await expect(broken.emailAuth.requestPasswordReset(account.email)).resolves.toBeUndefined();
    await vi.waitFor(() => expect(broken.warnings).toHaveLength(1));
    expect(JSON.stringify(broken.warnings)).not.toContain(account.email);
  });
});

describe('auth.email.resetPassword', () => {
  async function resetCode(address: string) {
    await identity.emailAuth.requestPasswordReset(address);
    await vi.waitFor(() => expect(identity.mails().some((mail) => mail.to === address)).toBe(true));
    return codeMailedTo(identity.mails(), address);
  }

  it('does the same code work for every address, so a wrong code says nothing of the account (review of B9, M1)', async () => {
    const account = await emailAccount();
    const provider = await createAccount(database, {
      provider: { provider: 'google', subject: uniqueSubject() },
    });
    const code = await resetCode(account.email);
    const wrong = code === '000000' ? '111111' : '000000';
    // A wrong code for an email account, an unknown address, a provider address, and an email
    // account past its attempt cap: one code verification each, then one refusal.
    for (const address of [account.email, uniqueEmail(), provider.email]) {
      await identity.emailAuth.requestPasswordReset(address);
      hashers.codeHasher.verify.mockClear();
      await expect(
        identity.emailAuth.resetPassword(address, wrong, 'a new long passphrase'),
      ).rejects.toMatchObject({ code: 'CODE_INVALID' });
      expect(hashers.codeHasher.verify, address).toHaveBeenCalledTimes(1);
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await identity.emailAuth
        .resetPassword(account.email, wrong, 'a new long passphrase')
        .catch(() => undefined);
    }
    hashers.codeHasher.verify.mockClear();
    await expect(
      identity.emailAuth.resetPassword(account.email, wrong, 'a new long passphrase'),
    ).rejects.toMatchObject({ code: 'CODE_INVALID' });
    expect(hashers.codeHasher.verify).toHaveBeenCalledTimes(1);
  });

  it('sets the new password, signs in, and revokes every other session', async () => {
    const account = await emailAccount();
    const other = await identity.sessions.issue(account.userId);
    const code = await resetCode(account.email);
    const answer = await identity.emailAuth.resetPassword(
      account.email,
      code,
      'a new long passphrase',
    );
    await expect(identity.sessions.resolveUserSession(answer.accessToken)).resolves.toMatchObject({
      userId: account.userId,
    });
    await expect(identity.sessions.resolveUserSession(other.accessToken)).resolves.toBeNull();
    const reasons = (await rowsOf(database).sessions(account.userId)).map(
      (row) => row.revokedReason,
    );
    expect(reasons.filter((reason) => reason !== null)).toEqual(['password_reset']);
    await expect(identity.emailAuth.signIn(account.email, PASSWORD)).rejects.toMatchObject({
      code: 'SIGN_IN_FAILED',
    });
    await expect(
      identity.emailAuth.signIn(account.email, 'a new long passphrase'),
    ).resolves.toMatchObject({ landing: 'student_home' });
  });

  it('refuses a breached password with PASSWORD_WEAK, the code left unspent', async () => {
    const account = await emailAccount();
    const code = await resetCode(account.email);
    await expect(
      identity.emailAuth.resetPassword(account.email, code, 'password123'),
    ).rejects.toMatchObject({ code: 'PASSWORD_WEAK' });
    await expect(
      identity.emailAuth.resetPassword(account.email, code, 'a new long passphrase'),
    ).resolves.toMatchObject({ landing: 'student_home' });
  });

  it('refuses a wrong code, and changes nothing', async () => {
    const account = await emailAccount();
    const code = await resetCode(account.email);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(
      identity.emailAuth.resetPassword(account.email, wrong, 'a new long passphrase'),
    ).rejects.toMatchObject({ code: 'CODE_INVALID' });
    await expect(identity.emailAuth.signIn(account.email, PASSWORD)).resolves.toMatchObject({
      landing: 'student_home',
    });
  });
});
