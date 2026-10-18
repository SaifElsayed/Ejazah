// T068: column encryption above the database (FR-031, research R-8, R-DB-8). What must be recovered
// or presented to a third party is stored as one `bytea`: a version byte, a 12-byte IV, a 16-byte
// tag and the ciphertext. Any change to any part, or decryption under another column, another row
// or another key, is refused with one labelled error that carries none of the bytes.
//
// T155: the version byte names the key a value was written under, so `ENCRYPTION_KEY` can be
// rotated. A cipher holding the current key and the previous one reads a value written under
// either, always writes under the current one, and turns an old value into a current one.
//
// T172 (review finding SEC-6): the associated data binds a value to its row as well as its column,
// so two teachers' payout references swapped between their rows no longer decrypt.
import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_LABEL,
  ADMIN_INVITE_LABEL,
  COLUMN_KEY_ID_LABEL,
  COLUMN_KEY_LABEL,
  ColumnCipher,
  columnKeyId,
  createColumnCipher,
  DecryptionError,
  deriveColumnKey,
  deriveSubkey,
  HKDF_LABELS,
  ONBOARDING_TOKEN_LABEL,
  SharedKeyIdError,
  SUBKEY_BYTES,
} from './encryption.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const THIRD_KEY = Buffer.alloc(32, 11).toString('base64');
const PAYOUT = 'teacher_profiles.payout_account_ref_encrypted';
const MFA = 'admin_users.mfa_secret_encrypted';
const ROW = '0199c1a0-0000-7000-8000-000000000001';
const OTHER_ROW = '0199c1a0-0000-7000-8000-000000000002';

const cipher = new ColumnCipher(KEY);

function refused(stored: Uint8Array, column = PAYOUT, by = cipher, rowId = ROW): DecryptionError {
  let failure: unknown;
  try {
    by.decrypt(stored, column, rowId);
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
  it('decrypts what it encrypted, for the same column and row', () => {
    const stored = cipher.encrypt('rcp_0123456789', PAYOUT, ROW);
    expect(cipher.decrypt(stored, PAYOUT, ROW)).toBe('rcp_0123456789');
    expect(cipher.decrypt(cipher.encrypt('', PAYOUT, ROW), PAYOUT, ROW)).toBe('');
    expect(cipher.decrypt(cipher.encrypt('نص عربي', PAYOUT, ROW), PAYOUT, ROW)).toBe('نص عربي');
  });

  it('lays out the key id, IV, tag and ciphertext in one value, 29 bytes plus the plaintext', () => {
    const stored = cipher.encrypt('abc', PAYOUT, ROW);
    expect(stored).toHaveLength(29 + 3);
    expect(stored[0]).toBe(columnKeyId(KEY));
  });

  it('draws a fresh IV for every write, so equal plaintexts are not equal values', () => {
    const first = cipher.encrypt('same', PAYOUT, ROW);
    const second = cipher.encrypt('same', PAYOUT, ROW);
    expect(first.equals(second)).toBe(false);
    expect(first.subarray(1, 13).equals(second.subarray(1, 13))).toBe(false);
  });

  it.each([
    ['the version', 0],
    ['the IV', 1],
    ['the tag', 13],
    ['the ciphertext', 29],
  ])('refuses a value whose %s was changed', (_part, offset) => {
    const stored = Buffer.from(cipher.encrypt('rcp_0123456789', PAYOUT, ROW));
    stored[offset] = (stored[offset] ?? 0) ^ 0x01;
    refused(stored);
  });

  it('refuses a value moved to another column', () => {
    refused(cipher.encrypt('rcp_0123456789', PAYOUT, ROW), MFA);
  });

  // T172: the binding is to the column AND the row.
  it('refuses a value moved to another row of the same column', () => {
    const stored = cipher.encrypt('rcp_0123456789', PAYOUT, ROW);
    refused(stored, PAYOUT, cipher, OTHER_ROW);
    expect(cipher.decrypt(stored, PAYOUT, ROW)).toBe('rcp_0123456789');
  });

  it('refuses two values swapped between two rows', () => {
    const first = cipher.encrypt('rcp_first', PAYOUT, ROW);
    const second = cipher.encrypt('rcp_second', PAYOUT, OTHER_ROW);
    refused(first, PAYOUT, cipher, OTHER_ROW);
    refused(second, PAYOUT, cipher, ROW);
  });

  it('refuses a value written under another key', () => {
    refused(new ColumnCipher(OTHER_KEY).encrypt('rcp_0123456789', PAYOUT, ROW));
  });

  it('refuses a value written under another key that shares its key id', () => {
    refused(new ColumnCipher(keySharingIdWith(KEY)).encrypt('rcp_0123456789', PAYOUT, ROW));
  });

  it('refuses a value shorter than version, IV and tag', () => {
    refused(Buffer.alloc(28));
    refused(Buffer.alloc(0));
  });

  it('never carries the plaintext, the stored bytes or the row in its error', () => {
    const stored = Buffer.from(cipher.encrypt('rcp_0123456789', PAYOUT, ROW));
    const error = refused(stored, MFA);
    expect(error.message).not.toContain('rcp_0123456789');
    expect(error.message).not.toContain(stored.toString('hex'));
    expect(error.message).not.toContain(stored.toString('base64'));
    expect(error.message).not.toContain(ROW);
    expect(error.cause).toBeUndefined();
  });

  it.each(['', 'payout', 'Teacher.Ref', 'a.b.c', 'a.b; DROP'])(
    'refuses the column name %j, which is not table.column',
    (column) => {
      expect(() => cipher.encrypt('x', column, ROW)).toThrow(TypeError);
    },
  );

  it('refuses an empty row id, on write and on read', () => {
    expect(() => cipher.encrypt('x', PAYOUT, '')).toThrow(TypeError);
    const stored = cipher.encrypt('x', PAYOUT, ROW);
    expect(() => cipher.decrypt(stored, PAYOUT, '')).toThrow(TypeError);
  });

  it('encrypts under a key derived for columns alone, unlike ENCRYPTION_KEY', () => {
    const columnKey = deriveColumnKey(KEY);
    expect(COLUMN_KEY_LABEL).toBe('ijazah:column-encryption:v1');
    expect(columnKey).toHaveLength(32);
    expect(columnKey.equals(Buffer.from(KEY, 'base64'))).toBe(false);
    expect(columnKey.equals(deriveColumnKey(OTHER_KEY))).toBe(false);
  });
});

