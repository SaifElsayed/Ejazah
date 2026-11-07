// T080 (FR-140 to FR-143, SC-111, ADR 0015 D1 to D4; B16 check, decisions 1 to 6): the deletion of
// an account, in the app (`account.delete`) and on the web (the two steps the pages call).
//
// - The typed word is accepted in either language; the schema refuses any other (the router spec).
// - The proof is fresh and the caller's own: a provider token whose nonce the server minted, taken
//   before the token is read, and whose subject is one of the caller's `auth_identities` rows; or
//   the password against the caller's own hash. A valid proof of anyone else is refused, with one
//   answer, SIGN_IN_FAILED, and nothing changes. The proof is checked before the transaction opens.
// - One transaction, keyed (FR-106): the row soft-deleted and every personal field of ADR 0015 D3
//   erased (display name, email, phone, password hash, date of birth, certificate name), the
//   identity rows deleted, every session revoked (`account_deleted`), the push tokens removed, a
//   teacher's bio and payout columns erased, the consequences registry called with
//   `account_deleted`; the role row, the terms and the audit entries stay.
// - After the commit, outside it: the photo's file removed and only then its key cleared; each
//   other module's files handed over (the verification module's documents); the Apple grant
//   revoked through the port with the stored refresh token; the confirmation mailed. A failure of
//   any of them is reported and the deletion stands (a job retries the files).
// - The refresh token is refused, and the email is free: a new sign-up with it succeeds (SC-111).
// - The web: the email step answers every address the same, with one hashing each, writing an
//   `account_deletion` code only for an account and mailing it after the commit; the confirm step
//   runs the same deletion on the right code and answers false, deleting nothing, on a wrong one.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomInt, randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashPassword, OtpHasher } from '../../platform/crypto/hashing.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';

import {
  auditEntriesAbout,
  buildDeletion,
  type Deletion,
  encryptedGrant,
  identityId,
  writeAuditEntryAbout,
} from './__fixtures__/deletion.js';
import {
  codeMailedTo,
  createAccount,
  createTeacherProfile,
  openSpecDatabase,
  rowsOf,
  SPEC_ENCRYPTION_KEY,
  specIdentityToken,
  uniqueEmail,
  uniqueSubject,
} from './__fixtures__/identity.js';
import type { CodeHasher } from './one-time-codes.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let spec: Deletion;
beforeEach(() => {
  spec = buildDeletion(database);
});

const rows = () => rowsOf(database);
const PASSWORD = 'a long spec passphrase 41';
const key = () => randomUUID();
const refused = (code: string) => expect.objectContaining({ code });

/** An email account with its password hash and a live session. */
async function emailAccount(role: 'student' | 'teacher' = 'student') {
  const { userId, email } = await createAccount(database, {
    role,
    passwordHash: await hashPassword(PASSWORD),
  });
  const tokens = await spec.identity.sessions.issue(userId);
  return { userId, email, ...tokens };
}

/** A provider account with its identity row (Apple's carrying the encrypted grant) and a session. */
async function providerAccount(provider: 'google' | 'apple', grant: string | null = null) {
  const { userId, email } = await createAccount(database);
  const id = identityId();
  const subject = uniqueSubject();
  await rows().createIdentity({
    id,
    userId,
    provider,
    subject,
    grantEncrypted: grant === null ? null : encryptedGrant(grant, id),
  });
  const tokens = await spec.identity.sessions.issue(userId);
  return { userId, email, subject, ...tokens };
}

/** A fresh provider proof: a nonce the server minted and a token naming `subject`. */
async function providerProof(provider: 'google' | 'apple', subject: string) {
  const { nonce } = await spec.identity.signIn.providerNonce();
  const identityToken = specIdentityToken({
    provider,
    subject,
    email: null,
    emailVerified: false,
    nonce,
  });
  return { kind: 'provider' as const, identityToken, nonce };
}

const byPassword = (password = PASSWORD) => ({ kind: 'password' as const, password });

