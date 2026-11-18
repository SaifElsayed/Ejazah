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

import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashPassword, OtpHasher } from '../../platform/crypto/hashing.js';
import { closeDatabase, type Transaction } from '../../platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../platform/db/spec-database.fixtures.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { bindToTransaction, publisherOn, RequestLive } from '../../platform/live/live-publisher.js';

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
import { createIdentityServices } from './index.js';
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
    // T080 of specs/004-sessions (rule d): the count is asked inside the transaction, before the erasure;
    // 005:T031 (rule d): the request count after it.
    expect(spec.events.slice(0, 6)).toEqual([
      'verify',
      'transaction',
      'ongoing-asked',
      'requests-asked',
      'consequence',
      'committed',
    ]);
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

  // T063 of specs/004-sessions (FR-429; research R-324, item 6): the deleted person's `account`, once
  // the deletion has committed, ends their live streams; a refused deletion sends nothing.
  it('publishes the person’s `account` on the live bus after the commit, and nothing when refused (T063)', async () => {
    const caller = await emailAccount();
    await expect(deleteWith(caller.userId, byPassword('a wrong passphrase'))).rejects.toEqual(
      refused('SIGN_IN_FAILED'),
    );
    expect(spec.published).toEqual([]);

    await deleteWith(caller.userId, byPassword());

    expect(spec.published).toEqual([{ to: [caller.userId], event: { type: 'account' } }]);
    expect(spec.events.indexOf('live-account')).toBeGreaterThan(spec.events.indexOf('committed'));
  });

  // T063: the owner's decision of 2026-11-09 (the coverage of CI's command, deletion.service.ts:313).
  it.each([
    ['an Error, by its name', new TypeError('spec bus: unreachable'), 'TypeError'],
    ['anything else, as unknown', 'spec bus: a thrown string', 'unknown'],
  ])(
    'a publish that fails with %s writes one warning of eventType and errorName only, and the deletion goes on (T063)',
    async (_case, thrown, errorName) => {
      spec = buildDeletion(
        database,
        {},
        {
          publish: () => {
            throw thrown;
          },
        },
      );
      const caller = await emailAccount();

      await deleteWith(caller.userId, byPassword());
      await spec.settle();

      expect(spec.identity.warnings).toEqual([{ eventType: 'account', errorName }]);
      expect((await rows().deletedUser(caller.userId))?.deletedAt).not.toBeNull();
      expect(spec.identity.mails().filter(({ to }) => to === caller.email)).toHaveLength(1);
    },
  );

  // T063: the owner's decision of 2026-11-09 (the coverage of CI's command, index.ts:185).
  it('the composition hands `live` to the deletion: createIdentityServices publishes the person’s `account` (T063)', async () => {
    const published: unknown[] = [];
    const services = createIdentityServices({
      ...spec.composition,
      live: { publish: (message) => void published.push(message) },
    });
    const caller = await emailAccount();

    await services.deletion.deleteAccount(caller.userId, {
      confirmation: 'حذف',
      reauth: byPassword(),
      idempotencyKey: key(),
    });
    await spec.settle();

    expect(published).toEqual([{ to: [caller.userId], event: { type: 'account' } }]);
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

// T080 of specs/004-sessions (FR-511; SRS FR-AUTH-14 as amended, DEC-67; the note under T080,
// Q-R10 (a), Q-R11 (a), N4, N5): the person's own deletion, in the app and on the web, takes the
// account's lock first, then asks booking's count through the `OngoingEnrollments` port on its own
// transaction; while it answers an ongoing enrollment the deletion is refused `CONFLICT`
// `active_enrollments`, naming no count, with one info line of ids and the reason, and nothing is
// written: the key's claim rolls back with it, so the same key deletes once the enrollments end.
// What the count counts is the db-integrity probe's (`tests/db-integrity/deletion-ongoing.spec.ts`).
describe('a deletion refused with an ongoing enrollment (T080, FR-511)', () => {
  const ongoingRefusal = expect.objectContaining({
    code: 'CONFLICT',
    details: [{ path: 'cause', code: 'active_enrollments' }],
  });

  it('account.delete: refused CONFLICT active_enrollments, nothing written, no work after the commit, one info line', async () => {
    const caller = await emailAccount('teacher');
    spec.ongoing.people.add(caller.userId);
    await expect(deleteWith(caller.userId, byPassword())).rejects.toEqual(ongoingRefusal);
    await spec.settle();

    await expectUntouched(caller.userId, caller.email);
    expect(spec.terminations).toEqual([]);
    expect(spec.published).toEqual([]);
    expect(spec.events).not.toContain('files-held');
    expect(spec.identity.mails().filter(({ to }) => to === caller.email)).toEqual([]);
    expect(spec.infos).toEqual([{ userId: caller.userId, reason: 'active_enrollments' }]);
  });

  it('account.delete: the refusal rolls the key’s claim back, so the same key deletes once the enrollments end', async () => {
    const caller = await emailAccount();
    spec.ongoing.people.add(caller.userId);
    const idempotencyKey = key();
    const input = { confirmation: 'حذف' as const, reauth: byPassword(), idempotencyKey };
    await expect(spec.deletion.deleteAccount(caller.userId, input)).rejects.toEqual(ongoingRefusal);
    spec.ongoing.people.delete(caller.userId);
    await spec.deletion.deleteAccount(caller.userId, input);

    expect(await rows().deletedUser(caller.userId)).toMatchObject({ email: null });
    expect(spec.terminations).toEqual([{ userId: caller.userId, cause: 'account_deleted' }]);
  });

  it('asks the count on the deletion’s own transaction, holding the account’s lock, and deletes when there is none', async () => {
    const caller = await emailAccount();
    const asked: unknown[] = [];
    const lockedWhenAsked: boolean[] = [];
    spec.ongoing.answer = async (tx, userId) => {
      asked.push(tx);
      lockedWhenAsked.push(await rowLockedElsewhere(userId));
      return false;
    };
    let erasedOn: unknown;
    spec.consequences.subscribe(async (tx) => {
      erasedOn = tx;
    });
    await deleteWith(caller.userId, byPassword());

    expect(asked).toHaveLength(1);
    expect(asked[0]).toBe(erasedOn);
    expect(lockedWhenAsked).toEqual([true]);
    expect(spec.infos).toEqual([]);
    expect(await rows().deletedUser(caller.userId)).toMatchObject({ email: null });
  });

  it('the web: the right code is spent, the deletion refused with the same error, nothing written', async () => {
    const caller = await emailAccount();
    spec.ongoing.people.add(caller.userId);
    await spec.deletion.requestWebCode(caller.email);
    await vi.waitFor(() =>
      expect(codeMailedTo(spec.identity.mails(), caller.email)).toMatch(/^\d{6}$/),
    );
    const code = codeMailedTo(spec.identity.mails(), caller.email);

    await expect(spec.deletion.confirmWebDeletion(caller.email, code)).rejects.toEqual(
      ongoingRefusal,
    );
    await spec.settle();
    await expectUntouched(caller.userId, caller.email);
    expect(spec.terminations).toEqual([]);
    expect(spec.published).toEqual([]);
    expect(spec.infos).toEqual([{ userId: caller.userId, reason: 'active_enrollments' }]);
    // N5: the code was consumed before the refusal; a later try asks for a new one.
    spec.ongoing.people.delete(caller.userId);
    await expect(spec.deletion.confirmWebDeletion(caller.email, code)).resolves.toBe(false);
  });
});

/**
 * T080: whether another connection finds the account's row locked (`FOR UPDATE NOWAIT` refused with
 * 55P03), asked while the deletion's transaction runs.
 */
async function rowLockedElsewhere(userId: string): Promise<boolean> {
  const other = new pg.Client({ connectionString: specDatabaseUrl('DATABASE_URL') });
  await other.connect();
  try {
    await other.query('BEGIN');
    await other.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE NOWAIT', [userId]);
    return false;
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '55P03') return true;
    throw error;
  } finally {
    await other.query('ROLLBACK').catch(() => undefined);
    await other.end();
  }
}

// T081 of specs/004-sessions (FR-512; SRS FR-ADMIN-22; the notes under T081, Q-O2 (a), N6,
// Q-R13 (a)): an administrator's deletion at the owner's request, on the administrator kind's
// transaction (its request's list bound to it, as `adminProcedure` binds it), keyed there, without
// the re-authentication and without T080's count; the account's lock first; the administrator
// passed to the consequences as `actor`; the kind's list reused, never a second one bound; the work
// after the commit queued on that list, so it runs after the kind's commit and never after its
// rollback. `NOT_FOUND` for an unknown or already deleted account, one info line of ids each way.
describe('an administrator’s deletion (T081, FR-512)', () => {
  const ADMIN = '0199d0a0-0000-7000-8000-0000000ad081';
  const reason = 'طلب صاحب الحساب الحذف عبر الدعم';

  /** The administrator kind's transaction: its request's list bound to it, flushed after the commit. */
  async function asAdministrator<T>(work: (tx: Transaction) => Promise<T>) {
    const sent: unknown[] = [];
    const live = new RequestLive(
      { publish: (message) => void sent.push(message) },
      { warn: () => undefined },
    );
    try {
      const answer = await database.$transaction(async (tx) => {
        const unbind = bindToTransaction(tx, live);
        try {
          return await work(tx);
        } finally {
          unbind();
        }
      });
      live.flush();
      return { answer, sent, live };
    } catch (error: unknown) {
      live.drop();
      throw error;
    }
  }

  const removal = (targetUserId: string, idempotencyKey = key()) => ({
    targetUserId,
    reason,
    idempotencyKey,
  });

  it('deletes over an ongoing enrollment, with no proof and no count, passing the administrator to the consequences', async () => {
    const caller = await emailAccount('teacher');
    spec.ongoing.people.add(caller.userId);
    const actors: unknown[] = [];
    spec.consequences.subscribe(async (_tx, _userId, _cause, actor) => void actors.push(actor));
    const { answer } = await asAdministrator((tx) =>
      spec.deletion.deleteByAdministrator(tx, ADMIN, removal(caller.userId)),
    );
    await spec.settle();

    expect(answer).toEqual({ replayed: false });
    expect(await rows().deletedUser(caller.userId)).toMatchObject({ email: null });
    expect(spec.terminations).toEqual([{ userId: caller.userId, cause: 'account_deleted' }]);
    expect(actors).toEqual([{ adminId: ADMIN }]);
    expect(spec.events).not.toContain('ongoing-asked');
    expect(spec.events).not.toContain('verify');
    expect(spec.keyed.at(-1)).toMatchObject({ scope: 'users.delete', actorId: ADMIN });
    expect(spec.infos).toEqual([{ adminId: ADMIN, userId: caller.userId }]);
  });

  it('holds the account’s lock when the consequences run', async () => {
    const caller = await emailAccount();
    const locked: boolean[] = [];
    spec.consequences.subscribe(
      async (_tx, userId) => void locked.push(await rowLockedElsewhere(userId)),
    );
    await asAdministrator((tx) =>
      spec.deletion.deleteByAdministrator(tx, ADMIN, removal(caller.userId)),
    );
    expect(locked).toEqual([true]);
  });

  it('reuses the kind’s list: a consequence reaches it, and it stays bound for the rest of the call', async () => {
    const caller = await emailAccount();
    const seen: unknown[] = [];
    spec.consequences.subscribe(async (tx) => void seen.push(publisherOn(tx)));
    const after: unknown[] = [];
    const { live } = await asAdministrator(async (tx) => {
      await spec.deletion.deleteByAdministrator(tx, ADMIN, removal(caller.userId));
      after.push(publisherOn(tx));
    });
    // The same list, not an equal one: a second list bound would replace the kind's (T081's note).
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(live);
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(live);
  });

  it('runs the work after the commit only once the kind’s transaction has committed: the account, the files, the grant, the mail', async () => {
    const caller = await providerAccount('apple', 'apple-grant-admin');
    let inside: { readonly filesAsked: boolean; readonly published: number } | undefined;
    await asAdministrator(async (tx) => {
      await spec.deletion.deleteByAdministrator(tx, ADMIN, removal(caller.userId));
      inside = { filesAsked: spec.events.includes('files-held'), published: spec.published.length };
    });
    await spec.settle();

    expect(inside).toEqual({ filesAsked: false, published: 0 });
    expect(spec.published).toEqual([{ to: [caller.userId], event: { type: 'account' } }]);
    expect(spec.events).toContain('files-held');
    expect(spec.files.erased).toEqual([caller.userId]);
    expect(spec.signInPort.calls.filter(({ operation }) => operation === 'revoke')).toHaveLength(1);
    const mails = spec.identity.mails().filter(({ to }) => to === caller.email);
    expect(mails.at(-1)?.text).toContain('Your Ijazah account has been deleted');
  });

  it('runs no work after the commit when the kind’s transaction rolls back, and erases nothing', async () => {
    const caller = await emailAccount();
    await expect(
      asAdministrator(async (tx) => {
        await spec.deletion.deleteByAdministrator(tx, ADMIN, removal(caller.userId));
        throw new Error('the audit entry could not be written');
      }),
    ).rejects.toThrow('the audit entry could not be written');
    await spec.settle();

    await expectUntouched(caller.userId, caller.email);
    expect(spec.published).toEqual([]);
    expect(spec.events).not.toContain('files-held');
  });

  it('a replay of the key answers replayed and does nothing more', async () => {
    const caller = await emailAccount();
    const input = removal(caller.userId);
    await asAdministrator((tx) => spec.deletion.deleteByAdministrator(tx, ADMIN, input));
    await spec.settle();
    const { answer } = await asAdministrator((tx) =>
      spec.deletion.deleteByAdministrator(tx, ADMIN, input),
    );
    await spec.settle();

    expect(answer).toEqual({ replayed: true });
    expect(spec.terminations).toHaveLength(1);
    expect(spec.published).toHaveLength(1);
  });

  it.each([
    ['an unknown account', async () => randomUUID()],
    [
      'an account already deleted',
      async () => {
        const caller = await emailAccount();
        await deleteWith(caller.userId, byPassword());
        spec.terminations.length = 0;
        return caller.userId;
      },
    ],
  ])('refuses %s NOT_FOUND, writing nothing, with one info line of ids', async (_case, target) => {
    const userId = await target();
    await expect(
      asAdministrator((tx) => spec.deletion.deleteByAdministrator(tx, ADMIN, removal(userId))),
    ).rejects.toEqual(refused('NOT_FOUND'));
    expect(spec.terminations).toEqual([]);
    expect(spec.infos).toEqual([{ adminId: ADMIN, userId, reason: 'not_found' }]);
  });

  it('refuses to run on a transaction no caller kind bound a list to, before anything is written', async () => {
    const caller = await emailAccount();
    await expect(
      database.$transaction((tx) =>
        spec.deletion.deleteByAdministrator(tx, ADMIN, removal(caller.userId)),
      ),
    ).rejects.toThrow(/after-commit list/);
    await expectUntouched(caller.userId, caller.email);
  });
});

// 005:T031 of specs/005-certification (FR-630; R-414; DEC-72; the note under T031, Q-D1 (a)): a
// teacher's deletion waits for their undecided ijazah requests (`OpenIjazahRequests`, certification's
// count): the person's own, in the app and on the web, after T080's count; an administrator's of a
// teacher (the role read after the account's lock) also for their live enrollments (`live`, read
// first) and their open compensation cases (`OpenCases`, read after `live`). Each refusal is
// `CONFLICT` with its cause, writes nothing and logs one info line of ids and the cause. An
// administrator's deletion of a student asks none of them.
describe('a teacher’s own deletion waits for their ijazah requests (005:T031, FR-630)', () => {
  const requestsRefusal = expect.objectContaining({
    code: 'CONFLICT',
    details: [{ path: 'cause', code: 'pending_ijazah_requests' }],
  });

  it('account.delete: refused CONFLICT pending_ijazah_requests, nothing written, no work after the commit, one info line', async () => {
    const caller = await emailAccount('teacher');
    spec.open.requests.add(caller.userId);
    await expect(deleteWith(caller.userId, byPassword())).rejects.toEqual(requestsRefusal);
    await spec.settle();

    await expectUntouched(caller.userId, caller.email);
    expect(spec.terminations).toEqual([]);
    expect(spec.published).toEqual([]);
    expect(spec.events).not.toContain('files-held');
    expect(spec.identity.mails().filter(({ to }) => to === caller.email)).toEqual([]);
    expect(spec.infos).toEqual([{ userId: caller.userId, reason: 'pending_ijazah_requests' }]);
  });

  it('the web: the right code is spent, the deletion refused with the same error, nothing written', async () => {
    const caller = await emailAccount('teacher');
    spec.open.requests.add(caller.userId);
    await spec.deletion.requestWebCode(caller.email);
    await vi.waitFor(() =>
      expect(codeMailedTo(spec.identity.mails(), caller.email)).toMatch(/^\d{6}$/),
    );
    const code = codeMailedTo(spec.identity.mails(), caller.email);

    await expect(spec.deletion.confirmWebDeletion(caller.email, code)).rejects.toEqual(
      requestsRefusal,
    );
    await spec.settle();
    await expectUntouched(caller.userId, caller.email);
    expect(spec.terminations).toEqual([]);
    expect(spec.infos).toEqual([{ userId: caller.userId, reason: 'pending_ijazah_requests' }]);
  });

  it('asks the count after T080’s, on the deletion’s own transaction holding the account’s lock, and deletes when there is none', async () => {
    const caller = await emailAccount('teacher');
    const asked: unknown[] = [];
    const lockedWhenAsked: boolean[] = [];
    spec.open.requestsAnswer = async (tx, userId) => {
      asked.push(tx);
      lockedWhenAsked.push(await rowLockedElsewhere(userId));
      return 0;
    };
    let erasedOn: unknown;
    spec.consequences.subscribe(async (tx) => {
      erasedOn = tx;
    });
    await deleteWith(caller.userId, byPassword());

    expect(asked).toHaveLength(1);
    expect(asked[0]).toBe(erasedOn);
    expect(lockedWhenAsked).toEqual([true]);
    expect(spec.events.filter((event) => event.endsWith('-asked'))).toEqual([
      'ongoing-asked',
      'requests-asked',
    ]);
    expect(await rows().deletedUser(caller.userId)).toMatchObject({ email: null });
  });

  it('refuses for T080’s cause first when both hold, naming one cause', async () => {
    const caller = await emailAccount('teacher');
    spec.ongoing.people.add(caller.userId);
    spec.open.requests.add(caller.userId);
    await expect(deleteWith(caller.userId, byPassword())).rejects.toEqual(
      expect.objectContaining({ details: [{ path: 'cause', code: 'active_enrollments' }] }),
    );
    expect(spec.events).not.toContain('requests-asked');
  });
});

describe('an administrator’s deletion of a teacher waits (005:T031, FR-630)', () => {
  const ADMIN = '0199d0a0-0000-7000-8000-0000000ad031';
  const reason = 'طلب صاحب الحساب الحذف عبر الدعم';

  async function asAdministrator<T>(work: (tx: Transaction) => Promise<T>) {
    const live = new RequestLive({ publish: () => undefined }, { warn: () => undefined });
    try {
      const answer = await database.$transaction(async (tx) => {
        const unbind = bindToTransaction(tx, live);
        try {
          return await work(tx);
        } finally {
          unbind();
        }
      });
      live.flush();
      return answer;
    } catch (error: unknown) {
      live.drop();
      throw error;
    }
  }

  const removeAsAdministrator = (targetUserId: string) =>
    asAdministrator((tx) =>
      spec.deletion.deleteByAdministrator(tx, ADMIN, {
        targetUserId,
        reason,
        idempotencyKey: key(),
      }),
    );

  const refusalFor = (cause: string) =>
    expect.objectContaining({ code: 'CONFLICT', details: [{ path: 'cause', code: cause }] });

  it.each([
    ['a live enrollment', 'active_enrollments', 'live'],
    ['an undecided ijazah request', 'pending_ijazah_requests', 'requests'],
    ['an open compensation case', 'open_cases', 'cases'],
  ] as const)(
    'refuses a teacher with %s (CONFLICT %s), writing nothing, with one info line of ids and the cause',
    async (_case, cause, matter) => {
      const teacher = await emailAccount('teacher');
      spec.open[matter].add(teacher.userId);
      await expect(removeAsAdministrator(teacher.userId)).rejects.toEqual(refusalFor(cause));
      await spec.settle();

      await expectUntouched(teacher.userId, teacher.email);
      expect(spec.terminations).toEqual([]);
      expect(spec.published).toEqual([]);
      expect(spec.events).not.toContain('files-held');
      expect(spec.infos).toEqual([{ adminId: ADMIN, userId: teacher.userId, reason: cause }]);
    },
  );

  it('reads live first, then the requests, then the open cases, holding the account’s lock, and deletes when all are none', async () => {
    const teacher = await emailAccount('teacher');
    const lockedWhenAsked: boolean[] = [];
    spec.open.liveAnswer = async (_tx, userId) => {
      lockedWhenAsked.push(await rowLockedElsewhere(userId));
      return false;
    };
    await removeAsAdministrator(teacher.userId);
    await spec.settle();

    expect(spec.events.filter((event) => event.endsWith('-asked'))).toEqual([
      'live-asked',
      'requests-asked',
      'cases-asked',
    ]);
    expect(lockedWhenAsked).toEqual([true]);
    expect(await rows().deletedUser(teacher.userId)).toMatchObject({ email: null });
    expect(spec.infos).toEqual([{ adminId: ADMIN, userId: teacher.userId }]);
  });

  it('refuses for the first cause read when several hold: live before the open cases', async () => {
    const teacher = await emailAccount('teacher');
    spec.open.live.add(teacher.userId);
    spec.open.cases.add(teacher.userId);
    await expect(removeAsAdministrator(teacher.userId)).rejects.toEqual(
      refusalFor('active_enrollments'),
    );
    expect(spec.events).not.toContain('cases-asked');
  });

  it('a student’s is unchanged: deleted over a live enrollment, a request and a case, no count asked', async () => {
    const student = await emailAccount('student');
    spec.open.live.add(student.userId);
    spec.open.requests.add(student.userId);
    spec.open.cases.add(student.userId);
    await removeAsAdministrator(student.userId);
    await spec.settle();

    expect(await rows().deletedUser(student.userId)).toMatchObject({ email: null });
    expect(spec.terminations).toEqual([{ userId: student.userId, cause: 'account_deleted' }]);
    expect(spec.events.filter((event) => event.endsWith('-asked'))).toEqual([]);
  });

  it('an already deleted teacher is still NOT_FOUND, no count asked', async () => {
    const teacher = await emailAccount('teacher');
    await deleteWith(teacher.userId, byPassword());
    spec.events.length = 0;
    spec.infos.length = 0;
    spec.open.cases.add(teacher.userId);
    await expect(removeAsAdministrator(teacher.userId)).rejects.toEqual(refused('NOT_FOUND'));
    expect(spec.events.filter((event) => event.endsWith('-asked'))).toEqual([]);
    expect(spec.infos).toEqual([{ adminId: ADMIN, userId: teacher.userId, reason: 'not_found' }]);
  });
});

// T066 of specs/004-sessions (FR-427; research R-324, item 6; the note under T066, Q3 (a)): the
// deletion binds its own transaction to its after-commit list, so a consequence handed only the
// transaction (booking's subscriber, telling the other party of each enrollment the deletion ends)
// reaches it through `publisherOn(tx)`; the list is sent once the deletion has committed, beside the
// person's `account`, and dropped when the deletion rolls back. Both paths: the app and the web.
describe('the deletion’s after-commit list (T066)', () => {
  const OTHER = '0199d0a0-0000-7000-8000-0000000d0a01';
  const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000d0ae1';
  const told = { to: [OTHER], event: { type: 'enrollment', enrollmentId: ENROLLMENT } };

  /** A consequence as booking's subscriber adds its event: through the transaction it is handed. */
  function tellingConsequence() {
    spec.consequences.subscribe(async (tx) => {
      spec.events.push(publisherOn(tx) === undefined ? 'unbound' : 'added');
      publisherOn(tx)?.afterCommit([OTHER], { type: 'enrollment', enrollmentId: ENROLLMENT });
    });
  }

  it('account.delete: a consequence’s event, added on the deletion’s transaction, is sent once after the commit', async () => {
    tellingConsequence();
    const caller = await emailAccount('teacher');
    await deleteWith(caller.userId, byPassword());
    await spec.settle();

    expect(spec.events).toContain('added');
    expect(spec.published).toEqual([{ to: [caller.userId], event: { type: 'account' } }, told]);
    expect(spec.events.indexOf('added')).toBeLessThan(spec.events.indexOf('committed'));
    expect(spec.events.lastIndexOf('live-account')).toBeGreaterThan(
      spec.events.indexOf('committed'),
    );
  });

  it('account.delete: nothing is sent when the deletion rolls back after the event was added', async () => {
    tellingConsequence();
    spec.consequences.subscribe(async () => {
      throw new Error('a module refused the deletion');
    });
    const caller = await emailAccount('teacher');
    await expect(deleteWith(caller.userId, byPassword())).rejects.toThrow(
      'a module refused the deletion',
    );
    await spec.settle();

    expect(spec.events).toContain('added');
    expect(spec.published).toEqual([]);
  });

  it('the web’s confirm step sends the consequence’s event after its commit too', async () => {
    tellingConsequence();
    const caller = await emailAccount();
    await spec.deletion.requestWebCode(caller.email);
    await vi.waitFor(() =>
      expect(codeMailedTo(spec.identity.mails(), caller.email)).toMatch(/^\d{6}$/),
    );
    const code = codeMailedTo(spec.identity.mails(), caller.email);

    await expect(spec.deletion.confirmWebDeletion(caller.email, code)).resolves.toBe(true);
    await spec.settle();

    expect(spec.events).toContain('added');
    expect(spec.published).toEqual([{ to: [caller.userId], event: { type: 'account' } }, told]);
  });

  it('the list is unbound once the deletion’s transaction has ended', async () => {
    let held: unknown;
    spec.consequences.subscribe(async (tx) => {
      held = tx;
    });
    const caller = await emailAccount();
    await deleteWith(caller.userId, byPassword());
    expect(held).toBeDefined();
    expect(publisherOn(held)).toBeUndefined();
  });
});
