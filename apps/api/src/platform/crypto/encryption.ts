// T068: column encryption above the database, so the key never enters a query (FR-031, research
// R-8, R-DB-8). What must be recovered or presented to a third party (a payout reference, an MFA
// secret, a document's storage key, a push token) is stored encrypted in one `bytea` column ending
// `_encrypted`.
//
// AES-256-GCM from `node:crypto`, nothing written by hand (R-SEC-7). The stored value is
//   version (1 byte) | IV (12 bytes, fresh per write) | tag (16 bytes) | ciphertext
// and the associated data is the version byte, the column's name, `table.column`, a newline, and
// the id of the row the value belongs to (T172, review finding SEC-6). So a value changed anywhere,
// read as another version, moved into another column or moved into another row fails the tag:
// the binding is to the column AND the row, so two teachers' values swapped between their rows no
// longer decrypt. Renaming a column means re-encrypting its values under the new name; a row's id
// never changes. A random 96-bit IV stays far below NIST SP 800-38D's limit of 2^32 encryptions
// under one key at this platform's volume. Errors carry neither the plaintext, the stored bytes
// nor the row (R-SEC-2).
//
// T155: the version byte is the key id of the `ENCRYPTION_KEY` the value was written under, one byte
// derived from that key under a label of its own, so the stored value says which key reads it, as a
// Tink ciphertext's prefix names its key. During a rotation the cipher holds the current key and the
// previous one, reads a value under either, and writes only under the current one; the
// `reencrypt-columns` job (jobs/) turns every old value into a current one, so the previous key can
// then be retired. Two keys share an id about once in 256, so a previous key that shares the
// current key's id is refused, and a new key is generated instead. A value under a third key whose id
// matches one of the two still fails the tag, as a value under any other key does, and `reencrypt`
// decrypts a value that names the current key too, so the sweep counts such a value instead of
// passing it over as current (PR #61 review, n1).
//
// Every process builds its cipher with `createColumnCipher(config)`, so none holds the current key
// alone while a rotation runs and fails to read values still under the previous one (n4).
//
// The key is not ENCRYPTION_KEY itself but a subkey derived from it by HKDF-SHA256 under a label of
// its own. Every label derived from ENCRYPTION_KEY is listed here, in `HKDF_LABELS`, so none is used
// twice, and every caller derives through `deriveSubkey` (T005), whose label type is that list:
//   ijazah:storage-link:v1              platform/ports/storage/local.adapter.ts  signs local links (T116)
//   ijazah:column-encryption:v1         this file                                encrypts columns (T068)
//   ijazah:column-key-id:v1             this file                                names the key (T155)
//   ijazah:otp-pepper:v1                platform/crypto/hashing.ts               peppers OTP hashes (T069)
//   ijazah:payment-stand-in-webhook:v1  platform/ports/payment/index.ts          signs stand-in events (T121)
//   ijazah:video-stand-in-webhook:v1    platform/ports/video/index.ts            signs stand-in events (T121)
//   ijazah:rate-limit-subject:v1        platform/guards/rate-limit.guard.ts      hashes rate-limit subjects (T170)
//   ijazah:access-token:v1              modules/identity (Phase 1, T044)         signs access tokens (data-model §7, R-101)
//   ijazah:onboarding-token:v1          modules/identity (Phase 1, T043)         signs onboarding tokens (R-102)
//   ijazah:admin-invite:v1              modules/admin (Phase 1, T066)            signs invite links (FR-174)
//   ijazah:banned-identifier:v1         modules/identity (Phase 1, T097)         keys a banned person's identifier hashes (FR-155)
// Only the column key protects a stored value that a rotation can carry over: the columns are
// re-encrypted (T155). The banned-identifier key makes stored hashes that cannot be: an HMAC is not
// recomputed without the address it was made from, so a rotation leaves every `banned_identifiers`
// row unmatched (docs/RUNBOOK.md, the rotation's warning). The rest protect short-lived values.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Config } from '../config/config.module.js';