function deleteWith(
  userId: string,
  reauth: ReturnType<typeof byPassword> | Awaited<ReturnType<typeof providerProof>>,
  confirmation: 'حذف' | 'DELETE' = 'حذف',
) {
  return spec.deletion.deleteAccount(userId, { confirmation, reauth, idempotencyKey: key() });
}

/** The account untouched: the row live with its email, its sessions live. */
async function expectUntouched(userId: string, email: string) {
  const user = await rows().user(userId);
  expect(user).toMatchObject({ email, deletedAt: null });
  const sessions = await rows().sessions(userId);
  expect(sessions.every((session) => session.revokedAt === null)).toBe(true);
}

describe('account.delete: the typed word and the proof', () => {
  it('accepts the typed word in either language', async () => {
    const arabic = await emailAccount();
    const english = await emailAccount();
    await deleteWith(arabic.userId, byPassword(), 'حذف');
    await deleteWith(english.userId, byPassword(), 'DELETE');
    expect((await rows().deletedUser(arabic.userId))?.deletedAt).not.toBeNull();
    expect((await rows().deletedUser(english.userId))?.deletedAt).not.toBeNull();
  });

  it("re-authenticates by the password against the caller's own hash; a wrong one, or another person's, is refused and changes nothing", async () => {
    const caller = await emailAccount();
    const other = await createAccount(database, {
      passwordHash: await hashPassword('another persons passphrase 9'),
    });
    await expect(deleteWith(caller.userId, byPassword('not the passphrase'))).rejects.toEqual(
      refused('SIGN_IN_FAILED'),
    );
    await expect(
      deleteWith(caller.userId, byPassword('another persons passphrase 9')),
    ).rejects.toEqual(refused('SIGN_IN_FAILED'));
    await expectUntouched(caller.userId, caller.email);
    expect((await rows().user(other.userId))?.deletedAt).toBeNull();
    expect(spec.keyed).toEqual([]);
  });

  it('re-authenticates a provider account by a fresh token and nonce whose subject is its own identity', async () => {
    const caller = await providerAccount('google');
    const proof = await providerProof('google', caller.subject);
    await deleteWith(caller.userId, proof);
    expect((await rows().deletedUser(caller.userId))?.deletedAt).not.toBeNull();
    expect(await spec.identity.marks.has('provider-nonce', proof.nonce)).toBe(false);
  });

  it("refuses a valid token of another identity, the other person's included, and spends the nonce", async () => {
    const caller = await providerAccount('google');
    const other = await providerAccount('google');
    for (const subject of [other.subject, uniqueSubject()]) {
      const proof = await providerProof('google', subject);
      await expect(deleteWith(caller.userId, proof)).rejects.toEqual(refused('SIGN_IN_FAILED'));
      expect(await spec.identity.marks.has('provider-nonce', proof.nonce)).toBe(false);
    }
    await expectUntouched(caller.userId, caller.email);
    await expectUntouched(other.userId, other.email);
  });

  it('refuses a nonce the server never minted, or one already spent, before the token is read', async () => {
    const caller = await providerAccount('apple');
    const proof = await providerProof('apple', caller.subject);
    const unminted = { ...proof, nonce: 'never-minted-nonce-0001' };
    await expect(deleteWith(caller.userId, unminted)).rejects.toEqual(refused('SIGN_IN_FAILED'));
    await spec.identity.marks.take('provider-nonce', proof.nonce);
    await expect(deleteWith(caller.userId, proof)).rejects.toEqual(refused('SIGN_IN_FAILED'));
    expect(spec.events).not.toContain('verify');
    await expectUntouched(caller.userId, caller.email);
  });

  it('refuses a provider proof for an email account and a password for a provider account', async () => {
    const email = await emailAccount();
    const provider = await providerAccount('google');
    await expect(
      deleteWith(email.userId, await providerProof('google', uniqueSubject())),
    ).rejects.toEqual(refused('SIGN_IN_FAILED'));
    await expect(deleteWith(provider.userId, byPassword())).rejects.toEqual(
      refused('SIGN_IN_FAILED'),
    );
    await expectUntouched(email.userId, email.email);
    await expectUntouched(provider.userId, provider.email);
  });

  it('checks the proof before the transaction opens (B16 check, decision 5)', async () => {
    const caller = await providerAccount('google');
    await deleteWith(caller.userId, await providerProof('google', caller.subject));
    expect(spec.events.slice(0, 4)).toEqual(['verify', 'transaction', 'consequence', 'committed']);
  });

  it('is keyed under account.delete for the caller, and the stored input carries no password or token', async () => {
    const caller = await emailAccount();
    const idempotencyKey = key();
    await spec.deletion.deleteAccount(caller.userId, {
      confirmation: 'DELETE',
      reauth: byPassword(),
      idempotencyKey,
    });
    expect(spec.keyed).toEqual([
      expect.objectContaining({
        scope: 'account.delete',
        key: idempotencyKey,
        actorId: caller.userId,
      }),
    ]);
    expect(JSON.stringify(spec.keyed[0]?.input)).not.toContain(PASSWORD);
  });
});

