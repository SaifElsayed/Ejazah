// T069: hashing (research R-9, R-DB-7). A password or a one-time code is verified, never recovered,
// so it is stored as an Argon2id hash in PHC form; a lookup token is a high-entropy random value,
// so it is stored as an unsalted SHA-256 and looked up by it.
//
// Argon2id is `node:crypto`'s own (Node 24.7 and later, OpenSSL's implementation; R-SEC-7). It is
// checked here against RFC 9106 §5.3 and against the reference implementation's PHC vector, and the
// PHC parser, the one part written here, is held strict: it reads a stored row and chooses the
// memory to allocate.
import { argon2 } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ARGON2_COST,
  hashLookupToken,
  hashPassword,
  OTP_PEPPER_LABEL,
  OtpHasher,
  StoredHashError,
  verifyPassword,
} from './hashing.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

// The argon2 reference implementation's test vector: "password", salt "somesalt", t=2, m=2^16, p=1.
const REFERENCE =
  '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc';

const CURRENT = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;

describe('Argon2id itself (T069, RFC 9106)', () => {
  it('matches the test vector of RFC 9106 §5.3', async () => {
    const tag = await new Promise<Buffer>((resolve, reject) => {
      argon2(
        'argon2id',
        {
          message: Buffer.alloc(32, 1),
          nonce: Buffer.alloc(16, 2),
          secret: Buffer.alloc(8, 3),
          associatedData: Buffer.alloc(12, 4),
          memory: 32,
          passes: 3,
          parallelism: 4,
          tagLength: 32,
        },
        (error, derived) => (error === null ? resolve(derived) : reject(error)),
      );
    });
    expect(tag.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });
});

describe('password hashing (T069, R-DB-7, R-9)', () => {
  it('stores Argon2id at the OWASP minimum, 19 MiB, two passes, one lane, in PHC form', async () => {
    expect(ARGON2_COST).toEqual({ memory: 19_456, passes: 2, parallelism: 1 });
    expect(await hashPassword('correct horse')).toMatch(CURRENT);
  });

  it('salts every hash, so one password never gives one value twice', async () => {
    expect(await hashPassword('correct horse')).not.toBe(await hashPassword('correct horse'));
  });

  it('verifies the password it hashed, and no other', async () => {
    const stored = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', stored)).toEqual({
      valid: true,
      needsRehash: false,
    });
    expect(await verifyPassword('correct horsE', stored)).toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("verifies the reference implementation's hash, and asks for a rehash at today's cost", async () => {
    expect(await verifyPassword('password', REFERENCE)).toEqual({ valid: true, needsRehash: true });
    expect(await verifyPassword('passwore', REFERENCE)).toEqual({
      valid: false,
      needsRehash: true,
    });
  });

  it.each([
    ['another variant', REFERENCE.replace('argon2id', 'argon2i')],
    ['another version', REFERENCE.replace('v=19', 'v=16')],
    ['padding', `${REFERENCE}=`],
    ['memory below the floor', REFERENCE.replace('m=65536', 'm=4096')],
    ['memory above the ceiling', REFERENCE.replace('m=65536', 'm=4194304')],
    ['one pass', REFERENCE.replace('t=2', 't=1')],
    ['passes above the ceiling', REFERENCE.replace('t=2', 't=11')],
    ['no lanes', REFERENCE.replace('p=1', 'p=0')],
    ['a leading zero', REFERENCE.replace('t=2', 't=02')],
    ['a salt under 8 bytes', REFERENCE.replace('c29tZXNhbHQ', 'c29tZQ')],
    ['a hash under 16 bytes', REFERENCE.replace(/\$[^$]+$/, '$CTFhFdXPJO1aFaMaO6Mm')],
    ['a non-canonical salt', REFERENCE.replace('c29tZXNhbHQ', 'c29tZXNhbHR')],
    ['text that is not PHC', 'not a hash'],
    ['an empty value', ''],
  ])('refuses a stored hash with %s, naming no part of it', async (_case, stored) => {
    const failure = await verifyPassword('password', stored).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StoredHashError);
    if (stored !== '') expect((failure as Error).message).not.toContain(stored);
  });
});

describe('one-time code hashing (T069, R-DB-7)', () => {
  const otp = new OtpHasher(KEY);

  it('stores a code as Argon2id, peppered with a key derived for codes alone', async () => {
    expect(OTP_PEPPER_LABEL).toBe('ijazah:otp-pepper:v1');
    const stored = await otp.hash('482913');
    expect(stored).toMatch(CURRENT);
    expect(await otp.verify('482913', stored)).toEqual({ valid: true, needsRehash: false });
    expect(await otp.verify('482914', stored)).toEqual({ valid: false, needsRehash: false });
  });

  it('a stored code does not verify without the pepper, or under another key', async () => {
    const stored = await otp.hash('482913');
    expect((await verifyPassword('482913', stored)).valid).toBe(false);
    expect((await new OtpHasher(OTHER_KEY).verify('482913', stored)).valid).toBe(false);
  });

  it('a password is never peppered, so rotating ENCRYPTION_KEY leaves passwords valid', async () => {
    const stored = await hashPassword('482913');
    expect((await otp.verify('482913', stored)).valid).toBe(false);
    expect((await verifyPassword('482913', stored)).valid).toBe(true);
  });
});

describe('lookup tokens (T069, R-9)', () => {
  it('are hashed with unsalted SHA-256, in lower-case hex', () => {
    expect(hashLookupToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashLookupToken('abc')).toBe(hashLookupToken('abc'));
    expect(hashLookupToken('abd')).not.toBe(hashLookupToken('abc'));
  });
});
