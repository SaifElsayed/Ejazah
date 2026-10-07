// T116: the local filesystem implementation, for development (FR-055, R-SEC-3).
//
// Objects live under `<root>/objects/<key>` and their declared content types under
// `<root>/types/<key>`, so a key can never collide with a type file. The root is
// `STORAGE_LOCAL_ROOT`, outside any web root (NFR-SEC-9), and every path is resolved and checked
// to stay under it, beside the key check every operation makes.
//
// A link is `/files/<key>?expires=<instant>&signature=<HMAC-SHA256>`, relative, signed over the key
// and the expiry. `verifyLink` answers the key only while the signature holds and the moment has
// not passed; the route that serves `/files/` belongs to the phase that uploads the first file
// (note under T116). The signing key is derived from ENCRYPTION_KEY by HKDF under its own label,
// so no new secret is configured; only `node:crypto` primitives are used (R-SEC-7). Rotating
// ENCRYPTION_KEY invalidates every local link already handed out, which development can afford.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { addSeconds } from '@ijazah/time';
import {
  assertLinkLifetime,
  assertStorageKey,
  isStorageKey,
  type StoragePort,
} from './storage.port.js';

const LINK_KEY_LABEL = 'ijazah:storage-link:v1';
const LINK_PATH = '/files/';
const LINK_BASE = 'http://link.invalid';
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** The key that signs local links: 32 bytes derived from ENCRYPTION_KEY (base64) by HKDF-SHA256. */
export function deriveLinkKey(encryptionKey: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(encryptionKey, 'base64'), Buffer.alloc(0), LINK_KEY_LABEL, 32),
  );
}

export interface LocalStorageOptions {
  readonly root: string;
  readonly linkKey: Buffer;
  /** The clock links are issued and checked against; the system clock unless a test sets one. */
  readonly now?: () => Date;
}

export class LocalStorageAdapter implements StoragePort {
  readonly #objects: string;
  readonly #types: string;
  readonly #linkKey: Buffer;
  readonly #now: () => Date;

  constructor(options: LocalStorageOptions) {
    const root = resolve(options.root);
    this.#objects = resolve(root, 'objects');
    this.#types = resolve(root, 'types');
    this.#linkKey = options.linkKey;
    this.#now = options.now ?? (() => new Date());
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const object = this.#under(this.#objects, key);
    const type = this.#under(this.#types, key);
    await mkdir(dirname(object), { recursive: true });
    await mkdir(dirname(type), { recursive: true });
    await writeFile(object, body);
    await writeFile(type, contentType);
  }

  temporaryLink(key: string, expiresInSeconds: number): Promise<string> {
    try {
      assertStorageKey(key);
      assertLinkLifetime(expiresInSeconds);
    } catch (error: unknown) {
      return Promise.reject(error as Error);
    }
    const expires = addSeconds(this.#now(), expiresInSeconds);
    const path = key.split('/').map(encodeURIComponent).join('/');
    const query = new URLSearchParams({ expires, signature: this.#sign(key, expires) });
    return Promise.resolve(`${LINK_PATH}${path}?${query.toString()}`);
  }

  async remove(key: string): Promise<void> {
    const object = this.#under(this.#objects, key);
    const type = this.#under(this.#types, key);
    await rm(object, { force: true });
    await rm(type, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    const object = this.#under(this.#objects, key);
    try {
      return (await stat(object)).isFile();
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  /**
   * The key a link reads, while its signature holds and its moment has not passed; otherwise
   * undefined. For the route that serves `/files/`, which then reads the object with `read`.
   */
  verifyLink(link: string): string | undefined {
    if (!URL.canParse(link, LINK_BASE)) return undefined;
    const url = new URL(link, LINK_BASE);
    if (url.origin !== LINK_BASE || !url.pathname.startsWith(LINK_PATH)) return undefined;

    let key: string;
    try {
      key = url.pathname.slice(LINK_PATH.length).split('/').map(decodeURIComponent).join('/');
    } catch {
      return undefined;
    }
    const expires = url.searchParams.get('expires');
    const signature = url.searchParams.get('signature');
    if (!isStorageKey(key) || expires === null || signature === null) return undefined;
    if (!CANONICAL_INSTANT.test(expires)) return undefined;

    const expected = Buffer.from(this.#sign(key, expires), 'base64url');
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
    if (Date.parse(expires) <= this.#now().getTime()) return undefined;
    return key;
  }

  /** The object and its declared content type, for the route that serves a verified link. */
  async read(key: string): Promise<{ readonly body: Buffer; readonly contentType: string }> {
    const body = await readFile(this.#under(this.#objects, key));
    const contentType = await readFile(this.#under(this.#types, key), 'utf8');
    return { body, contentType };
  }

  #sign(key: string, expires: string): string {
    // A key holds no newline, so `key \n expires` reads back one way only.
    return createHmac('sha256', this.#linkKey).update(`${key}\n${expires}`).digest('base64url');
  }

  /** The file for `key` under `base`, refused unless it resolves inside `base`. */
  #under(base: string, key: string): string {
    assertStorageKey(key);
    const file = resolve(base, ...key.split('/'));
    if (!file.startsWith(base + sep)) {
      throw new TypeError('A storage key must resolve inside the store.');
    }
    return file;
  }
}