describe('account.delete: the one transaction (FR-141, ADR 0015 D3)', () => {
  it('soft-deletes the row and erases every personal field; the role and the audit entries stay', async () => {
    const caller = await emailAccount();
    await rows().setPersonalFields(caller.userId, {
      phone: `+2010${randomInt(10_000_000, 99_999_999)}`,
      certificateName: 'سارة عادل محمود',
    });
    await writeAuditEntryAbout(caller.userId);
    await deleteWith(caller.userId, byPassword());

    expect(await rows().deletedUser(caller.userId)).toMatchObject({
      deletedAt: spec.identity.clock.now(),
      displayName: null,
      email: null,
      phone: null,
      passwordHash: null,
      dateOfBirth: null,
      certificateName: null,
    });
    expect(await rows().user(caller.userId)).toBeNull();
    expect(await rows().roles(caller.userId)).toEqual([{ role: 'student', status: 'active' }]);
    expect(await auditEntriesAbout(caller.userId)).toBe(1);
  });

  it('deletes the identity rows, revokes every session with account_deleted and removes the push tokens', async () => {
    const caller = await providerAccount('google');
    await spec.identity.sessions.issue(caller.userId);
    await rows().createPushToken(caller.userId, `spec-push-${randomUUID()}`);
    await deleteWith(caller.userId, await providerProof('google', caller.subject));

    expect(await rows().identities(caller.userId)).toEqual([]);
    expect(await rows().pushTokens(caller.userId)).toEqual([]);
    const sessions = await rows().sessions(caller.userId);
    expect(sessions).toHaveLength(2);
    for (const session of sessions) {
      expect(session).toMatchObject({
        revokedAt: spec.identity.clock.now(),
        revokedReason: 'account_deleted',
      });
    }
  });

  it("erases a teacher's bio and payout columns and keeps the profile row", async () => {
    const caller = await emailAccount('teacher');
    await createTeacherProfile(database, caller.userId, {
      verificationStatus: 'approved',
      applicationStatus: 'approved',
    });
    await rows().setTeacherFields(caller.userId, {
      bio: 'أدرّس التجويد منذ عشر سنوات',
      payoutAccountRefEncrypted: Uint8Array.from([9, 9, 9]),
      payoutAccountRefHash: `spec-ref-${randomUUID()}`,
      payoutConfiguredAt: new Date('2026-10-01T08:00:00Z'),
      payoutVerifiedAt: new Date('2026-10-02T08:00:00Z'),
    });
    await deleteWith(caller.userId, byPassword());

    expect(await rows().teacherProfile(caller.userId)).toMatchObject({
      bio: '',
      payoutAccountRefEncrypted: null,
      payoutAccountRefHash: null,
      payoutConfiguredAt: null,
      payoutVerifiedAt: null,
      payoutRejectedReason: null,
      verificationStatus: 'approved',
    });
  });

  it('calls the consequences registry once with account_deleted, on the deletion’s transaction', async () => {
    const caller = await emailAccount('teacher');
    await deleteWith(caller.userId, byPassword());
    expect(spec.terminations).toEqual([{ userId: caller.userId, cause: 'account_deleted' }]);
  });

  it('rolls everything back when a consequence fails: nothing erased, revoked, removed or mailed', async () => {
    const caller = await providerAccount('apple', 'apple-grant-rollback');
    spec.consequences.subscribe(async () => {
      throw new Error('a module refused the deletion');
    });
    await expect(
      deleteWith(caller.userId, await providerProof('apple', caller.subject)),
    ).rejects.toThrow('a module refused the deletion');
    await spec.settle();

    await expectUntouched(caller.userId, caller.email);
    expect(await rows().identities(caller.userId)).toHaveLength(1);
    expect(spec.signInPort.calls.map(({ operation }) => operation)).not.toContain('revoke');
    expect(spec.identity.mails().filter(({ to }) => to === caller.email)).toEqual([]);
    expect(spec.files.erased).toEqual([]);
  });

  it('refuses the refresh token and the access token afterwards (SC-111)', async () => {
    const caller = await emailAccount();
    await deleteWith(caller.userId, byPassword());
    await expect(spec.identity.sessions.refresh(caller.refreshToken)).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(await spec.identity.sessions.resolveUserSession(caller.accessToken)).toBeNull();
  });

  it('frees the email: a new sign-up with it succeeds at once (SC-111)', async () => {
    const caller = await emailAccount();
    await deleteWith(caller.userId, byPassword());
    await spec.identity.emailAuth.requestSignUpCode(caller.email);
    await vi.waitFor(() =>
      expect(spec.identity.mails().some((mail) => mail.to === caller.email)).toBe(true),
    );
    const { onboardingToken } = await spec.identity.emailAuth.verifySignUpCode(
      caller.email,
      codeMailedTo(spec.identity.mails(), caller.email),
    );
    await expect(
      spec.identity.onboarding.complete({
        onboardingToken,
        role: 'student',
        displayName: 'سارة عادل',
        gender: 'female',
        dateOfBirth: '1990-04-12',
        timezone: 'Africa/Cairo',
        termsVersion: '2026-10',
        password: 'a brand new passphrase 77',
      }),
    ).resolves.toMatchObject({ landing: 'student_home' });
    const fresh = await rows().userByEmail(caller.email);
    expect(fresh?.id).not.toBe(caller.userId);
  });

  it('a second deletion of the same account is refused at the proof and does nothing more', async () => {
    const caller = await emailAccount();
    await deleteWith(caller.userId, byPassword());
    await spec.settle();
    const mails = spec.identity.mails().length;
    await expect(deleteWith(caller.userId, byPassword())).rejects.toEqual(
      refused('SIGN_IN_FAILED'),
    );
    await spec.settle();
    expect(spec.identity.mails()).toHaveLength(mails);
    expect(spec.terminations).toHaveLength(1);
  });
});

