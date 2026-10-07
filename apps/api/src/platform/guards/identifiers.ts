// T105: cryptographic identifier generation for the two identifiers the public sees: certificate
// numbers and verification tokens (FR-045, R-DB-6; contracts/kernel.md "Guards applied by default").
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
import { randomBytes } from 'node:crypto';

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
  const bytes = randomBytes((CERTIFICATE_NUMBER_LENGTH * 5) / 8);
  let bits = 0;
  let pending = 0;
  let number = '';
  for (const byte of bytes) {
    pending = (pending << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      number += CROCKFORD.charAt((pending >> bits) & 0b11111);
    }
    pending &= (1 << bits) - 1;
  }
  return number;
}

/** A new verification token: 32 random bytes in base64url, for the QR code. Store only its hash. */
export function generateVerificationToken(): string {
  return randomBytes(VERIFICATION_TOKEN_BYTES).toString('base64url');
}
