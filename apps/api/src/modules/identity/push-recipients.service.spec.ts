// T005 of specs/005-certification/tasks.md (B45, lane E2) — identity's `PushRecipients`, the store
// `deliver-notification` declares (`apps/api/src/jobs/deliver-notification.ts`, the review session's
// answer Q-E1-1 (b)) and `worker.ts` binds (FR-620, FR-621; R-405, R-406).
//
// - `targetsOf` gives the user's tokens decrypted, each with its platform, and the user's
//   `preferred_language`; nothing (null) for a deleted user.
// - `removeStale` deletes the user's rows of the named tokens, matched by `token_hash`, and nothing
//   else: the user's other tokens and another account's rows stay.
//
// Over the real table, the tokens written through `account.pushToken.register`'s service. Every
// token is made up (R-SEC-2).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { createColumnCipher } from '../../platform/crypto/encryption.js';
import { hashLookupToken } from '../../platform/crypto/hashing.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import {
  buildIdentity,
  createAccount,
  openSpecDatabase,
  rowsOf,
  SPEC_ENCRYPTION_KEY,
} from './__fixtures__/identity.js';
import { PushRecipientsService } from './push-recipients.service.js';
import { DeviceTokensRepository } from './push-tokens.repository.js';
import { PushTokenService } from './push-tokens.service.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

const cipher = createColumnCipher({ ENCRYPTION_KEY: SPEC_ENCRYPTION_KEY });
const devices = new DeviceTokensRepository(database);
const tokens = new PushTokenService({
  devices,
  cipher,
  now: () => new Date('2026-11-17T09:00:00Z'),
});
const recipients = new PushRecipientsService({ devices, cipher });

/** A made-up token of Expo's shape, unique to the case. */
const madeUpToken = (): string => `ExponentPushToken[spec-${randomUUID()}]`;

const hashesOf = async (userId: string): Promise<string[]> =>
  (await rowsOf(database).pushTokens(userId)).map((row) => row.tokenHash).sort();

describe('PushRecipients.targetsOf', () => {
  it("gives the user's tokens decrypted, each with its platform, and the user's language", async () => {
    const { userId } = await createAccount(database);
    await buildIdentity(database).account.setLanguage(userId, 'en');
    const [phone, tablet] = [madeUpToken(), madeUpToken()];
    await tokens.register(userId, { token: phone, platform: 'android' });
    await tokens.register(userId, { token: tablet, platform: 'ios' });

    const recipient = await recipients.targetsOf(userId);

    expect(recipient?.language).toBe('en');
    expect(
      [...(recipient?.targets ?? [])].sort((a, b) => a.platform.localeCompare(b.platform)),
    ).toEqual([
      { token: phone, platform: 'android' },
      { token: tablet, platform: 'ios' },
    ]);
  });

  it('gives a live user with no device no target, in the user’s language', async () => {
    const { userId } = await createAccount(database);
    await expect(recipients.targetsOf(userId)).resolves.toEqual({ language: 'ar', targets: [] });
  });

  it('gives nothing for a deleted user', async () => {
    const { userId } = await createAccount(database);
    await tokens.register(userId, { token: madeUpToken(), platform: 'android' });
    await rowsOf(database).softDelete(userId);

    await expect(recipients.targetsOf(userId)).resolves.toBeNull();
  });
});

describe('PushRecipients.removeStale', () => {
  it("deletes only the named tokens' rows of the user", async () => {
    const user = await createAccount(database);
    const other = await createAccount(database);
    const [stale, kept, alsoStale, othersToken] = [
      madeUpToken(),
      madeUpToken(),
      madeUpToken(),
      madeUpToken(),
    ];
    for (const token of [stale, kept, alsoStale]) {
      await tokens.register(user.userId, { token, platform: 'android' });
    }
    await tokens.register(other.userId, { token: othersToken, platform: 'ios' });

    // Another account's token named under the user is not the user's row.
    await recipients.removeStale(user.userId, [stale, alsoStale, othersToken]);

    expect(await hashesOf(user.userId)).toEqual([hashLookupToken(kept)]);
    expect(await hashesOf(other.userId)).toEqual([hashLookupToken(othersToken)]);
  });

  it('deletes nothing when no token is named', async () => {
    const { userId } = await createAccount(database);
    const token = madeUpToken();
    await tokens.register(userId, { token, platform: 'android' });

    await recipients.removeStale(userId, []);

    expect(await hashesOf(userId)).toEqual([hashLookupToken(token)]);
  });
});