describe('account.delete: after the commit (B16 check, decisions 1 and 3)', () => {
  it('revokes the Apple grant through the port with the stored refresh token, after the commit', async () => {
    const caller = await providerAccount('apple', 'apple-grant-41');
    await deleteWith(caller.userId, await providerProof('apple', caller.subject));
    await spec.settle();
    expect(spec.signInPort.calls.filter(({ operation }) => operation === 'revoke')).toEqual([
      { operation: 'revoke', args: [{ provider: 'apple', refreshToken: 'apple-grant-41' }] },
    ]);
    expect(spec.events.indexOf('revoke')).toBeGreaterThan(spec.events.indexOf('committed'));
  });

  it('revokes a grant written under the previous key once ENCRYPTION_KEY is rotated (T134)', async () => {
    spec = buildDeletion(database, { rotated: true });
    const caller = await providerAccount('apple', 'apple-grant-before-rotation');
    await deleteWith(caller.userId, await providerProof('apple', caller.subject));
    await spec.settle();
    expect(spec.reports).toEqual([]);
    expect(spec.signInPort.calls.filter(({ operation }) => operation === 'revoke')).toEqual([
      {
        operation: 'revoke',
        args: [{ provider: 'apple', refreshToken: 'apple-grant-before-rotation' }],
      },
    ]);
  });

  it('revokes nothing for a Google account or an Apple one without a stored grant', async () => {
    const google = await providerAccount('google');
    const apple = await providerAccount('apple');
    await deleteWith(google.userId, await providerProof('google', google.subject));
    await deleteWith(apple.userId, await providerProof('apple', apple.subject));
    await spec.settle();
    expect(spec.events).not.toContain('revoke');
  });

  it('reports a failed revoke and keeps the deletion', async () => {
    const caller = await providerAccount('apple', 'apple-grant-unreachable');
    spec.signInPort.failNextRevoke();
    await deleteWith(caller.userId, await providerProof('apple', caller.subject));
    await spec.settle();
    expect(spec.reports).toHaveLength(1);
    expect((await rows().deletedUser(caller.userId))?.deletedAt).not.toBeNull();
    expect(await rows().identities(caller.userId)).toEqual([]);
  });

  it('reports a grant that cannot be decrypted, answers the deletion and still mails (B16 review, m1)', async () => {
    const { userId } = await createAccount(database);
    const subject = uniqueSubject();
    const id = identityId();
    await rows().createIdentity({
      id,
      userId,
      provider: 'apple',
      subject,
      // Bound to another row, so its decryption throws, synchronously, after the commit.
      grantEncrypted: encryptedGrant('apple-grant-unreadable', identityId()),
    });
    const mails = spec.identity.mails().length;
    await deleteWith(userId, await providerProof('apple', subject));
    await spec.settle();
    expect(spec.reports).toHaveLength(1);
    expect(spec.identity.mails()).toHaveLength(mails + 1);
    expect((await rows().deletedUser(userId))?.deletedAt).not.toBeNull();
  });

  it('removes the photo after the commit and clears its key only once its file is gone', async () => {
    const caller = await emailAccount();
    await rows().setPersonalFields(caller.userId, { photoKey: `photos/${caller.userId}.jpg` });
    await deleteWith(caller.userId, byPassword());
    await spec.settle();
    expect(spec.storage.removed).toEqual([`photos/${caller.userId}.jpg`]);
    expect((await rows().deletedUser(caller.userId))?.photoKey).toBeNull();
    expect(spec.events.indexOf('remove')).toBeGreaterThan(spec.events.indexOf('committed'));
  });

  it('keeps the photo key when its file could not be removed, for the job to retry, and reports it', async () => {
    const caller = await emailAccount();
    await rows().setPersonalFields(caller.userId, { photoKey: `photos/${caller.userId}.jpg` });
    spec.storage.failNext();
    await deleteWith(caller.userId, byPassword());
    await spec.settle();
    expect((await rows().deletedUser(caller.userId))?.photoKey).toBe(`photos/${caller.userId}.jpg`);
    expect(spec.reports).toHaveLength(1);
    expect((await rows().deletedUser(caller.userId))?.deletedAt).not.toBeNull();
  });

  it("hands the person to each other module's file erasure after the commit; a failure is reported and the deletion stands", async () => {
    const first = await emailAccount('teacher');
    await deleteWith(first.userId, byPassword());
    await spec.settle();
    expect(spec.files.erased).toEqual([first.userId]);
    expect(spec.events.indexOf('erase-files')).toBeGreaterThan(spec.events.indexOf('committed'));

    const second = await emailAccount('teacher');
    spec.files.failNext();
    await deleteWith(second.userId, byPassword());
    await spec.settle();
    expect(spec.reports).toHaveLength(1);
    expect((await rows().deletedUser(second.userId))?.deletedAt).not.toBeNull();
  });

  it("leaves a held person's photo and files in place after the commit, and still revokes and mails (T004, FR-487)", async () => {
    const caller = await providerAccount('apple', 'apple-refresh-held');
    await rows().setPersonalFields(caller.userId, { photoKey: `photos/${caller.userId}.jpg` });
    spec.held.add(caller.userId);
    const mails = spec.identity.mails().length;
    await deleteWith(caller.userId, await providerProof('apple', caller.subject));
    await spec.settle();
    expect(spec.events.indexOf('files-held')).toBeGreaterThan(spec.events.indexOf('committed'));
    expect(spec.storage.removed).toEqual([]);
    expect(spec.files.erased).toEqual([]);
    expect((await rows().deletedUser(caller.userId))?.photoKey).toBe(`photos/${caller.userId}.jpg`);
    expect(spec.signInPort.calls.filter(({ operation }) => operation === 'revoke')).toEqual([
      { operation: 'revoke', args: [{ provider: 'apple', refreshToken: 'apple-refresh-held' }] },
    ]);
    expect(spec.identity.mails()).toHaveLength(mails + 1);
    expect(spec.reports).toEqual([]);
  });

  it('removes a person not held at once, asked after the commit and before the removal (T004)', async () => {
    const caller = await emailAccount('teacher');
    await rows().setPersonalFields(caller.userId, { photoKey: `photos/${caller.userId}.jpg` });
    await deleteWith(caller.userId, byPassword());
    await spec.settle();
    expect(spec.events.indexOf('files-held')).toBeGreaterThan(spec.events.indexOf('committed'));
    expect(spec.events.indexOf('remove')).toBeGreaterThan(spec.events.indexOf('files-held'));
    expect(spec.events.indexOf('erase-files')).toBeGreaterThan(spec.events.indexOf('files-held'));
    expect(spec.storage.removed).toEqual([`photos/${caller.userId}.jpg`]);
    expect(spec.files.erased).toEqual([caller.userId]);
  });

  it('mails the confirmation to the address after the commit, Arabic first and English under it', async () => {
    const caller = await emailAccount();
    await deleteWith(caller.userId, byPassword());
    await spec.settle();
    const mails = spec.identity.mails().filter(({ to }) => to === caller.email);
    expect(mails).toHaveLength(1);
    const [mail] = mails;
    expect(mail?.subject).toContain('إجازة');
    expect(mail?.subject).toContain('Ijazah');
    const text = mail?.text ?? '';
    expect(text.indexOf('تم حذف حسابك')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Your Ijazah account has been deleted')).toBeGreaterThan(
      text.indexOf('تم حذف حسابك'),
    );
    expect(text).toMatch(/cannot be restored/);
    expect(text).not.toMatch(/session|payment|refund|verif/i);
  });

  it('logs a mail it could not hand over, never the address, and keeps the deletion', async () => {
    spec = buildDeletion(database, {
      email: {
        deliver: async () => {
          throw new Error('spec mail: unreachable');
        },
      },
    });
    const caller = await emailAccount();
    await deleteWith(caller.userId, byPassword());
    await spec.settle();
    expect(spec.identity.warnings).toHaveLength(1);
    expect(JSON.stringify(spec.identity.warnings)).not.toContain(caller.email);
    expect((await rows().deletedUser(caller.userId))?.deletedAt).not.toBeNull();
  });
});

