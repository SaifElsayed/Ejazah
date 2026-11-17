// T049 — the `account` namespace as the user surface serves it (app-surface.md "`account` — the
// signed-in person"; FR-131, FR-137).
//
// Every procedure here is the user kind, so each refuses an anonymous caller (the authorization
// gate, T028, R-MOBILE-13, reads these cases by path). `me` and `setLanguage` admit a suspended or
// banned account, which still reads its standing and its language on the restricted screen; the
// profile and the time zone do not. What the service answers is proven by account.service.spec.ts.
// `account.delete` (T082) admits a suspended account too (a restricted person may still leave,
// FR-140) and a banned one (T098: the restricted screen opens the deletion), counts the caller
// on the authentication budget, and takes the typed word in either language and nothing else; what the deletion does is deletion.service.spec.ts's.
//
// B19a's three screen changes add no procedure, so R-MOBILE-13's server tests are the existing ones
// (suite-gate.paths.ts: a screen-only change carries a module spec change too). The time-zone
// picker (T104) calls `account.setTimezone`, whose refusal of the wrong caller is here. The
// welcome screen (T106) reaches `auth.providerNonce` and `auth.signInWithProvider`, public and held
// by the authentication budget, as auth.router.spec.ts proves. The Terms (T105) call no procedure:
// the WebView loads the served `GET /terms`.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import type { DeleteAccountInput } from '@ijazah/contracts';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { unusedIdentityServices } from '../../surfaces/services.fixtures.js';
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

