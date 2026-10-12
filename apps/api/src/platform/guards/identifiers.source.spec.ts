// T166 — the public identifiers draw from the operating system's CSPRNG and from nothing else
// (R-DB-6, FR-045). `identifiers.spec.ts` checks form and distinctness, which a counter or
// `Math.random` would also pass. Here `node:crypto`'s `randomBytes` is replaced by a fake that
// answers bytes the case chooses, and each identifier must be exactly what those bytes encode and
// must change when they change: an identifier from any other source would ignore the fake.
//
// A file of its own, because `vi.mock` replaces the module for every case in the file.
import { afterEach, describe, expect, it, vi } from 'vitest';

const answered = vi.hoisted(() => ({ bytes: [] as Buffer[], sizes: [] as number[] }));

vi.mock('node:crypto', async (original) => {
  const actual = await original<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: (size: number) => {
      answered.sizes.push(size);
      const next = answered.bytes.shift();
      if (next === undefined || next.length !== size) {
        throw new Error(`the fake was asked for ${size} bytes it was not given`);
      }
      return next;
    },
  };
});

const { generateCertificateNumber, generateVerificationToken } = await import('./identifiers.js');

afterEach(() => {
  answered.bytes.length = 0;
  answered.sizes.length = 0;
});

describe('public identifiers come from node:crypto alone (T166, R-DB-6)', () => {
  it('a certificate number is the Crockford base32 of the ten bytes drawn', () => {
    answered.bytes.push(Buffer.alloc(10, 0x00), Buffer.alloc(10, 0xff));
    expect(generateCertificateNumber()).toBe('0000000000000000');
    expect(generateCertificateNumber()).toBe('ZZZZZZZZZZZZZZZZ');

    // 0x08 0x86 0x42 0x98 0xE8 = 00001 00010 00011 00100 00101 00110 00111 01000, twice.
    answered.bytes.push(Buffer.from('08864298e808864298e8', 'hex'));
    expect(generateCertificateNumber()).toBe('1234567812345678');
    expect(answered.sizes).toEqual([10, 10, 10]);
  });

  it('a verification token is the base64url of the 32 bytes drawn', () => {
    const drawn = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
    answered.bytes.push(drawn, Buffer.alloc(32, 0xfb));
    expect(generateVerificationToken()).toBe(drawn.toString('base64url'));
    expect(generateVerificationToken()).toBe(Buffer.alloc(32, 0xfb).toString('base64url'));
    expect(answered.sizes).toEqual([32, 32]);
  });
});
