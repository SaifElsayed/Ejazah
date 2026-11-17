// T122: the storage stand-in for tests (ARCHITECTURE §3.4, `InMemoryStorageAdapter`). This file's
// placeholder header already assigned it to T122. Objects live in memory, and the stand-in keeps the
// storage contract of T115 exactly as the two real implementations do: four operations, no lasting
// path, and a link that is signed and expires. It records each operation it was asked to do and
// fails one when told, before anything changes (`../stand-in.ts`). Since B46 (specs/005-certification
// Q2 (a)) the contract has a fifth operation, `read`.
//
// It is not selected by `STORAGE_DRIVER`: local storage is a real implementation and serves
// development (FR-055), so this one is constructed by a test that wants the record or a failure.
// A link is `/files/<key>?expires=<instant>&signature=<HMAC-SHA256>`, like the local one, signed under
// a random key of this instance, with only `node:crypto` (R-SEC-7); `verifyLink` answers the key while
// the signature holds and the moment has not passed. The expiry comes from `packages/time` (R-TIME-1).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { addSeconds } from '@ijazah/time';
import { StandIn } from '../stand-in.js';
import {
  assertLinkLifetime,
  assertStorageKey,
  isStorageKey,
  type StoragePort,
  type StoredObject,
} from './storage.port.js';

const LINK_PATH = '/files/';
const LINK_BASE = 'http://link.invalid';

export class InMemoryStorageAdapter extends StandIn<StoragePort> implements StoragePort {
  readonly #objects = new Map<string, StoredObject>();
  readonly #linkKey = randomBytes(32);
  readonly #now: () => Date;

  /** `now` is the clock links are issued and checked against; the system clock unless a test sets one. */
  constructor(options: { readonly now?: () => Date } = {}) {
    super();
    this.#now = options.now ?? (() => new Date());
  }

  put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const failure = this.attempt('put', [key, body, contentType]);
    if (failure !== undefined) return Promise.reject(failure);
    try {
      assertStorageKey(key);
    } catch (error: unknown) {
      return Promise.reject(error as Error);
    }
    this.#objects.set(key, { body: Uint8Array.from(body), contentType });
    return Promise.resolve();
  }

  temporaryLink(key: string, expiresInSeconds: number): Promise<string> {
    const failure = this.attempt('temporaryLink', [key, expiresInSeconds]);
    if (failure !== undefined) return Promise.reject(failure);
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

  remove(key: string): Promise<void> {
    const failure = this.attempt('remove', [key]);
    if (failure !== undefined) return Promise.reject(failure);
    try {
      assertStorageKey(key);
    } catch (error: unknown) {
      return Promise.reject(error as Error);
    }
    this.#objects.delete(key);
    return Promise.resolve();
  }

  exists(key: string): Promise<boolean> {
    const failure = this.attempt('exists', [key]);
    if (failure !== undefined) return Promise.reject(failure);
    try {
      assertStorageKey(key);
    } catch (error: unknown) {
      return Promise.reject(error as Error);
    }
    return Promise.resolve(this.#objects.has(key));
  }

  read(key: string): Promise<StoredObject> {
    const failure = this.attempt('read', [key]);
    if (failure !== undefined) return Promise.reject(failure);
    try {
      assertStorageKey(key);
    } catch (error: unknown) {
      return Promise.reject(error as Error);
    }
    const object = this.#objects.get(key);
    if (object === undefined) {
      return Promise.reject(new Error('No object is stored under that key.'));
    }
    return Promise.resolve({ body: Uint8Array.from(object.body), contentType: object.contentType });
  }

  /** The key a link reads, while its signature holds and its moment has not passed; else undefined. */
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
    const expected = Buffer.from(this.#sign(key, expires), 'base64url');
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
    if (!(new Date(expires) > this.#now())) return undefined;
    return key;
  }

  /** What is stored under `key`, for a test that asserts on it; undefined when nothing is. */
  stored(key: string): StoredObject | undefined {
    return this.#objects.get(key);
  }

  #sign(key: string, expires: string): string {
    return createHmac('sha256', this.#linkKey).update(`${key}\n${expires}`).digest('base64url');
  }
}
