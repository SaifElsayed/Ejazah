// R1a (002:T173; SRS §3.14 «Failed one-time codes before issuing stops», DEC-100; research R-104):
// after the setting's count of failed codes for one e-mail address and purpose, no code is issued
// for that address and purpose until the limiter's fixed window, opened by the first failed code,
// ends. A capped request does the decoy's work and sends nothing, so its answer is every address's.
// Each failure counts once, whatever made it fail (a wrong code, a code past `otp_max_attempts`);
// issuing never counts, and a right code resets nothing. The cap's one record per window names the
// purpose and the subject's digest only. The limiter is the real one over a counter on the spec's
// clock; the codes are the real ones over the real database.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, describe, expect, it, vi } from 'vitest';

import { OtpHasher } from '../../platform/crypto/hashing.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import {
  buildIdentity,
  codeMailedTo,
  type Identity,
  openSpecDatabase,
  rowsOf,
  SEEDED_SETTINGS,
  settingsOf,
  SPEC_ENCRYPTION_KEY,
  SpecEmail,
  uniqueEmail,
} from './__fixtures__/identity.js';
import type { CodeMailPurpose } from './mail/code-mail.js';
import { OneTimeCodes, UNBOUND_FAILED_CODE_CAP } from './one-time-codes.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

const CAP = 'rate_limit_failed_one_time_code';
const PURPOSES: readonly CodeMailPurpose[] = ['signup', 'password_reset', 'account_deletion'];
/** Never a six-digit code, so it never verifies. */
const WRONG = 'not-a-code';
const DAY = 86_400;

function capped(limit: number, windowSeconds = DAY) {
  return buildIdentity(database, {
    settings: { [CAP]: { limit, window_seconds: windowSeconds } },
  });
}

const mailsTo = (identity: Identity, address: string) =>
  identity.mails().filter((mail) => mail.to === address).length;

async function fail(
  identity: Identity,
  address: string,
  purpose: CodeMailPurpose,
  times: number,
): Promise<void> {
  for (let attempt = 0; attempt < times; attempt += 1) {
    await expect(identity.codes.verify(address, purpose, WRONG)).rejects.toMatchObject({
      code: 'CODE_INVALID',
    });
  }
}

/** Whether a request for `address` and `purpose` mailed a code: the answer is the same either way. */
async function issued(
  identity: Identity,
  address: string,
  purpose: CodeMailPurpose = 'password_reset',
): Promise<boolean> {
  const before = mailsTo(identity, address);
  await expect(identity.codes.send(address, purpose)).resolves.toBeUndefined();
  return mailsTo(identity, address) === before + 1;
}