describe('the web: requestWebCode (FR-143, public-pages.md)', () => {
  /** A code hasher counting its work, over the real one. */
  function countingHasher() {
    const real = new OtpHasher(SPEC_ENCRYPTION_KEY);
    const hasher: CodeHasher & { hashes: number } = {
      hashes: 0,
      async hash(code) {
        this.hashes += 1;
        return real.hash(code);
      },
      verify: (code, stored) => real.verify(code, stored),
    };
    return hasher;
  }

  it('writes an account_deletion code for an account and mails it after the commit', async () => {
    const caller = await emailAccount();
    await expect(spec.deletion.requestWebCode(caller.email.toUpperCase())).resolves.toBeUndefined();
    const codes = await rows().codes(caller.email);
    expect(codes).toEqual([expect.objectContaining({ purpose: 'account_deletion' })]);
    await vi.waitFor(() =>
      expect(codeMailedTo(spec.identity.mails(), caller.email)).toMatch(/^\d{6}$/),
    );
  });

  it('a provider account gets its code too: an account, whatever its sign-in method', async () => {
    const caller = await providerAccount('google');
    await spec.deletion.requestWebCode(caller.email);
    expect(await rows().codes(caller.email)).toEqual([
      expect.objectContaining({ purpose: 'account_deletion' }),
    ]);
  });

  it('answers an unknown address the same, with the same hashing work, and writes and mails nothing', async () => {
    const hasher = countingHasher();
    spec = buildDeletion(database, { codeHasher: hasher });
    const caller = await emailAccount();
    const before = hasher.hashes;
    await spec.deletion.requestWebCode(caller.email);
    const known = hasher.hashes - before;

    const unknown = uniqueEmail();
    const middle = hasher.hashes;
    await expect(spec.deletion.requestWebCode(unknown)).resolves.toBeUndefined();
    expect(hasher.hashes - middle).toBe(known);
    expect(await rows().codes(unknown)).toEqual([]);
    expect(spec.identity.mails().filter(({ to }) => to === unknown)).toEqual([]);
  });
});

