// T116: the storage port (contracts/ports.md, FR-055). The only port with real implementations in
// Phase 0, because Phase 1 uploads documents the moment it exists.
//
// R-SEC-3 is held by absence: no operation returns a durable or publicly reachable path, so there
// is nothing to call that could serve a document from a guessable place. A file is reached only by
// a signed link that expires, and the lifetime is checked here, once, for every implementation.

/** The longest a link may live: seven days, the most a presigned remote link allows. */
export const MAX_LINK_SECONDS = 604_800;

export interface StoragePort {
  /** Store `body` under `key`, replacing what was there. */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** A signed link that reads `key` until `expiresInSeconds` have passed, and never after. */
  temporaryLink(key: string, expiresInSeconds: number): Promise<string>;
  /** Remove the object; removing an absent key is not an error (retention and purge jobs). */
  remove(key: string): Promise<void>;
  /** Whether an object is stored under `key` (integrity checks). */
  exists(key: string): Promise<boolean>;
}

const MAX_KEY_LENGTH = 1024;

// A segment never starts with a dot, which refuses `.`, `..` and hidden files in one test, and
// carries no separator of any platform. So a key cannot climb out of the store on any of them.
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** Whether `key` is a storage key: segments joined by `/`, none empty and none starting with a dot. */
export function isStorageKey(key: string): boolean {
  return key.length <= MAX_KEY_LENGTH && key.split('/').every((segment) => SEGMENT.test(segment));
}

/** Refuse a key that could name something outside the store. The key is not echoed back. */
export function assertStorageKey(key: string): void {
  if (!isStorageKey(key)) {
    throw new TypeError(
      'A storage key is segments of letters, digits, ".", "_" and "-" joined by "/", none empty and none starting with ".".',
    );
  }
}

/** Refuse a lifetime that is not a whole number of seconds from one up to seven days. */
export function assertLinkLifetime(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_LINK_SECONDS) {
    throw new RangeError(`A link lives from 1 to ${MAX_LINK_SECONDS} whole seconds.`);
  }
}
