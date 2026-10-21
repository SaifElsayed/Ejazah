// T049 — the `account` namespace as the user surface serves it (app-surface.md "`account` — the
// signed-in person"; FR-131, FR-137).
//
// Every procedure here is the user kind, so each refuses an anonymous caller (the authorization
// gate, T028, R-MOBILE-13, reads these cases by path). `me` and `setLanguage` admit a suspended or
// banned account, which still reads its standing and its language on the restricted screen; the
// profile and the time zone do not. What the service answers is proven by account.service.spec.ts.
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildIdentity,
  createAccount,
  type Identity,
  openSpecDatabase,
  rowsOf,
} from './__fixtures__/identity.js';
import { metaOf, surfaceOf } from './__fixtures__/surface.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let identity: Identity;
let surface: ReturnType<typeof surfaceOf>;
beforeEach(() => {
  identity = buildIdentity(database);
  surface = surfaceOf(identity);
});

const refused = (code: string) => ({ cause: { code } });

async function signedIn(accountStatus: 'active' | 'suspended' = 'active') {
  const { userId } = await createAccount(database, { accountStatus });
  const { accessToken } = await identity.sessions.issue(userId);
  return { userId, caller: await surface.bearing(accessToken) };
}

describe('the namespace', () => {
  it('declares every procedure as the user kind, none of them limited', () => {
    for (const path of [
      'account.me',
      'account.updateProfile',
      'account.setLanguage',
      'account.setTimezone',
      'account.reportDeviceTimezone',
    ]) {
      expect(metaOf(path)).toEqual({ surface: 'app', caller: 'user' });
    }
  });
});

describe('account.me', () => {
  it('refuses an anonymous caller with UNAUTHENTICATED', async () => {
    await expect(surface.anonymous().account.me()).rejects.toMatchObject(
      refused('UNAUTHENTICATED'),
    );
  });

  it("answers the caller's own account, a suspended one's too", async () => {
    const { userId, caller } = await signedIn('suspended');
    await expect(caller.account.me()).resolves.toMatchObject({
      userId,
      role: 'student',
      accountStatus: 'suspended',
    });
  });
});

describe('account.updateProfile', () => {
  it('refuses an anonymous caller with UNAUTHENTICATED', async () => {
    await expect(
      surface.anonymous().account.updateProfile({ displayName: 'Amina' }),
    ).rejects.toMatchObject(refused('UNAUTHENTICATED'));
  });

  it('changes the display name, and refuses a restricted account', async () => {
    const { userId, caller } = await signedIn();
    await caller.account.updateProfile({ displayName: '  Amina  ' });
    expect((await rowsOf(database).user(userId))?.displayName).toBe('Amina');
    const restricted = await signedIn('suspended');
    await expect(
      restricted.caller.account.updateProfile({ displayName: 'Amina' }),
    ).rejects.toMatchObject(refused('ACCOUNT_RESTRICTED'));
  });
});

describe('account.setLanguage', () => {
  it('refuses an anonymous caller with UNAUTHENTICATED', async () => {
    await expect(surface.anonymous().account.setLanguage({ language: 'en' })).rejects.toMatchObject(
      refused('UNAUTHENTICATED'),
    );
  });

  it('switches the language, a suspended account included (FR-131)', async () => {
    const { userId, caller } = await signedIn('suspended');
    await caller.account.setLanguage({ language: 'en' });
    expect((await rowsOf(database).user(userId))?.preferredLanguage).toBe('en');
  });
});

describe('account.setTimezone', () => {
  it('refuses an anonymous caller with UNAUTHENTICATED', async () => {
    await expect(
      surface.anonymous().account.setTimezone({ timezone: 'Asia/Riyadh' }),
    ).rejects.toMatchObject(refused('UNAUTHENTICATED'));
  });

  it('keeps the chosen zone, and refuses a restricted account', async () => {
    const { userId, caller } = await signedIn();
    await caller.account.setTimezone({ timezone: 'Asia/Riyadh' });
    await caller.account.reportDeviceTimezone({ timezone: 'Europe/London' });
    expect((await rowsOf(database).user(userId))?.timezone).toBe('Asia/Riyadh');
    const restricted = await signedIn('suspended');
    await expect(
      restricted.caller.account.setTimezone({ timezone: 'Asia/Riyadh' }),
    ).rejects.toMatchObject(refused('ACCOUNT_RESTRICTED'));
  });
});

describe('account.reportDeviceTimezone', () => {
  it('refuses an anonymous caller with UNAUTHENTICATED', async () => {
    await expect(
      surface.anonymous().account.reportDeviceTimezone({ timezone: 'Asia/Riyadh' }),
    ).rejects.toMatchObject(refused('UNAUTHENTICATED'));
  });

  it("follows the device's zone, and refuses a restricted account", async () => {
    const { userId, caller } = await signedIn();
    await caller.account.reportDeviceTimezone({ timezone: 'Asia/Dubai' });
    expect((await rowsOf(database).user(userId))?.timezone).toBe('Asia/Dubai');
    const restricted = await signedIn('suspended');
    await expect(
      restricted.caller.account.reportDeviceTimezone({ timezone: 'Asia/Dubai' }),
    ).rejects.toMatchObject(refused('ACCOUNT_RESTRICTED'));
  });

  // Review of B10, finding 5: a device set to UTC or a fixed offset reports a zone no person lives
  // by; it is refused and the zone kept, so the phone does not send it (B10b, `@ijazah/time/cities`).
  it('refuses a UTC or fixed-offset device zone and keeps the zone the account has', async () => {
    const { userId, caller } = await signedIn();
    for (const timezone of ['UTC', 'Etc/UTC', 'Etc/GMT-2']) {
      await expect(caller.account.reportDeviceTimezone({ timezone })).rejects.toMatchObject(
        refused('VALIDATION_FAILED'),
      );
    }
    expect((await rowsOf(database).user(userId))?.timezone).toBe('Africa/Cairo');
  });
});
