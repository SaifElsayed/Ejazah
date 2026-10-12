// T068: column encryption above the database (FR-031, research R-8, R-DB-8). What must be recovered
// or presented to a third party is stored as one `bytea`: a version byte, a 12-byte IV, a 16-byte
// tag and the ciphertext. Any change to any part, or decryption under another column or key, is
// refused with one labelled error that carries none of the bytes.
//
// T155: the version byte names the key a value was written under, so `ENCRYPTION_KEY` can be
// rotated. A cipher holding the current key and the previous one reads a value written under
// either, always writes under the current one, and turns an old value into a current one.
import { describe, expect, it } from 'vitest';
import {
  COLUMN_KEY_ID_LABEL,
  COLUMN_KEY_LABEL,
  ColumnCipher,
  columnKeyId,
  DecryptionError,
  deriveColumnKey,
  SharedKeyIdError,
} from './encryption.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const THIRD_KEY = Buffer.alloc(32, 11).toString('base64');
const PAYOUT = 'teacher_profiles.payout_account_ref_encrypted';
const MFA = 'admin_users.mfa_secret_encrypted';

const cipher = new ColumnCipher(KEY);

function refused(stored: Uint8Array, column = PAYOUT, by = cipher): DecryptionError {
  let failure: unknown;
  try {
    by.decrypt(stored, column);
  } catch (error: unknown) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(DecryptionError);
  return failure as DecryptionError;
}

/** Another key whose key id is `key`'s. An id is one byte, so a few thousand candidates hold one. */
function keySharingIdWith(key: string): string {
  for (let counter = 1; counter <= 4096; counter += 1) {
    const candidate = Buffer.alloc(32);
    candidate.writeUInt32BE(counter);
    const encoded = candidate.toString('base64');
    if (encoded !== key && columnKeyId(encoded) === columnKeyId(key)) return encoded;
  }
  throw new Error('no key among 4096 shares the id');
}

describe('column encryption (T068, FR-031, R-8)', () => {
  it('decrypts what it encrypted, for the same column', () => {
    const stored = cipher.encrypt('rcp_0123456789', PAYOUT);
    expect(cipher.decrypt(stored, PAYOUT)).toBe('rcp_0123456789');
    expect(cipher.decrypt(cipher.encrypt('', PAYOUT), PAYOUT)).toBe('');
    expect(cipher.decrypt(cipher.encrypt('نص عربي', PAYOUT), PAYOUT)).toBe('نص عربي');
  });

  it('lays out the key id, IV, tag and ciphertext in one value, 29 bytes plus the plaintext', () => {
    const stored = cipher.encrypt('abc', PAYOUT);
    expect(stored).toHaveLength(29 + 3);
    expect(stored[0]).toBe(columnKeyId(KEY));
  });

  it('draws a fresh IV for every write, so equal plaintexts are not equal values', () => {
    const first = cipher.encrypt('same', PAYOUT);
    const second = cipher.encrypt('same', PAYOUT);
    expect(first.equals(second)).toBe(false);
    expect(first.subarray(1, 13).equals(second.subarray(1, 13))).toBe(false);
  });

  it.each([
    ['the version', 0],
    ['the IV', 1],
    ['the tag', 13],
    ['the ciphertext', 29],
  ])('refuses a value whose %s was changed', (_part, offset) => {
    const stored = Buffer.from(cipher.encrypt('rcp_0123456789', PAYOUT));
    stored[offset] = (stored[offset] ?? 0) ^ 0x01;
    refused(stored);
  });

  it('refuses a value moved to another column', () => {
    refused(cipher.encrypt('rcp_0123456789', PAYOUT), MFA);
  });

  it('refuses a value written under another key', () => {
    refused(new ColumnCipher(OTHER_KEY).encrypt('rcp_0123456789', PAYOUT));
  });

  it('refuses a value written under another key that shares its key id', () => {
    refused(new ColumnCipher(keySharingIdWith(KEY)).encrypt('rcp_0123456789', PAYOUT));
  });

  it('refuses a value shorter than version, IV and tag', () => {
    refused(Buffer.alloc(28));
    refused(Buffer.alloc(0));
  });

  it('never carries the plaintext or the stored bytes in its error', () => {
    const stored = Buffer.from(cipher.encrypt('rcp_0123456789', PAYOUT));
    const error = refused(stored, MFA);
    expect(error.message).not.toContain('rcp_0123456789');
    expect(error.message).not.toContain(stored.toString('hex'));
    expect(error.message).not.toContain(stored.toString('base64'));
    expect(error.cause).toBeUndefined();
  });

  it.each(['', 'payout', 'Teacher.Ref', 'a.b.c', 'a.b; DROP'])(
    'refuses the column name %j, which is not table.column',
    (column) => {
      expect(() => cipher.encrypt('x', column)).toThrow(TypeError);
    },
  );

  it('encrypts under a key derived for columns alone, unlike ENCRYPTION_KEY', () => {
    const columnKey = deriveColumnKey(KEY);
    expect(COLUMN_KEY_LABEL).toBe('ijazah:column-encryption:v1');
    expect(columnKey).toHaveLength(32);
    expect(columnKey.equals(Buffer.from(KEY, 'base64'))).toBe(false);
    expect(columnKey.equals(deriveColumnKey(OTHER_KEY))).toBe(false);
  });
});

