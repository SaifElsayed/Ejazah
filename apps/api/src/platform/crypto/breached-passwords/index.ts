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
// A password is compared as typed, after NFKC (fullwidth letters are the letters a person sees);
// its case is kept, as the published list keeps it.
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

/** The committed list, read once per process. */
function list(): Buffer {
  loaded ??= readFileSync(LIST_FILE);
  if (loaded.length % PREFIX_BYTES !== 0) {
    throw new Error('breached passwords: top-100k.bin is not a whole number of prefixes');
  }
  return loaded;
}

/** The number of entries in the committed list. */
export function listSize(): number {
  return list().length / PREFIX_BYTES;
}

/** True when `password` is on the bundled list of the most common breached passwords. */
export function isBreached(password: string): boolean {
  return contains(list(), prefixOf(password));
}
