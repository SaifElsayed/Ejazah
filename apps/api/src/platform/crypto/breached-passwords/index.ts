// T040 (FR-128, research R-105): is a chosen password on the bundled list of the most common
// breached passwords? NIST SP 800-63B §5.1.1.2 asks that a chosen password be compared against a
// list of compromised values; this one is bundled, so the check makes no network call and sends
// nothing anywhere (the Have I Been Pwned range API was rejected for that, R-105).
//
// THE FILE. `top-100k.bin` holds, for each distinct entry of the published list the build script
// names (`scripts/dev/build-breached-list.ts`), the first eight bytes of the SHA-1 of its NFKC form,
// sorted. Eight bytes keep a false match below one in 10^14 per check over 100,000 entries; the
// list is replaced by running the script, never fetched at runtime. It lives in the kernel, outside
// the magic-number gate's root; the password bounds live in `packages/contracts` (password.ts).
//
// A password is compared after NFKC (fullwidth letters are the letters a person sees) and without
// the spaces around it; its case is kept, as the published list keeps it. The file is checked once
// at first use: whole prefixes, sorted and distinct, or the process refuses to use it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The bytes kept of each entry's SHA-1. */
export const PREFIX_BYTES = 8;

// From src/ and from dist/ alike: four levels up is apps/api (as the terms fragments are read).
const LIST_FILE = new URL(
  '../../../../src/platform/crypto/breached-passwords/top-100k.bin',
  import.meta.url,
);

/** The SHA-1 prefix of a password's NFKC form. */
export function prefixOf(password: string): Buffer {
  return createHash('sha1')
    .update(password.normalize('NFKC'), 'utf8')
    .digest()
    .subarray(0, PREFIX_BYTES);
}

/** The list a sequence of entries makes: distinct prefixes, sorted, trimmed, blanks skipped. */
export function buildList(entries: readonly string[]): Buffer {
  const prefixes = new Map<string, Buffer>();
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const prefix = prefixOf(trimmed);
    prefixes.set(prefix.toString('hex'), prefix);
  }
  return Buffer.concat([...prefixes.keys()].sort().map((key) => prefixes.get(key) as Buffer));
}

/** True when `list` holds `prefix`: a binary search over the sorted fixed-width entries. */
export function contains(list: Buffer, prefix: Buffer): boolean {
  let low = 0;
  let high = list.length / PREFIX_BYTES - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const order = Buffer.compare(
      list.subarray(middle * PREFIX_BYTES, (middle + 1) * PREFIX_BYTES),
      prefix,
    );
    if (order === 0) return true;
    if (order < 0) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

let loaded: Buffer | undefined;

/**
 * Throws unless `list` is whole prefixes in strictly ascending order: an unsorted or damaged file
 * would make the search miss its entries and the check pass every password (review of B7, 7).
 */
export function assertSorted(list: Buffer): void {
  if (list.length % PREFIX_BYTES !== 0) {
    throw new Error('breached passwords: the list is not a whole number of prefixes');
  }
  for (let at = PREFIX_BYTES; at < list.length; at += PREFIX_BYTES) {
    const previous = list.subarray(at - PREFIX_BYTES, at);
    if (Buffer.compare(previous, list.subarray(at, at + PREFIX_BYTES)) >= 0) {
      throw new Error('breached passwords: the list is not sorted and distinct');
    }
  }
}

/** The committed list, read and checked once per process. */
function list(): Buffer {
  if (loaded === undefined) {
    const read = readFileSync(LIST_FILE);
    assertSorted(read);
    loaded = read;
  }
  return loaded;
}

/** The number of entries in the committed list. */
export function listSize(): number {
  return list().length / PREFIX_BYTES;
}

/**
 * True when `password` is on the bundled list of the most common breached passwords. The spaces
 * around it are dropped for the comparison, as the list's entries are (review of B7, 11).
 */
export function isBreached(password: string): boolean {
  return contains(list(), prefixOf(password.trim()));
}