describe('rotating ENCRYPTION_KEY (T155, FR-031, R-DB-8, R-SEC-10)', () => {
  const rotating = new ColumnCipher(OTHER_KEY, KEY);
  const old = cipher.encrypt('rcp_0123456789', PAYOUT);

  it('names the key in the version byte: one byte derived from the key under its own label', () => {
    expect(COLUMN_KEY_ID_LABEL).toBe('ijazah:column-key-id:v1');
    expect(columnKeyId(KEY)).toBe(columnKeyId(KEY));
    expect(columnKeyId(KEY)).not.toBe(columnKeyId(OTHER_KEY));
    expect(Number.isInteger(columnKeyId(KEY))).toBe(true);
    expect(columnKeyId(KEY)).toBeGreaterThanOrEqual(0);
    expect(columnKeyId(KEY)).toBeLessThan(256);
  });

  it('reads a value written under the previous key and one written under the current key', () => {
    expect(rotating.decrypt(old, PAYOUT)).toBe('rcp_0123456789');
    const current = new ColumnCipher(OTHER_KEY).encrypt('new', PAYOUT);
    expect(rotating.decrypt(current, PAYOUT)).toBe('new');
  });

  it('always writes under the current key, which the previous key cannot read', () => {
    const written = rotating.encrypt('rcp_0123456789', PAYOUT);
    expect(written[0]).toBe(columnKeyId(OTHER_KEY));
    expect(new ColumnCipher(OTHER_KEY).decrypt(written, PAYOUT)).toBe('rcp_0123456789');
    refused(written, PAYOUT, cipher);
  });

  it('turns a value under the previous key into one under the current key, for the same column', () => {
    const turned = rotating.reencrypt(old, PAYOUT) ?? Buffer.alloc(0);
    expect(turned[0]).toBe(columnKeyId(OTHER_KEY));
    expect(new ColumnCipher(OTHER_KEY).decrypt(turned, PAYOUT)).toBe('rcp_0123456789');
    refused(turned, MFA, rotating);
  });

  it('leaves a value already under the current key as it is', () => {
    expect(rotating.reencrypt(rotating.encrypt('current', PAYOUT), PAYOUT)).toBeUndefined();
    expect(cipher.reencrypt(old, PAYOUT)).toBeUndefined();
  });

  it('refuses to turn a value under neither key, or one moved from another column', () => {
    const lost = new ColumnCipher(THIRD_KEY).encrypt('lost', PAYOUT);
    expect(() => rotating.reencrypt(lost, PAYOUT)).toThrow(DecryptionError);
    expect(() => rotating.reencrypt(old, MFA)).toThrow(DecryptionError);
  });

  it('says whether a rotation is running: a previous key is held', () => {
    expect(rotating.rotating).toBe(true);
    expect(cipher.rotating).toBe(false);
  });

  it('refuses a previous key that shares the current key’s id, naming neither value', () => {
    const shared = keySharingIdWith(KEY);
    expect(() => new ColumnCipher(KEY, shared)).toThrow(SharedKeyIdError);
    expect(() => new ColumnCipher(KEY, KEY)).toThrow(SharedKeyIdError);
    let message = '';
    try {
      new ColumnCipher(KEY, shared);
    } catch (error: unknown) {
      message = String(error);
    }
    expect(message).not.toContain(KEY);
    expect(message).not.toContain(shared);
  });
});