describe('the web: confirmWebDeletion (FR-143)', () => {
  async function mailedCode(email: string): Promise<string> {
    await spec.deletion.requestWebCode(email);
    await vi.waitFor(() => expect(codeMailedTo(spec.identity.mails(), email)).toMatch(/^\d{6}$/));
    return codeMailedTo(spec.identity.mails(), email);
  }

  it('runs the same deletion on the right code: erased, revoked, consequences called, confirmation mailed', async () => {
    const caller = await providerAccount('apple', 'apple-grant-web');
    const code = await mailedCode(caller.email);
    await expect(spec.deletion.confirmWebDeletion(caller.email, code)).resolves.toBe(true);
    await spec.settle();

    expect(await rows().deletedUser(caller.userId)).toMatchObject({
      email: null,
      displayName: null,
      deletedAt: spec.identity.clock.now(),
    });
    expect(await rows().identities(caller.userId)).toEqual([]);
    expect((await rows().sessions(caller.userId))[0]?.revokedReason).toBe('account_deleted');
    expect(spec.terminations).toEqual([{ userId: caller.userId, cause: 'account_deleted' }]);
    expect(spec.signInPort.calls.filter(({ operation }) => operation === 'revoke')).toHaveLength(1);
    const mails = spec.identity.mails().filter(({ to }) => to === caller.email);
    expect(mails.at(-1)?.text).toContain('Your Ijazah account has been deleted');
  });

  it('answers false on a wrong code and deletes nothing', async () => {
    const caller = await emailAccount();
    const code = await mailedCode(caller.email);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(spec.deletion.confirmWebDeletion(caller.email, wrong)).resolves.toBe(false);
    await expectUntouched(caller.userId, caller.email);
    expect(spec.terminations).toEqual([]);
  });

  it('answers false for an address with no account, after the same comparison', async () => {
    await expect(spec.deletion.confirmWebDeletion(uniqueEmail(), '123456')).resolves.toBe(false);
  });

  it('lets a domain error other than a wrong code through', async () => {
    const caller = await emailAccount();
    vi.spyOn(spec.identity.codes, 'verify').mockRejectedValueOnce(new DomainError('RATE_LIMITED'));
    await expect(spec.deletion.confirmWebDeletion(caller.email, '123456')).rejects.toEqual(
      refused('RATE_LIMITED'),
    );
  });
});