describe('failed one-time codes are capped per e-mail address and purpose (T173)', () => {
  it('issues no code once the seeded 10 failures are counted, and until then issues every one', async () => {
    expect(SEEDED_SETTINGS[CAP]).toEqual({ limit: 10, window_seconds: DAY });
    const identity = buildIdentity(database);
    const address = uniqueEmail();
    expect(await issued(identity, address)).toBe(true);
    await fail(identity, address, 'password_reset', 9);
    expect(await issued(identity, address)).toBe(true);
    await fail(identity, address, 'password_reset', 1);
    const rowsBefore = await rowsOf(database).codes(address);
    expect(await issued(identity, address)).toBe(false);
    expect(await issued(identity, address)).toBe(false);
    // Nothing written either: the last code issued is still the newest row.
    await expect(rowsOf(database).codes(address)).resolves.toEqual(rowsBefore);
  });

  it('reads the count from the setting, never from a constant', async () => {
    const identity = capped(3);
    const address = uniqueEmail();
    await fail(identity, address, 'password_reset', 2);
    expect(await issued(identity, address)).toBe(true);
    await fail(identity, address, 'password_reset', 1);
    expect(await issued(identity, address)).toBe(false);
  });

  it('caps each of the three purposes', async () => {
    const identity = capped(2);
    for (const purpose of PURPOSES) {
      const address = uniqueEmail();
      await fail(identity, address, purpose, 2);
      expect(await issued(identity, address, purpose), purpose).toBe(false);
    }
  });

  it('leaves another purpose of the address, and another address, their code', async () => {
    const identity = capped(2);
    const address = uniqueEmail();
    const other = uniqueEmail();
    await fail(identity, address, 'password_reset', 2);
    expect(await issued(identity, address, 'password_reset')).toBe(false);
    expect(await issued(identity, address, 'signup')).toBe(true);
    expect(await issued(identity, address, 'account_deletion')).toBe(true);
    expect(await issued(identity, other, 'password_reset')).toBe(true);
  });

  it('counts the address as stored: its case and its spaces make no other subject', async () => {
    const identity = capped(2);
    const address = uniqueEmail();
    await fail(identity, ` ${address.toUpperCase()} `, 'signup', 1);
    await fail(identity, address, 'signup', 1);
    expect(await issued(identity, address, 'signup')).toBe(false);
  });

  it('answers a capped address as any other: the same result, no error, the decoy’s one hash', async () => {
    const real = new OtpHasher(SPEC_ENCRYPTION_KEY);
    const codeHasher = {
      hash: vi.fn((code: string) => real.hash(code)),
      verify: vi.fn((code: string, stored: string) => real.verify(code, stored)),
    };
    const identity = buildIdentity(database, {
      codeHasher,
      settings: { [CAP]: { limit: 1, window_seconds: DAY } },
    });
    const cappedAddress = uniqueEmail();
    await fail(identity, cappedAddress, 'account_deletion', 1);
    for (const address of [cappedAddress, uniqueEmail()]) {
      codeHasher.hash.mockClear();
      await expect(identity.codes.send(address, 'account_deletion')).resolves.toBeUndefined();
      expect(codeHasher.hash, address).toHaveBeenCalledTimes(1);
    }
    expect(mailsTo(identity, cappedAddress)).toBe(0);
  });

  it('never counts an issued code: twelve requests without a failure are all mailed', async () => {
    const identity = buildIdentity(database);
    const address = uniqueEmail();
    for (let request = 0; request < 12; request += 1) {
      expect(await issued(identity, address), `request ${String(request + 1)}`).toBe(true);
    }
  });

  it('counts each failure once, a code past `otp_max_attempts` included', async () => {
    const identity = capped(7);
    const address = uniqueEmail();
    await identity.codes.send(address, 'signup');
    const code = codeMailedTo(identity.mails(), address);
    // Five wrong tries spend the code (`otp_max_attempts`); the right one is then refused too.
    await fail(identity, address, 'signup', 5);
    await expect(identity.codes.verify(address, 'signup', code)).rejects.toMatchObject({
      code: 'CODE_INVALID',
    });
    expect(await issued(identity, address, 'signup')).toBe(true);
    await fail(identity, address, 'signup', 1);
    expect(await issued(identity, address, 'signup')).toBe(false);
  });

  it('is not reset by a right code', async () => {
    const identity = capped(3);
    const address = uniqueEmail();
    await fail(identity, address, 'signup', 2);
    expect(await issued(identity, address, 'signup')).toBe(true);
    await identity.codes.verify(address, 'signup', codeMailedTo(identity.mails(), address));
    await fail(identity, address, 'signup', 1);
    expect(await issued(identity, address, 'signup')).toBe(false);
  });

  it('lasts the fixed window the first failed code opened, then issues again', async () => {
    const identity = capped(2, DAY);
    const address = uniqueEmail();
    await fail(identity, address, 'password_reset', 1);
    identity.clock.advance(DAY / 2);
    await fail(identity, address, 'password_reset', 1);
    expect(await issued(identity, address)).toBe(false);
    identity.clock.advance(DAY / 2 - 1);
    expect(await issued(identity, address)).toBe(false);
    identity.clock.advance(1);
    expect(await issued(identity, address)).toBe(true);
  });

  it('logs once per window, by the purpose and the subject’s digest only', async () => {
    const identity = capped(2, DAY);
    const address = uniqueEmail();
    await fail(identity, address, 'account_deletion', 4);
    await issued(identity, address, 'account_deletion');
    expect(identity.warnings).toHaveLength(1);
    const [entry] = identity.warnings as Array<Record<string, unknown>>;
    expect(Object.keys(entry ?? {}).sort()).toEqual(['purpose', 'subjectDigest']);
    expect(entry).toMatchObject({
      purpose: 'account_deletion',
      subjectDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(identity.warnings)).not.toContain(address);
    expect(JSON.stringify(identity.warnings)).not.toContain(WRONG);
    identity.clock.advance(DAY);
    await fail(identity, address, 'account_deletion', 2);
    expect(identity.warnings).toHaveLength(2);
    expect(identity.warnings[1]).toEqual(entry);
  });

  it('fails closed with no limiter bound: no code issued, and a failed code is no CODE_INVALID', async () => {
    const email = new SpecEmail();
    const unbound = new OneTimeCodes({
      database,
      settings: settingsOf(SEEDED_SETTINGS),
      encryptionKey: SPEC_ENCRYPTION_KEY,
      email,
      log: { warn: () => undefined },
      failedCodes: UNBOUND_FAILED_CODE_CAP,
    });
    const address = uniqueEmail();
    await expect(unbound.send(address, 'signup')).rejects.toThrow(/No limiter is bound/);
    await expect(unbound.verify(address, 'signup', WRONG)).rejects.toThrow(/No limiter is bound/);
    expect(email.mails).toEqual([]);
    await expect(rowsOf(database).codes(address)).resolves.toEqual([]);
  });
});
