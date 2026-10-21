// T066 (research R-107, FR-170, FR-171): the administrator's second factor, RFC 6238 TOTP. The one
// file that imports `otplib` (R-SEC-7: a proven library for authentication code, never a dozen lines
// over HMAC); the admin module reaches TOTP through these functions only, and `totp.spec.ts` holds
// them to RFC 6238's own vectors.
//
// SHA-1, six digits, thirty seconds: what every authenticator reads from an `otpauth://` URI without
// asking. One step of drift is accepted either way, for a phone whose clock is a little off, and a
// code whose step is at or before the last one accepted is refused, so a code seen over a shoulder
// is spent once used (RFC 6238 §5.2; the step is kept on `admin_users.mfa_last_accepted_step`).
//
// The secret is 20 random bytes (160 bits, RFC 4226 §4's recommendation) in base32, the form the URI
// and the manual key carry. These are the protocol's numbers, not product settings, so they live
// here in the kernel rather than in `settings` (R-MONEY-12 governs `modules/`).
import { unixSeconds } from '@ijazah/time';
import { generate, generateSecret, generateURI, verify } from 'otplib';

export const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const SECRET_BYTES = 20;
/** The issuer an authenticator shows above the account. */
const ISSUER = 'Ijazah';
const SIX_DIGITS = /^\d{6}$/;

/** A fresh TOTP secret: 160 random bits in base32. */
export function generateTotpSecret(): string {
  return generateSecret({ length: SECRET_BYTES });
}

/** The `otpauth://` URI an authenticator scans: the issuer, the account and the secret. */
export function totpUri({ account, secret }: { account: string; secret: string }): string {
  return generateURI({
    issuer: ISSUER,
    label: account,
    secret,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
  });
}

/** The code of `secret` at `at`. The specs and the stand-ins use it; a request never does. */
export function totpCode(secret: string, at: Date): Promise<string> {
  return generate({
    secret,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    epoch: unixSeconds(at),
  });
}

/**
 * Whether `code` is `secret`'s at `at`, one step either way, and later than `lastAcceptedStep`: the
 * step it belongs to, to be recorded, or null. A code that is not six digits is null, never a throw.
 */
export async function verifyTotp(
  secret: string,
  code: string,
  at: Date,
  lastAcceptedStep: bigint | null,
): Promise<{ readonly step: bigint } | null> {
  if (!SIX_DIGITS.test(code)) return null;
  const result = await verify({
    secret,
    token: code,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    epoch: unixSeconds(at),
    epochTolerance: TOTP_PERIOD_SECONDS,
    ...(lastAcceptedStep === null ? {} : { afterTimeStep: Number(lastAcceptedStep) }),
  });
  // The functional API types HOTP's answer too; a TOTP answer carries its step.
  return result.valid && 'timeStep' in result ? { step: BigInt(result.timeStep) } : null;
}
