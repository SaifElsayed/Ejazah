// T068: column encryption above the database, so the key never enters a query (FR-031, research
// R-8, R-DB-8). What must be recovered or presented to a third party (a payout reference, an MFA
// secret, a document's storage key, a push token) is stored encrypted in one `bytea` column ending
// `_encrypted`.
//
// AES-256-GCM from `node:crypto`, nothing written by hand (R-SEC-7). The stored value is
//   version (1 byte) | IV (12 bytes, fresh per write) | tag (16 bytes) | ciphertext
// and the associated data is the version byte followed by the column's name, `table.column`. So a
// value changed anywhere, read as another version, or moved into another column fails the tag.
// The binding is to the column, not the row: two teachers' values swapped between their rows still
// decrypt, and renaming a column means re-encrypting its values under the new name. A random
// 96-bit IV stays far below NIST SP 800-38D's limit of 2^32 encryptions under one key at this
// platform's volume. Errors carry neither the plaintext nor the stored bytes (R-SEC-2).
//
// The key is not ENCRYPTION_KEY itself but a subkey derived from it by HKDF-SHA256 under a label of
// its own. Every label derived from ENCRYPTION_KEY is listed here, so none is used twice:
//   ijazah:storage-link:v1        platform/ports/storage/local.adapter.ts   signs local links (T116)
//   ijazah:column-encryption:v1   this file                                 encrypts columns (T068)
//   ijazah:otp-pepper:v1          platform/crypto/hashing.ts                peppers OTP hashes (T069)
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export const COLUMN_KEY_LABEL = 'ijazah:column-encryption:v1';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;
const COLUMN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** The column key: 32 bytes derived from ENCRYPTION_KEY (base64) by HKDF-SHA256. */
export function deriveColumnKey(encryptionKey: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(encryptionKey, 'base64'), Buffer.alloc(0), COLUMN_KEY_LABEL, 32),
  );
}

/** A stored value that is not one this cipher wrote for this column under this key. */
export class DecryptionError extends Error {
  constructor() {
    super('The encrypted value cannot be decrypted for this column.');
    this.name = 'DecryptionError';
  }
}

function associatedData(version: number, column: string): Buffer {
  if (!COLUMN.test(column)) {
    throw new TypeError('An encrypted column is named `table.column`, in lower snake case.');
  }
  return Buffer.concat([Buffer.from([version]), Buffer.from(column, 'utf8')]);
}

export class ColumnCipher {
  readonly #key: Buffer;

  constructor(encryptionKey: string) {
    this.#key = deriveColumnKey(encryptionKey);
  }

  /** The value to store in `column` (`table.column`) for `plaintext`. */
  encrypt(plaintext: string, column: string): Buffer {
    const aad = associatedData(VERSION, column);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
  }

  /** The plaintext of a value stored in `column`; `DecryptionError` for anything else. */
  decrypt(stored: Uint8Array, column: string): string {
    const value = Buffer.from(stored);
    const version = value[0];
    if (value.length < HEADER_BYTES || version !== VERSION) throw new DecryptionError();
    const aad = associatedData(version, column);
    const iv = value.subarray(1, 1 + IV_BYTES);
    const tag = value.subarray(1 + IV_BYTES, HEADER_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.#key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([
        decipher.update(value.subarray(HEADER_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new DecryptionError();
    }
  }
}
