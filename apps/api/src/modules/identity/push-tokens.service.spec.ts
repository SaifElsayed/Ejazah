// T005 of specs/005-certification/tasks.md (B45, lane E2) — the phone's push token (FR-620; R-405;
// app-surface.md, `account.pushToken.register` and `.remove`; ERD §2, `device_push_tokens`).
//
// - Register stores one row per token, found by its hash's unique (`token_hash`): the token
//   encrypted bound to its row (R-DB-8), never in the clear; the platform and `last_seen_at`. A
//   token registered again keeps its one row; a token another account held moves to the caller.
// - Remove deletes the caller's own row of that token, and answers the same whether or not one
//   existed; another account's row is never touched.
//
// Over the real table: the hash's unique and the user filter are the database's to prove. Every
// token is made up (R-SEC-2).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { createColumnCipher } from '../../platform/crypto/encryption.js';
import { hashLookupToken } from '../../platform/crypto/hashing.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import {
  createAccount,
  openSpecDatabase,
  rowsOf,
  SPEC_ENCRYPTION_KEY,
} from './__fixtures__/identity.js';
import { DeviceTokensRepository } from './push-tokens.repository.js';
import { PUSH_TOKEN_COLUMN, PushTokenService } from './push-tokens.service.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

const cipher = createColumnCipher({ ENCRYPTION_KEY: SPEC_ENCRYPTION_KEY });
const NOW = new Date('2026-11-17T09:00:00Z');
const LATER = new Date('2026-11-17T10:00:00Z');

function tokens(now: () => Date = () => NOW): PushTokenService {
  return new PushTokenService({ devices: new DeviceTokensRepository(database), cipher, now });
}

/** A made-up token of Expo's shape, unique to the case. */
const madeUpToken = (): string => `ExponentPushToken[spec-${randomUUID()}]`;

const rowsOfUser = (userId: string) => rowsOf(database).pushTokens(userId);

describe('account.pushToken.register', () => {
  it('stores the token encrypted under its row and its hash, with the platform and last_seen_at', async () => {
    const { userId } = await createAccount(database);
    const token = madeUpToken();

    await expect(
      tokens().register(userId, { token, platform: 'android' }),
    ).resolves.toBeUndefined();

    const rows = await rowsOfUser(userId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.tokenHash).toBe(hashLookupToken(token));
    expect(row?.platform).toBe('android');
    expect(row?.lastSeenAt).toEqual(NOW);
    expect(Buffer.from(row?.tokenEncrypted ?? []).includes(token)).toBe(false);
    expect(
      cipher.decrypt(row?.tokenEncrypted ?? new Uint8Array(), PUSH_TOKEN_COLUMN, row?.id ?? ''),
    ).toBe(token);
  });

  it('keeps one row for a token registered again, its platform and last_seen_at moved', async () => {
    const { userId } = await createAccount(database);
    const token = madeUpToken();

    await tokens().register(userId, { token, platform: 'android' });
    const [first] = await rowsOfUser(userId);
    await tokens(() => LATER).register(userId, { token, platform: 'ios' });

    const rows = await rowsOfUser(userId);
    expect(rows.map(({ id, platform, lastSeenAt }) => ({ id, platform, lastSeenAt }))).toEqual([
      { id: first?.id, platform: 'ios', lastSeenAt: LATER },
    ]);
  });

  it('leaves one row for two registrations of one token at once', async () => {
    const { userId } = await createAccount(database);
    const token = madeUpToken();

    await expect(
      Promise.all([
        tokens().register(userId, { token, platform: 'android' }),
        tokens().register(userId, { token, platform: 'android' }),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    expect((await rowsOfUser(userId)).map((row) => row.tokenHash)).toEqual([
      hashLookupToken(token),
    ]);
  });

  it('moves a token another account held to the caller, one row still', async () => {
    const before = await createAccount(database);
    const caller = await createAccount(database);
    const token = madeUpToken();

    await tokens().register(before.userId, { token, platform: 'android' });
    await tokens(() => LATER).register(caller.userId, { token, platform: 'android' });

    expect(await rowsOfUser(before.userId)).toEqual([]);
    const rows = await rowsOfUser(caller.userId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.lastSeenAt).toEqual(LATER);
    expect(
      cipher.decrypt(row?.tokenEncrypted ?? new Uint8Array(), PUSH_TOKEN_COLUMN, row?.id ?? ''),
    ).toBe(token);
  });
});

describe('account.pushToken.remove', () => {
  it("deletes the caller's own row of the token, leaving the caller's others", async () => {
    const { userId } = await createAccount(database);
    const [token, kept] = [madeUpToken(), madeUpToken()];
    await tokens().register(userId, { token, platform: 'android' });
    await tokens().register(userId, { token: kept, platform: 'ios' });

    await expect(tokens().remove(userId, { token })).resolves.toBeUndefined();

    expect((await rowsOfUser(userId)).map((row) => row.tokenHash)).toEqual([hashLookupToken(kept)]);
  });

  it("removes nothing of another account's token, and answers the same", async () => {
    const owner = await createAccount(database);
    const caller = await createAccount(database);
    const token = madeUpToken();
    await tokens().register(owner.userId, { token, platform: 'android' });

    await expect(tokens().remove(caller.userId, { token })).resolves.toBeUndefined();

    expect((await rowsOfUser(owner.userId)).map((row) => row.tokenHash)).toEqual([
      hashLookupToken(token),
    ]);
  });

  it('answers the same for a token never registered', async () => {
    const { userId } = await createAccount(database);
    await expect(tokens().remove(userId, { token: madeUpToken() })).resolves.toBeUndefined();
    expect(await rowsOfUser(userId)).toEqual([]);
  });
});
