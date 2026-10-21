// T060, T066 (research R-107, FR-171): the administrator's second factor, RFC 6238 TOTP through
// `otplib` behind this one file. SHA-1, six digits, thirty seconds, one step of drift either way, and
// a code accepted once refused again in its step (RFC 6238 §5.2).
//
// THE VECTORS. RFC 6238 Appendix B publishes eight-digit codes for the SHA-1 seed
// "12345678901234567890"; a six-digit code is the same truncation modulo 10^6, so the expected
// code is the vector's last six digits.
import { addSeconds } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import {
  generateTotpSecret,
  totpCode,
  totpUri,
  verifyTotp,
  TOTP_PERIOD_SECONDS,
} from './totp.js';

/** "12345678901234567890" in base32, the seed of RFC 6238 Appendix B (SHA-1). */
const RFC_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/** The instant `seconds` after `from`. */
const after = (from: Date, seconds: number) => new Date(addSeconds(from, seconds));

describe('TOTP against RFC 6238 Appendix B (SHA-1)', () => {
  // The table's times (59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000 seconds).
  it.each([
    ['1970-01-01T00:00:59Z', '94287082'],
    ['2005-03-18T01:58:29Z', '07081804'],
    ['2005-03-18T01:58:31Z', '14050471'],
    ['2009-02-13T23:31:30Z', '89005924'],
    ['2033-05-18T03:33:20Z', '69279037'],
    ['2603-10-11T11:33:20Z', '65353130'],
  ])('at %s the code is the last six digits of %s', async (time, vector) => {
    expect(await totpCode(RFC_SEED, new Date(time))).toBe(vector.slice(-6));
  });
});

describe('verifyTotp', () => {
  const now = new Date('2009-02-13T23:31:30Z');
  // 1234567890 seconds, in steps of thirty.
  const step = 41_152_263n;

  it('accepts the current code and answers its step', async () => {
    const code = await totpCode(RFC_SEED, now);
    expect(await verifyTotp(RFC_SEED, code, now, null)).toEqual({ step });
  });

  it('accepts the code of one step before or after, and not two', async () => {
    const before = await totpCode(RFC_SEED, after(now, -TOTP_PERIOD_SECONDS));
    const next = await totpCode(RFC_SEED, after(now, TOTP_PERIOD_SECONDS));
    const twoBefore = await totpCode(RFC_SEED, after(now, -2 * TOTP_PERIOD_SECONDS));
    expect(await verifyTotp(RFC_SEED, before, now, null)).toEqual({ step: step - 1n });
    expect(await verifyTotp(RFC_SEED, next, now, null)).toEqual({ step: step + 1n });
    expect(await verifyTotp(RFC_SEED, twoBefore, now, null)).toBeNull();
  });

  it('refuses a code whose step is at or before the last one accepted (RFC 6238 §5.2)', async () => {
    const code = await totpCode(RFC_SEED, now);
    expect(await verifyTotp(RFC_SEED, code, now, step)).toBeNull();
    expect(await verifyTotp(RFC_SEED, code, now, step + 1n)).toBeNull();
    expect(await verifyTotp(RFC_SEED, code, now, step - 1n)).toEqual({ step });
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 345'])('refuses %j without throwing', async (code) => {
    expect(await verifyTotp(RFC_SEED, code, now, null)).toBeNull();
  });

  it('refuses a wrong code', async () => {
    const code = await totpCode(RFC_SEED, now);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    expect(await verifyTotp(RFC_SEED, wrong, now, null)).toBeNull();
  });
});

describe('the secret and its URI', () => {
  it('draws a fresh secret of 160 bits in base32 each time', () => {
    const secrets = new Set(Array.from({ length: 20 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(20);
    for (const secret of secrets) expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('writes the otpauth URI an authenticator reads: issuer, account, secret and the parameters', () => {
    const uri = new URL(totpUri({ account: 'admin@example.com', secret: RFC_SEED }));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Ijazah:admin@example.com');
    expect(uri.searchParams.get('secret')).toBe(RFC_SEED);
    expect(uri.searchParams.get('issuer')).toBe('Ijazah');
    expect(uri.searchParams.get('digits') ?? '6').toBe('6');
    expect(uri.searchParams.get('period') ?? '30').toBe('30');
    expect((uri.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()).toBe('SHA1');
  });
});
