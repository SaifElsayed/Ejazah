// T105: cryptographic identifier generation for the two identifiers the public sees: certificate
// numbers and verification tokens (FR-045, R-DB-6; contracts/kernel.md "Guards applied by default"),
// and the secrets the services hand out: tokens, one-time codes and recovery codes (B9, T066).
//
// Both are drawn from Node's cryptographic generator, never from a sequence, a timestamp or
// `Math.random` (refused at build time by `db/no-weak-random`), so a person who holds one
// certificate cannot work out another. Nothing here is unique by construction: the columns are
// unique in the database (ERD §8, `ijazahs.certificate_number`, `verification_token_hash`), and at
// these sizes a collision is not a case a caller handles, the constraint is the net.
//
// CERTIFICATE NUMBER — printed on the certificate and typed by whoever checks it, so it is short
// and unambiguous: 16 characters of Crockford's base32 (digits and capitals without I, L, O and U),
// 80 random bits. It is stored without separators; grouping it 4-4-4-4 is for display only.
//
// VERIFICATION TOKEN — carried by the QR code and never typed, so it is long: 32 random bytes
// (256 bits) in base64url, 43 characters. The database stores only its hash (R-DB-7, T069).
import { randomBytes, randomInt } from 'node:crypto';

/** Crockford's base32 alphabet: 32 symbols, none of them easily misread as another. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const CERTIFICATE_NUMBER_LENGTH = 16;
const VERIFICATION_TOKEN_BYTES = 32;

/**
 * A new certificate number: 16 Crockford base32 characters, stored and compared without separators.
 *
 * Ten random bytes are exactly sixteen 5-bit groups, so every symbol is used with the same
 * probability; there is no modulo step to bias it.
 */
export function generateCertificateNumber(): string {
  return crockfordOf(randomBytes((CERTIFICATE_NUMBER_LENGTH * 5) / 8), CERTIFICATE_NUMBER_LENGTH);
}

/** The symbols of an administrator's recovery code (research R-107). */
export const RECOVERY_CODE_LENGTH = 10;

/**
 * A new recovery code (T066, R-107): ten Crockford base32 symbols, 50 random bits, typed by an
 * administrator who lost the authenticator. Seven bytes are drawn and their first fifty bits used,
 * each symbol five whole bits, so none is likelier than another. Stored peppered and hashed.
 */
export function generateRecoveryCode(): string {
  return crockfordOf(randomBytes(Math.ceil((RECOVERY_CODE_LENGTH * 5) / 8)), RECOVERY_CODE_LENGTH);
}

/** The first `length` 5-bit groups of `bytes`, as Crockford symbols. */
function crockfordOf(bytes: Buffer, length: number): string {
  let bits = 0;
  let pending = 0;
  let symbols = '';
  for (const byte of bytes) {
    pending = (pending << 8) | byte;
    bits += 8;
    while (bits >= 5 && symbols.length < length) {
      bits -= 5;
      symbols += CROCKFORD.charAt((pending >> bits) & 0b11111);
    }
    pending &= (1 << bits) - 1;
  }
  return symbols;
}

/** A new verification token: 32 random bytes in base64url, for the QR code. Store only its hash. */
export function generateVerificationToken(): string {
  return generateSecretToken();
}

/**
 * A new secret token: 32 random bytes in base64url, 43 characters (B9, T047): a refresh token
 * (stored as its hash), a provider nonce, an onboarding token's `jti`. Unguessable by construction,
 * so a single-use mark or a hash lookup is all the server needs to hold.
 */
export function generateSecretToken(): string {
  return randomBytes(VERIFICATION_TOKEN_BYTES).toString('base64url');
}

const ONE_TIME_CODE_DIGITS = 6;

/**
 * A new one-time code: six digits drawn uniformly by `randomInt` (no modulo bias), leading zeros
 * kept (research R-104). Hashed before it is stored; only the mail carries it.
 */
export function generateOneTimeCode(): string {
  return String(randomInt(10 ** ONE_TIME_CODE_DIGITS)).padStart(ONE_TIME_CODE_DIGITS, '0');
}
