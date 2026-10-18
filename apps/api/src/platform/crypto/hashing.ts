// T069: hashing (research R-9, R-DB-7). What must be verified and never recovered is hashed; what
// must be recovered is T068's.
//
//   a password       Argon2id, salted, in PHC form             verified by recomputing
//   a one-time code  Argon2id, salted and peppered, in PHC form verified by recomputing
//   a lookup token   SHA-256, unsalted, lower-case hex          looked up by the hash (unique column)
//
// Argon2id is `node:crypto`'s own: added in Node 24.7, OpenSSL's implementation, checked in the spec
// against RFC 9106 §5.3 and the reference implementation's vector (R-SEC-7). It returns raw bytes
// only, so the salt, the PHC string and the comparison are made here. The cost is the OWASP Password
// Storage Cheat Sheet's minimum for Argon2id: 19 MiB, two passes, one lane. Only the asynchronous
// call is used, so a hash never blocks the event loop.
//
// The PHC parser reads a stored row and decides how much memory to allocate, so it is strict:
// `argon2id`, `v=19`, decimal costs without leading zeros between a declared floor and ceiling,
// canonical unpadded base64, a salt of 8 to 64 bytes and a hash of 16 to 64. Anything else is a
// `StoredHashError`, which names no part of the value: an altered row must not make the process
// allocate gigabytes. A hash made at another cost still verifies and answers `needsRehash`, so the
// cost can rise without a migration.
//
// A six-digit code holds about 20 bits, so its hash alone would fall to a search within the code's
// lifetime if the table were read. Codes are therefore peppered with a key derived from
// ENCRYPTION_KEY by HKDF under `ijazah:otp-pepper:v1` (listed in encryption.ts), which is not in the
// database. Passwords are not peppered: rotating the key would invalidate every password hash, and
// no task owns a path to rehash them (note under T069).
import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { deriveSubkey, type HkdfLabel } from './encryption.js';

export const OTP_PEPPER_LABEL = 'ijazah:otp-pepper:v1' satisfies HkdfLabel;

/** Today's cost, the OWASP minimum for Argon2id. Memory in KiB. */
export const ARGON2_COST = { memory: 19_456, passes: 2, parallelism: 1 } as const;

const FLOOR = ARGON2_COST;
const CEILING = { memory: 262_144, passes: 10, parallelism: 8 } as const;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

const PHC =
  /^\$argon2id\$v=19\$m=(0|[1-9]\d*),t=(0|[1-9]\d*),p=(0|[1-9]\d*)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** A stored hash this module does not accept. Corrupt data: the request stops, loudly. */
export class StoredHashError extends Error {
  constructor(detail: string) {
    super(`The stored hash is refused: ${detail}.`);
    this.name = 'StoredHashError';
  }
}

export interface Verification {
  readonly valid: boolean;
  /** The hash was made at another cost; store a fresh one now that the secret is known. */
  readonly needsRehash: boolean;
}

interface Parsed {
  readonly memory: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly salt: Buffer;
  readonly tag: Buffer;
}

function canonicalBase64(text: string, minBytes: number, maxBytes: number, part: string): Buffer {
  const bytes = Buffer.from(text, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== text) {
    throw new StoredHashError(`the ${part} is not canonical base64`);
  }
  if (bytes.length < minBytes || bytes.length > maxBytes) {
    throw new StoredHashError(`the ${part} is not ${minBytes} to ${maxBytes} bytes`);
  }
  return bytes;
}

function parse(stored: string): Parsed {
  const match = PHC.exec(stored);
  if (match === null) throw new StoredHashError('not an Argon2id v19 PHC string');
  const [, m = '', t = '', p = '', salt = '', tag = ''] = match;
  const cost = { memory: Number(m), passes: Number(t), parallelism: Number(p) };
  for (const name of ['memory', 'passes', 'parallelism'] as const) {
    if (cost[name] < FLOOR[name] || cost[name] > CEILING[name]) {
      throw new StoredHashError(`its ${name} is outside ${FLOOR[name]} to ${CEILING[name]}`);
    }
  }
  return {
    ...cost,
    salt: canonicalBase64(salt, 8, 64, 'salt'),
    tag: canonicalBase64(tag, 16, 64, 'hash'),
  };
}

function derive(
  secret: string,
  cost: { readonly memory: number; readonly passes: number; readonly parallelism: number },
  salt: Buffer,
  tagLength: number,
  pepper: Buffer | undefined,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(secret, 'utf8'),
        nonce: salt,
        ...cost,
        tagLength,
        ...(pepper === undefined ? {} : { secret: pepper }),
      },
      (error, derived) => (error === null ? resolve(derived) : reject(error)),
    );
  });
}

function unpadded(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}

async function hashWith(secret: string, pepper: Buffer | undefined): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(secret, ARGON2_COST, salt, TAG_BYTES, pepper);
  const { memory, passes, parallelism } = ARGON2_COST;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${unpadded(salt)}$${unpadded(tag)}`;
}

async function verifyWith(
  secret: string,
  stored: string,
  pepper: Buffer | undefined,
): Promise<Verification> {
  const parsed = parse(stored);
  const tag = await derive(secret, parsed, parsed.salt, parsed.tag.length, pepper);
  return {
    valid: timingSafeEqual(tag, parsed.tag),
    needsRehash:
      parsed.memory !== ARGON2_COST.memory ||
      parsed.passes !== ARGON2_COST.passes ||
      parsed.parallelism !== ARGON2_COST.parallelism ||
      parsed.salt.length !== SALT_BYTES ||
      parsed.tag.length !== TAG_BYTES,
  };
}

/** The PHC string to store for `password`. */
export function hashPassword(password: string): Promise<string> {
  return hashWith(password, undefined);
}

/** Whether `password` is the one `stored` was made from; `StoredHashError` for a refused value. */
export function verifyPassword(password: string, stored: string): Promise<Verification> {
  return Promise.resolve().then(() => verifyWith(password, stored, undefined));
}

/** One-time codes, peppered with a key derived from ENCRYPTION_KEY that the database never holds. */
export class OtpHasher {
  readonly #pepper: Buffer;

  constructor(encryptionKey: string) {
    this.#pepper = deriveSubkey(encryptionKey, OTP_PEPPER_LABEL);
  }

  hash(code: string): Promise<string> {
    return hashWith(code, this.#pepper);
  }

  verify(code: string, stored: string): Promise<Verification> {
    return Promise.resolve().then(() => verifyWith(code, stored, this.#pepper));
  }
}

/** The lookup hash of a high-entropy token: SHA-256, unsalted, lower-case hex (R-9). */
export function hashLookupToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