// T005 (Phase 1; specs/002-identity/data-model.md §7): every label derived from ENCRYPTION_KEY is
// registered once, the three Phase 1 labels among them, and every caller derives through one
// function whose label type is the registry.
describe('the HKDF label registry and deriveSubkey (T005)', () => {
  it('registers every label once, the three Phase 1 labels among them', () => {
    expect(new Set(HKDF_LABELS).size).toBe(HKDF_LABELS.length);
    expect(HKDF_LABELS).toContain(ACCESS_TOKEN_LABEL);
    expect(HKDF_LABELS).toContain(ONBOARDING_TOKEN_LABEL);
    expect(HKDF_LABELS).toContain(ADMIN_INVITE_LABEL);
    expect(ACCESS_TOKEN_LABEL).toBe('ijazah:access-token:v1');
    expect(ONBOARDING_TOKEN_LABEL).toBe('ijazah:onboarding-token:v1');
    expect(ADMIN_INVITE_LABEL).toBe('ijazah:admin-invite:v1');
    for (const label of HKDF_LABELS) expect(label).toMatch(/^ijazah:[a-z-]+:v1$/);
  });

  it('derives a different key under every label, none of them the key itself', () => {
    const keys = HKDF_LABELS.map((label) => deriveSubkey(KEY, label));
    for (const [index, derived] of keys.entries()) {
      expect(derived).toHaveLength(SUBKEY_BYTES);
      expect(derived.equals(Buffer.from(KEY, 'base64'))).toBe(false);
      for (const other of keys.slice(index + 1)) expect(derived.equals(other)).toBe(false);
    }
  });

  it('is deterministic for one key and label, and differs between keys', () => {
    expect(
      deriveSubkey(KEY, ACCESS_TOKEN_LABEL).equals(deriveSubkey(KEY, ACCESS_TOKEN_LABEL)),
    ).toBe(true);
    expect(
      deriveSubkey(KEY, ACCESS_TOKEN_LABEL).equals(deriveSubkey(OTHER_KEY, ACCESS_TOKEN_LABEL)),
    ).toBe(false);
  });

  it('is the derivation the column key and the key id already use, at their lengths', () => {
    expect(deriveSubkey(KEY, COLUMN_KEY_LABEL).equals(deriveColumnKey(KEY))).toBe(true);
    expect(deriveSubkey(KEY, COLUMN_KEY_ID_LABEL, 1).readUInt8(0)).toBe(columnKeyId(KEY));
    expect(deriveSubkey(KEY, ADMIN_INVITE_LABEL, 16)).toHaveLength(16);
  });
});