/** Every HKDF label derived from ENCRYPTION_KEY, each once, in the order of the list above (T005). */
export const HKDF_LABELS = [
  'ijazah:storage-link:v1',
  'ijazah:column-encryption:v1',
  'ijazah:column-key-id:v1',
  'ijazah:otp-pepper:v1',
  'ijazah:payment-stand-in-webhook:v1',
  'ijazah:video-stand-in-webhook:v1',
  'ijazah:rate-limit-subject:v1',
  'ijazah:access-token:v1',
  'ijazah:onboarding-token:v1',
  'ijazah:admin-invite:v1',
  'ijazah:banned-identifier:v1',
] as const;

/** A registered label: the only kind `deriveSubkey` takes, so an unlisted label does not compile. */
export type HkdfLabel = (typeof HKDF_LABELS)[number];

export const COLUMN_KEY_LABEL = 'ijazah:column-encryption:v1' satisfies HkdfLabel;
export const COLUMN_KEY_ID_LABEL = 'ijazah:column-key-id:v1' satisfies HkdfLabel;
/** The three Phase 1 labels (data-model.md §7 of specs/002-identity); their callers arrive with their tasks. */
export const ACCESS_TOKEN_LABEL = 'ijazah:access-token:v1' satisfies HkdfLabel;
export const ONBOARDING_TOKEN_LABEL = 'ijazah:onboarding-token:v1' satisfies HkdfLabel;
export const ADMIN_INVITE_LABEL = 'ijazah:admin-invite:v1' satisfies HkdfLabel;
/** T097 (FR-155): the key of a banned person's identifier hashes (`modules/identity/banned-identifiers.ts`). */
export const BANNED_IDENTIFIER_LABEL = 'ijazah:banned-identifier:v1' satisfies HkdfLabel;

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;
const COLUMN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** The length every subkey has unless its caller needs another: 32 bytes, a SHA-256 output. */
export const SUBKEY_BYTES = KEY_BYTES;

/**
 * A subkey of ENCRYPTION_KEY (base64) under one registered label: HKDF-SHA256 with no salt and the
 * label as its info, `bytes` long. Two labels give two unrelated keys, so a value signed or encrypted
 * under one proves nothing under another; the type of `label` is the list, so a caller cannot derive
 * under a label the list does not hold (T005).
 */
export function deriveSubkey(
  encryptionKey: string,
  label: HkdfLabel,
  bytes: number = SUBKEY_BYTES,
): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(encryptionKey, 'base64'), Buffer.alloc(0), label, bytes),
  );
}

/** The column key: 32 bytes derived from ENCRYPTION_KEY (base64) by HKDF-SHA256. */
export function deriveColumnKey(encryptionKey: string): Buffer {
  return deriveSubkey(encryptionKey, COLUMN_KEY_LABEL, KEY_BYTES);
}

/** The key id a value written under ENCRYPTION_KEY (base64) carries: one byte, 0 to 255. */
export function columnKeyId(encryptionKey: string): number {
  return deriveSubkey(encryptionKey, COLUMN_KEY_ID_LABEL, 1).readUInt8(0);
}

/** A stored value that is not one this cipher wrote for this column under one of its keys. */
export class DecryptionError extends Error {
  constructor() {
    super('The encrypted value cannot be decrypted for this column.');
    this.name = 'DecryptionError';
  }
}

/** A previous key whose id is the current key's, so a stored value could not say which reads it. */
export class SharedKeyIdError extends Error {
  constructor() {
    super(
      'ENCRYPTION_KEY_PREVIOUS has the same key id as ENCRYPTION_KEY; generate another ENCRYPTION_KEY (openssl rand -base64 32).',
    );
    this.name = 'SharedKeyIdError';
  }
}

/** One stored value of an `_encrypted` column, by the id of its row. */
export interface EncryptedValue {
  readonly id: string;
  readonly value: Uint8Array;
}

/**
 * One `_encrypted` column as the `reencrypt-columns` job reaches it (T155): through the repository
 * of the module that owns its table (R-API-6), which holds the query and no rule.
 */