async function signedIn(accountStatus: 'active' | 'suspended' | 'banned' = 'active') {
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

  it('declares account.delete as the user kind, limited on the authentication budget', () => {
    expect(metaOf('account.delete')).toEqual({
      surface: 'app',
      caller: 'user',
      rateLimit: 'rate_limit_authentication',
    });
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

  // 002:T158 (B26): the teacher's profile screen renames through this procedure, so the teacher's
  // own name changes and a suspended teacher is refused, as a student is (R-MOBILE-13).
  it("changes a teacher's own display name, and refuses a suspended teacher", async () => {
    const { userId } = await createAccount(database, { role: 'teacher' });
    const other = await createAccount(database, { role: 'teacher' });
    const { accessToken } = await identity.sessions.issue(userId);
    const caller = await surface.bearing(accessToken);
    await caller.account.updateProfile({ displayName: '  Yusuf  ' });
    expect((await rowsOf(database).user(userId))?.displayName).toBe('Yusuf');
    expect((await rowsOf(database).user(other.userId))?.displayName).not.toBe('Yusuf');
    const suspended = await createAccount(database, {
      role: 'teacher',
      accountStatus: 'suspended',
    });
    const restricted = await surface.bearing(
      (await identity.sessions.issue(suspended.userId)).accessToken,
    );
    await expect(restricted.account.updateProfile({ displayName: 'Yusuf' })).rejects.toMatchObject(
      refused('ACCOUNT_RESTRICTED'),
    );
    expect((await rowsOf(database).user(suspended.userId))?.displayName).not.toBe('Yusuf');
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

describe('account.delete', () => {
  const input = {
    confirmation: 'حذف',
    reauth: { kind: 'password', password: 'a long spec passphrase 41' },
    idempotencyKey: 'spec-delete-key-0001',
  } as const;

  /** A deletion that records whom it was asked to delete and with what. */
  function recordingDeletion() {
    const calls: { readonly userId: string; readonly input: DeleteAccountInput }[] = [];
    return {
      calls,
      deletion: {
        deleteAccount: async (userId: string, given: DeleteAccountInput) => {
          calls.push({ userId, input: given });
        },
        requestWebCode: unusedIdentityServices.deletion.requestWebCode,
        confirmWebDeletion: unusedIdentityServices.deletion.confirmWebDeletion,
        // T081 of specs/004-sessions (rule d): the administrator's deletion, never reached here.
        deleteByAdministrator: unusedIdentityServices.deletion.deleteByAdministrator,
      },
    };
  }

  it('refuses an anonymous caller with UNAUTHENTICATED, counting nothing', async () => {
    await expect(surface.anonymous().account.delete(input)).rejects.toMatchObject(
      refused('UNAUTHENTICATED'),
    );
    expect(surface.counts()).toEqual([]);
  });

  it('admits a suspended account, counts the caller on the authentication budget, and hands the input to the deletion', async () => {
    const recording = recordingDeletion();
    surface = surfaceOf(identity, { deletion: recording.deletion });
    const { userId, caller } = await signedIn('suspended');
    await expect(caller.account.delete(input)).resolves.toBeUndefined();
    expect(recording.calls).toEqual([{ userId, input }]);
    expect(surface.counts()).toEqual([
      ['rate_limit_authentication_budget', '*'],
      ['rate_limit_authentication', userId],
    ]);
  });

  it('admits a banned account and hands the input to the deletion (T098)', async () => {
    const recording = recordingDeletion();
    surface = surfaceOf(identity, { deletion: recording.deletion });
    const { userId, caller } = await signedIn('banned');
    await expect(caller.account.delete(input)).resolves.toBeUndefined();
    expect(recording.calls).toEqual([{ userId, input }]);
  });

  it('takes the typed word in English too, and refuses any other word before the deletion is reached', async () => {
    const recording = recordingDeletion();
    surface = surfaceOf(identity, { deletion: recording.deletion });
    const { caller } = await signedIn();
    await caller.account.delete({ ...input, confirmation: 'DELETE' });
    for (const confirmation of ['delete', 'حذف الحساب', '']) {
      await expect(
        caller.account.delete({ ...input, confirmation } as unknown as DeleteAccountInput),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(recording.calls).toHaveLength(1);
  });

  it('refuses a request without its idempotency key', async () => {
    const recording = recordingDeletion();
    surface = surfaceOf(identity, { deletion: recording.deletion });
    const { caller } = await signedIn();
    const { idempotencyKey: _omitted, ...unkeyed } = input;
    await expect(
      caller.account.delete(unkeyed as unknown as DeleteAccountInput),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(recording.calls).toEqual([]);
  });
});

// T004 of specs/005-certification (FR-602; ADR 0019 D1; app-surface.md, `account.certificateName.set`):
// the student's certificate name, set once. The student kind, so an anonymous caller is
// UNAUTHENTICATED and a teacher FORBIDDEN, neither reaching the service; the input's name and key
// are validated before it; the service's refusal `already_set` reaches the caller as it is. What the
// service does (once, the port on the setter's transaction) is certificate-name.service.spec.ts's.
describe('account.certificateName.set', () => {
  const input = { name: 'مريم بنت أحمد بن علي', idempotencyKey: 'spec-name-key-0001' } as const;

  /** A certificate-name service that records whom it was asked to name, and answers the name. */
  function recordingNames(
    answer: () => Promise<{ name: string }> = async () => ({ name: input.name }),
  ) {
    const calls: unknown[][] = [];
    return {
      calls,
      certificateName: {
        setOwn: async (userId: string, given: unknown) => {
          calls.push([userId, given]);
          return answer();
        },
        setByAdministrator: unusedIdentityServices.certificateName.setByAdministrator,
      },
    };
  }

  it('declares the procedure as the student kind, under the default limit', () => {
    expect(metaOf('account.certificateName.set')).toEqual({ surface: 'app', caller: 'student' });
  });

  it('refuses an anonymous caller with UNAUTHENTICATED, reaching nothing', async () => {
    const recording = recordingNames();
    surface = surfaceOf(identity, { certificateName: recording.certificateName });
    await expect(surface.anonymous().account.certificateName.set(input)).rejects.toMatchObject(
      refused('UNAUTHENTICATED'),
    );
    expect(recording.calls).toEqual([]);
  });

  it('refuses a teacher with FORBIDDEN, reaching nothing', async () => {
    const recording = recordingNames();
    surface = surfaceOf(identity, { certificateName: recording.certificateName });
    const { userId } = await createAccount(database, { role: 'teacher' });
    const { accessToken } = await identity.sessions.issue(userId);
    const teacher = await surface.bearing(accessToken);
    await expect(teacher.account.certificateName.set(input)).rejects.toMatchObject(
      refused('FORBIDDEN'),
    );
    expect(recording.calls).toEqual([]);
  });

  it('hands the student and the input to the service and answers the name it set', async () => {
    const recording = recordingNames();
    surface = surfaceOf(identity, { certificateName: recording.certificateName });
    const { userId, caller } = await signedIn();
    await expect(caller.account.certificateName.set(input)).resolves.toEqual({ name: input.name });
    expect(recording.calls).toEqual([[userId, input]]);
  });

  it('answers the service’s refusal already_set as CONFLICT', async () => {
    const recording = recordingNames(async () => {
      throw new DomainError('CONFLICT', undefined, {
        details: [{ path: 'certificateName', code: 'already_set' }],
      });
    });
    surface = surfaceOf(identity, { certificateName: recording.certificateName });
    const { caller } = await signedIn();
    await expect(caller.account.certificateName.set(input)).rejects.toMatchObject(
      refused('CONFLICT'),
    );
  });

  it.each([
    ['no idempotency key', { name: input.name }],
    ['a blank name', { ...input, name: '   ' }],
    ['a name of one letter', { ...input, name: 'م' }],
  ])('refuses %s before the service is reached', async (_case, given) => {
    const recording = recordingNames();
    surface = surfaceOf(identity, { certificateName: recording.certificateName });
    const { caller } = await signedIn();
    await expect(
      caller.account.certificateName.set(given as unknown as typeof input),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(recording.calls).toEqual([]);
  });
});

// T005 of specs/005-certification (FR-620; R-405; app-surface.md, `account.pushToken.register` and
// `.remove`): the phone's push token on the caller's own account. The user kind under the default
// limit, so an anonymous caller is UNAUTHENTICATED, reaching nothing; a token empty or past its bound,
// or an unknown platform, is refused before the service; neither answer echoes the token. What the
// rows become (by the hash, moved to the caller, another account's never removed) is
// push-tokens.service.spec.ts's. Every token is made up (R-SEC-2).
describe('account.pushToken', () => {
  const token = 'ExponentPushToken[spec-router-0000000001]';

  /** A push-token service that records whom it was asked for, and with what. */
  function recordingTokens() {
    const calls: unknown[][] = [];
    return {
      calls,
      pushTokens: {
        register: async (userId: string, given: unknown) => {
          calls.push(['register', userId, given]);
        },
        remove: async (userId: string, given: unknown) => {
          calls.push(['remove', userId, given]);
        },
      },
    };
  }

  it('declares both procedures as the user kind, under the default limit', () => {
    for (const path of ['account.pushToken.register', 'account.pushToken.remove']) {
      expect(metaOf(path)).toEqual({ surface: 'app', caller: 'user' });
    }
  });

  it('refuses an anonymous caller with UNAUTHENTICATED on register, reaching nothing', async () => {
    const recording = recordingTokens();
    surface = surfaceOf(identity, { pushTokens: recording.pushTokens });
    await expect(
      surface.anonymous().account.pushToken.register({ token, platform: 'android' }),
    ).rejects.toMatchObject(refused('UNAUTHENTICATED'));
    expect(recording.calls).toEqual([]);
  });

  it('refuses an anonymous caller with UNAUTHENTICATED on remove, reaching nothing', async () => {
    const recording = recordingTokens();
    surface = surfaceOf(identity, { pushTokens: recording.pushTokens });
    await expect(surface.anonymous().account.pushToken.remove({ token })).rejects.toMatchObject(
      refused('UNAUTHENTICATED'),
    );
    expect(recording.calls).toEqual([]);
  });

  it('hands the caller and the token to the service, and answers nothing back', async () => {
    const recording = recordingTokens();
    surface = surfaceOf(identity, { pushTokens: recording.pushTokens });
    const { userId, caller } = await signedIn();
    await expect(
      caller.account.pushToken.register({ token, platform: 'ios' }),
    ).resolves.toBeUndefined();
    await expect(caller.account.pushToken.remove({ token })).resolves.toBeUndefined();
    expect(recording.calls).toEqual([
      ['register', userId, { token, platform: 'ios' }],
      ['remove', userId, { token }],
    ]);
  });

  it.each([
    ['an empty token', { token: '', platform: 'android' }],
    ['a token past 4096 characters', { token: 'x'.repeat(4097), platform: 'android' }],
    ['an unknown platform', { token, platform: 'web' }],
    ['no platform', { token }],
  ])('refuses %s on register before the service is reached', async (_case, given) => {
    const recording = recordingTokens();
    surface = surfaceOf(identity, { pushTokens: recording.pushTokens });
    const { caller } = await signedIn();
    await expect(
      caller.account.pushToken.register(given as unknown as { token: string; platform: 'ios' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(recording.calls).toEqual([]);
  });

  it.each([
    ['an empty token', { token: '' }],
    ['a token past 4096 characters', { token: 'x'.repeat(4097) }],
  ])('refuses %s on remove before the service is reached', async (_case, given) => {
    const recording = recordingTokens();
    surface = surfaceOf(identity, { pushTokens: recording.pushTokens });
    const { caller } = await signedIn();
    await expect(caller.account.pushToken.remove(given)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(recording.calls).toEqual([]);
  });
});