describe('rotating ENCRYPTION_KEY (T155, FR-031, R-DB-8, R-SEC-10)', () => {
  const rotating = new ColumnCipher(OTHER_KEY, KEY);
  const old = cipher.encrypt('rcp_0123456789', PAYOUT, ROW);

  it('names the key in the version byte: one byte derived from the key under its own label', () => {
    expect(COLUMN_KEY_ID_LABEL).toBe('ijazah:column-key-id:v1');
    expect(columnKeyId(KEY)).toBe(columnKeyId(KEY));
    expect(columnKeyId(KEY)).not.toBe(columnKeyId(OTHER_KEY));
    expect(Number.isInteger(columnKeyId(KEY))).toBe(true);
    expect(columnKeyId(KEY)).toBeGreaterThanOrEqual(0);
    expect(columnKeyId(KEY)).toBeLessThan(256);
  });

  it('reads a value written under the previous key and one written under the current key', () => {
    expect(rotating.decrypt(old, PAYOUT, ROW)).toBe('rcp_0123456789');
    const current = new ColumnCipher(OTHER_KEY).encrypt('new', PAYOUT, ROW);
    expect(rotating.decrypt(current, PAYOUT, ROW)).toBe('new');
  });

  it('always writes under the current key, which the previous key cannot read', () => {
    const written = rotating.encrypt('rcp_0123456789', PAYOUT, ROW);
    expect(written[0]).toBe(columnKeyId(OTHER_KEY));
    expect(new ColumnCipher(OTHER_KEY).decrypt(written, PAYOUT, ROW)).toBe('rcp_0123456789');
    refused(written, PAYOUT, cipher);
  });

  it('turns a value under the previous key into one under the current key, for the same column and row', () => {
    const turned = rotating.reencrypt(old, PAYOUT, ROW) ?? Buffer.alloc(0);
    expect(turned[0]).toBe(columnKeyId(OTHER_KEY));
    expect(new ColumnCipher(OTHER_KEY).decrypt(turned, PAYOUT, ROW)).toBe('rcp_0123456789');
    refused(turned, MFA, rotating);
    refused(turned, PAYOUT, rotating, OTHER_ROW);
  });

  it('leaves a value already under the current key as it is', () => {
    expect(
      rotating.reencrypt(rotating.encrypt('current', PAYOUT, ROW), PAYOUT, ROW),
    ).toBeUndefined();
    expect(cipher.reencrypt(old, PAYOUT, ROW)).toBeUndefined();
  });

  it('refuses to turn a value under neither key, or one moved from another column or row', () => {
    const lost = new ColumnCipher(THIRD_KEY).encrypt('lost', PAYOUT, ROW);
    expect(() => rotating.reencrypt(lost, PAYOUT, ROW)).toThrow(DecryptionError);
    expect(() => rotating.reencrypt(old, MFA, ROW)).toThrow(DecryptionError);
    expect(() => rotating.reencrypt(old, PAYOUT, OTHER_ROW)).toThrow(DecryptionError);
  });

  it('refuses a value that names the current key’s id but was written under another key (PR #61 review, n1)', () => {
    const impostor = new ColumnCipher(keySharingIdWith(OTHER_KEY)).encrypt('lost', PAYOUT, ROW);
    expect(impostor[0]).toBe(columnKeyId(OTHER_KEY));
    expect(() => rotating.reencrypt(impostor, PAYOUT, ROW)).toThrow(DecryptionError);
    expect(() => rotating.reencrypt(rotating.encrypt('current', PAYOUT, ROW), MFA, ROW)).toThrow(
      DecryptionError,
    );
  });

  it('is built from the configuration with both keys, so every process reads under either (n4)', () => {
    const built = createColumnCipher({ ENCRYPTION_KEY: OTHER_KEY, ENCRYPTION_KEY_PREVIOUS: KEY });
    expect(built.rotating).toBe(true);
    expect(built.decrypt(old, PAYOUT, ROW)).toBe('rcp_0123456789');
    expect(createColumnCipher({ ENCRYPTION_KEY: KEY }).rotating).toBe(false);
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