export interface EncryptedColumn {
  /** `table.column`, as the cipher binds a value to it. */
  readonly column: string;
  /** Up to `limit` rows holding a value, in id order, after the row `after` when it is given. */
  page(after: string | undefined, limit: number): Promise<readonly EncryptedValue[]>;
  /** Writes `next` where the row still holds `stored`; false when it holds another value or is gone. */
  replace(id: string, stored: Uint8Array, next: Uint8Array): Promise<boolean>;
}

// The column name holds no newline, so the newline tells where the row id begins.
const ROW_SEPARATOR = '\n';

function associatedData(version: number, column: string, rowId: string): Buffer {
  if (!COLUMN.test(column)) {
    throw new TypeError('An encrypted column is named `table.column`, in lower snake case.');
  }
  if (typeof rowId !== 'string' || rowId === '') {
    throw new TypeError('An encrypted value is bound to the id of its row; none was given.');
  }
  return Buffer.concat([
    Buffer.from([version]),
    Buffer.from(`${column}${ROW_SEPARATOR}${rowId}`, 'utf8'),
  ]);
}

export class ColumnCipher {
  readonly #currentId: number;
  readonly #current: Buffer;
  /** Column keys by key id: the current key's, and the previous key's while a rotation runs. */
  readonly #keys = new Map<number, Buffer>();

  /** `current` writes and reads; `previous`, set only while a rotation runs, only reads. */
  constructor(current: string, previous?: string) {
    this.#currentId = columnKeyId(current);
    this.#current = deriveColumnKey(current);
    this.#keys.set(this.#currentId, this.#current);
    if (previous === undefined) return;
    const previousId = columnKeyId(previous);
    if (previousId === this.#currentId) throw new SharedKeyIdError();
    this.#keys.set(previousId, deriveColumnKey(previous));
  }

  /** True while a previous key is held, so values under it may remain. */
  get rotating(): boolean {
    return this.#keys.size > 1;
  }

  /** The value to store in `column` (`table.column`) of row `rowId` for `plaintext`, under the current key. */
  encrypt(plaintext: string, column: string, rowId: string): Buffer {
    const aad = associatedData(this.#currentId, column, rowId);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#current, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([this.#currentId]), iv, cipher.getAuthTag(), ciphertext]);
  }

  /** The plaintext of a value stored in `column` of row `rowId`; `DecryptionError` for anything else. */
  decrypt(stored: Uint8Array, column: string, rowId: string): string {
    const value = Buffer.from(stored);
    const version = value[0];
    const key = version === undefined ? undefined : this.#keys.get(version);
    // The arguments are checked before the value, so a caller's mistake is a TypeError even for a
    // value this cipher could not read.
    const aad = associatedData(version ?? this.#currentId, column, rowId);
    if (value.length < HEADER_BYTES || version === undefined || key === undefined) {
      throw new DecryptionError();
    }
    const iv = value.subarray(1, 1 + IV_BYTES);
    const tag = value.subarray(1 + IV_BYTES, HEADER_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
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

  /**
   * The value to store in place of `stored` so it is under the current key, or undefined when the
   * current key already reads it. `DecryptionError` when neither key reads it for `column` and
   * `rowId`, a value naming the current key's id included: the id alone does not prove which key
   * wrote it.
   */
  reencrypt(stored: Uint8Array, column: string, rowId: string): Buffer | undefined {
    const plaintext = this.decrypt(stored, column, rowId);
    return stored[0] === this.#currentId ? undefined : this.encrypt(plaintext, column, rowId);
  }
}

/** The column cipher a process reads and writes with: the current key, and the previous one while a rotation runs. */
export function createColumnCipher(
  config: Pick<Config, 'ENCRYPTION_KEY' | 'ENCRYPTION_KEY_PREVIOUS'>,
): ColumnCipher {
  return new ColumnCipher(config.ENCRYPTION_KEY, config.ENCRYPTION_KEY_PREVIOUS);
}
