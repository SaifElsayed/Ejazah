// T049 — the signed-in person's own account (FR-131, FR-132; app-surface.md "`account`").
//
// `me` answers the caller's own account and nothing of another person: the fields of
// contracts/app-surface.md, the photo as a signed link that lapses, a teacher's application and
// payout standing read from the identity module's own `teacher_profiles` row (no count over another
// module's table: the credentials badge reads `teacher.credentials.list`). The language and the
// display name are the person's to change; the time zone is the device's until the person chooses
// one by hand, and a chosen zone is kept: the device's report on a later launch leaves it
// (FR-AUTH-10; `users.timezone_overridden_at`, owner's decision 2026-10-20).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../../platform/db/prisma.repository.js';
import {
  buildIdentity,
  createAccount,
  createTeacherProfile,
  type Identity,
  openSpecDatabase,
  rowsOf,
  uniqueSubject,
} from './__fixtures__/identity.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let identity: Identity;
beforeEach(() => {
  identity = buildIdentity(database);
});

const rows = () => rowsOf(database);

describe('me', () => {
  it("answers a student's own account, field for field, and nothing a teacher has", async () => {
    const { userId, email } = await createAccount(database, { passwordHash: 'x', gender: 'male' });
    const me = await identity.account.me(userId);
    const user = await rows().user(userId);
    expect(me).toEqual({
      userId,
      role: 'student',
      displayName: 'Spec Person',
      email,
      gender: 'male',
      dateOfBirth: '1990-04-12',
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      signInMethod: 'email',
      memberSince: user?.createdAt.toISOString(),
      accountStatus: 'active',
      landing: 'student_home',
    });
  });

  it('names the provider an account signs in with', async () => {
    for (const provider of ['google', 'apple'] as const) {
      const { userId } = await createAccount(database, {
        provider: { provider, subject: uniqueSubject() },
      });
      await expect(identity.account.me(userId)).resolves.toMatchObject({
        signInMethod: provider,
      });
    }
  });

  it('answers the photo as a signed link that lapses, never the storage key itself', async () => {
    const { userId } = await createAccount(database);
    await rows().setPhotoKey(userId, `photos/${userId}/a.jpg`);
    const me = await identity.account.me(userId);
    expect(me.photoUrl).toBe(`https://storage.invalid/photos/${userId}/a.jpg?expires=300`);
  });

  it('answers a teacher before the application exists as not started, payout unset', async () => {
    const { userId } = await createAccount(database, { role: 'teacher' });
    await expect(identity.account.me(userId)).resolves.toMatchObject({
      role: 'teacher',
      landing: 'teacher_application',
      teacher: {
        applicationStatus: 'not_started',
        verificationStatus: 'pending',
        payout: { configured: false, verified: false },
      },
    });
  });

  it("answers a teacher's application and payout standing from the profile", async () => {
    const { userId } = await createAccount(database, { role: 'teacher' });
    await createTeacherProfile(database, userId, {
      verificationStatus: 'approved',
      applicationStatus: 'approved',
      payoutConfiguredAt: new Date('2026-10-19T10:00:00Z'),
      payoutRejectedReason: 'The name does not match',
    });
    const me = await identity.account.me(userId);
    expect(me.teacher).toEqual({
      applicationStatus: 'approved',
      verificationStatus: 'approved',
      payout: { configured: true, verified: false, rejectedReason: 'The name does not match' },
    });
    expect(me.landing).toBe('teacher_home');
  });

  it('answers a rejection the gateway gave no reason for with no reason (B15, decision 2)', async () => {
    const { userId } = await createAccount(database, { role: 'teacher' });
    await createTeacherProfile(database, userId, {
      verificationStatus: 'approved',
      applicationStatus: 'approved',
      payoutConfiguredAt: new Date('2026-10-19T10:00:00Z'),
      payoutRejectedReason: '',
    });
    expect((await identity.account.me(userId)).teacher?.payout).toEqual({
      configured: true,
      verified: false,
    });
  });

  it('answers a restricted account, which still reads its own standing (FR-137)', async () => {
    const { userId } = await createAccount(database, { accountStatus: 'suspended' });
    await expect(identity.account.me(userId)).resolves.toMatchObject({
      accountStatus: 'suspended',
      landing: 'restricted',
    });
  });

  it('refuses an account that no longer exists', async () => {
    const { userId } = await createAccount(database);
    await rows().softDelete(userId);
    await expect(identity.account.me(userId)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('updateProfile', () => {
  it('changes the display name, and nothing when none is given', async () => {
    const { userId } = await createAccount(database);
    await identity.account.updateProfile(userId, { displayName: 'Amina' });
    expect((await rows().user(userId))?.displayName).toBe('Amina');
    await identity.account.updateProfile(userId, {});
    expect((await rows().user(userId))?.displayName).toBe('Amina');
  });
});

describe('setLanguage', () => {
  it('stores the language on the account (FR-131)', async () => {
    const { userId } = await createAccount(database);
    await identity.account.setLanguage(userId, 'en');
    expect((await rows().user(userId))?.preferredLanguage).toBe('en');
  });
});

describe('the time zone (FR-AUTH-10)', () => {
  it("follows the device's report while the person has not chosen one", async () => {
    const { userId } = await createAccount(database);
    await identity.account.reportDeviceTimezone(userId, 'Asia/Riyadh');
    const user = await rows().user(userId);
    expect(user?.timezone).toBe('Asia/Riyadh');
    expect(user?.timezoneOverriddenAt).toBeNull();
  });

  it('keeps a zone chosen by hand: a later device report leaves it', async () => {
    const { userId } = await createAccount(database);
    await identity.account.setTimezone(userId, 'Europe/London');
    let user = await rows().user(userId);
    expect(user?.timezone).toBe('Europe/London');
    expect(user?.timezoneOverriddenAt).toEqual(identity.clock.now());
    await identity.account.reportDeviceTimezone(userId, 'Asia/Riyadh');
    user = await rows().user(userId);
    expect(user?.timezone).toBe('Europe/London');
  });

  it('refuses a zone the time package does not know, by its field', async () => {
    const { userId } = await createAccount(database);
    for (const zone of ['Mars/Olympus', '+03:00', 'UTC']) {
      await expect(identity.account.setTimezone(userId, zone)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ path: 'timezone', code: 'unknown' }],
      });
      await expect(identity.account.reportDeviceTimezone(userId, zone)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
    expect((await rows().user(userId))?.timezone).toBe('Africa/Cairo');
  });
});
