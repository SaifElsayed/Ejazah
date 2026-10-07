// T068: column encryption above the database (FR-031, research R-8, R-DB-8). What must be recovered
// or presented to a third party is stored as one `bytea`: a version byte, a 12-byte IV, a 16-byte
// tag and the ciphertext. Any change to any part, or decryption under another column or key, is
// refused with one labelled error that carries none of the bytes.
import { describe, expect, it } from 'vitest';
import { COLUMN_KEY_LABEL, ColumnCipher, DecryptionError, deriveColumnKey } from './encryption.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
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

describe('column encryption (T068, FR-031, R-8)', () => {
  it('decrypts what it encrypted, for the same column', () => {
    const stored = cipher.encrypt('rcp_0123456789', PAYOUT);
    expect(cipher.decrypt(stored, PAYOUT)).toBe('rcp_0123456789');
    expect(cipher.decrypt(cipher.encrypt('', PAYOUT), PAYOUT)).toBe('');
    expect(cipher.decrypt(cipher.encrypt('نص عربي', PAYOUT), PAYOUT)).toBe('نص عربي');
  });

  it('lays out version, IV, tag and ciphertext in one value, 29 bytes plus the plaintext', () => {
    const stored = cipher.encrypt('abc', PAYOUT);
    expect(stored).toHaveLength(29 + 3);
    expect(stored[0]).toBe(1);
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
