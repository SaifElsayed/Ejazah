// The public identifiers of T105 (FR-045, R-DB-6). Added by Saif's review of PR #43 (m3): the file
// sits in the kernel path whose coverage floor T086 declares, and its form is what a printed
// certificate and a QR code depend on.
//
// Distinctness over ten thousand draws is a smoke test of the source, not a proof of randomness:
// a sequence, a timestamp or a fixed seed would repeat or collide long before that.
import { describe, expect, it } from 'vitest';
import {
  generateCertificateNumber,
  generateOneTimeCode,
  generateRecoveryCode,
  generateSecretToken,
  generateVerificationToken,
  RECOVERY_CODE_LENGTH,
} from './identifiers.js';

const DRAWS = 10_000;

describe('public identifiers (T105)', () => {
  it('a certificate number is 16 symbols of Crockford base32, without I, L, O or U', () => {
    for (let draw = 0; draw < 100; draw += 1) {
      expect(generateCertificateNumber()).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    }
  });

  it('certificate numbers do not repeat, and every symbol of the alphabet is used', () => {
    const numbers = new Set<string>();
    const symbols = new Set<string>();
    for (let draw = 0; draw < DRAWS; draw += 1) {
      const number = generateCertificateNumber();
      numbers.add(number);
      for (const symbol of number) symbols.add(symbol);
    }
    expect(numbers.size).toBe(DRAWS);
    expect(symbols.size).toBe(32);
  });

  it('a verification token is 43 characters of base64url, 256 bits', () => {
    const token = generateVerificationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('verification tokens do not repeat', () => {
    const tokens = new Set<string>();
    for (let draw = 0; draw < DRAWS; draw += 1) tokens.add(generateVerificationToken());
    expect(tokens.size).toBe(DRAWS);
  });
});

describe('secrets the identity module hands out (B9, T047)', () => {
  it('draws a secret token of 32 random bytes in base64url, a fresh one each time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateSecretToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('draws a one-time code of six digits, leading zeros kept, every digit reachable', () => {
    const codes = Array.from({ length: 400 }, () => generateOneTimeCode());
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(new Set(codes.join('')).size).toBe(10);
  });
});

describe('an administrator’s recovery codes (T066, research R-107)', () => {
  it('draws ten symbols of Crockford base32, every symbol reachable, none repeated', () => {
    expect(RECOVERY_CODE_LENGTH).toBe(10);
    const codes = Array.from({ length: 2000 }, () => generateRecoveryCode());
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(codes.join('')).size).toBe(32);
  });
});
