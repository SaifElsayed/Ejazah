// The public identifiers of T105 (FR-045, R-DB-6). Added by Saif's review of PR #43 (m3): the file
// sits in the kernel path whose coverage floor T086 declares, and its form is what a printed
// certificate and a QR code depend on.
//
// Distinctness over ten thousand draws is a smoke test of the source, not a proof of randomness:
// a sequence, a timestamp or a fixed seed would repeat or collide long before that.
import { describe, expect, it } from 'vitest';
import { generateCertificateNumber, generateVerificationToken } from './identifiers.js';

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
