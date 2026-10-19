// T040 (FR-128, research R-105): the bundled list of the most common breached passwords, searched
// with no network call. The list is the top 100,000 of a published list (the build script's header
// names it), stored as sorted SHA-1 prefixes of the NFKC form.
import { describe, expect, it } from 'vitest';

import {
  assertSorted,
  buildList,
  contains,
  isBreached,
  listSize,
  PREFIX_BYTES,
  prefixOf,
} from './index.js';

describe('the breached-password list (T040)', () => {
  it('holds the passwords everyone tries first', () => {
    for (const known of ['123456', 'password', '12345678', 'qwerty', 'iloveyou', 'dragon']) {
      expect(isBreached(known)).toBe(true);
    }
  });

  it('does not hold a long passphrase', () => {
    expect(isBreached('the ijazah of tajweed, by sanad from my teacher')).toBe(false);
    expect(isBreached('انا بحب القهوة الصبح')).toBe(false);
  });

  it('compares the password with its case, as the list keeps it (review of B7, 8)', () => {
    expect(prefixOf('PASSWORD').equals(prefixOf('password'))).toBe(false);
    // Both spellings are on the published list as their own entries; a mixed case that is not
    // stays out.
    expect(isBreached('PASSWORD')).toBe(true);
    expect(isBreached('PaSsWoRd')).toBe(false);
  });

  it('reads a listed password with spaces around it as that password (review of B7, 11)', () => {
    expect(isBreached(' 123456 ')).toBe(true);
  });

  it('refuses a list that is not sorted, rather than missing its entries (review of B7, 7)', () => {
    const sorted = buildList(['apple', 'mango', 'zebra']);
    expect(() => assertSorted(sorted)).not.toThrow();
    const reversed = Buffer.concat(
      [0, 1, 2]
        .reverse()
        .map((index) => sorted.subarray(index * PREFIX_BYTES, (index + 1) * PREFIX_BYTES)),
    );
    expect(() => assertSorted(reversed)).toThrow(/not sorted/);
    expect(() => assertSorted(Buffer.alloc(PREFIX_BYTES + 1))).toThrow(/whole number/);
  });

  it('reads a compatibility form of a listed password as that password (NFKC)', () => {
    // Fullwidth letters are the same password to a person and to NFKC.
    expect(isBreached('ｐａｓｓｗｏｒｄ')).toBe(true);
  });

  it('is the committed file: one prefix per distinct entry, sorted', () => {
    expect(listSize()).toBeGreaterThan(90_000);
    expect(listSize()).toBeLessThanOrEqual(100_000);
  });

  it('builds a sorted, distinct list and finds in it by binary search', () => {
    const list = buildList(['zebra', 'apple', 'apple', '', '  mango  ']);
    expect(list.length).toBe(3 * PREFIX_BYTES);
    const prefixes = [0, 1, 2].map((index) =>
      list.subarray(index * PREFIX_BYTES, (index + 1) * PREFIX_BYTES).toString('hex'),
    );
    expect([...prefixes].sort()).toEqual(prefixes);
    expect(contains(list, prefixOf('mango'))).toBe(true);
    expect(contains(list, prefixOf('zebra'))).toBe(true);
    expect(contains(list, prefixOf('grape'))).toBe(false);
    expect(contains(buildList([]), prefixOf('apple'))).toBe(false);
  });
});
