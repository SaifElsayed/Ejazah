// T040 (FR-128, research R-105): the bundled list of the most common breached passwords, searched
// with no network call. The list is the top 100,000 of a published list (the build script's header
// names it), stored as sorted SHA-1 prefixes of the NFKC form.
import { describe, expect, it } from 'vitest';

import { buildList, contains, isBreached, listSize, PREFIX_BYTES, prefixOf } from './index.js';

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

  it('compares the password as typed, case included', () => {
    expect(isBreached('PASSWORD')).toBe(isBreached('PASSWORD'));
    expect(isBreached('password')).toBe(true);
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
