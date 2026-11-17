// T115: the storage contract (FR-055, R-SEC-3), run against both real implementations of T116, and,
// since T122, against the in-memory stand-in, which must keep the same contract as what it stands in for.
//
// "No durable public path" is held twice. The port's operations are exactly five, and the type
// check below fails the moment a sixth appears (B46, specs/005-certification Q2 (a): `read`, which
// hands back an object's bytes to the server, never a path or a link); at run time the only operation that returns text
// is the temporary link, and every link it hands out carries an expiry and a signature. "Every
// link expires": the local link is refused by its own verifier once its moment has passed, and the
// remote link is a presigned URL whose lifetime the storage service enforces.
//
// No network and no credential (SC-005): the remote implementation runs on a real client whose
// `send` is answered in memory, and presigning is computed locally.
//
// The type check is enforced by `pnpm typecheck` (CI stage 1), not by vitest.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { addSeconds } from '@ijazah/time';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { InMemoryStorageAdapter } from './in-memory.adapter.js';
import { deriveLinkKey, LocalStorageAdapter } from './local.adapter.js';
import { S3StorageAdapter } from './s3.adapter.js';
import { MAX_LINK_SECONDS, type StoragePort, type StoredObject } from './storage.port.js';

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const ISSUED = new Date('2026-10-07T10:00:00Z');

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface Subject {
  readonly storage: StoragePort;
  /** Whether `link` is still honoured `seconds` after it was issued, as the side serving it decides. */
  readonly honouredAfter: (link: string, seconds: number) => boolean;
}

function local(): Subject {
  const root = mkdtempSync(join(tmpdir(), 'ijazah-storage-'));
  roots.push(root);
  let now = ISSUED;
  const storage = new LocalStorageAdapter({
    root,
    linkKey: deriveLinkKey(ENCRYPTION_KEY),
    now: () => now,
  });
  return {
    storage,
    honouredAfter: (link, seconds) => {
      now = new Date(addSeconds(ISSUED, seconds));
      const honoured = storage.verifyLink(link) !== undefined;
      now = ISSUED;
      return honoured;
    },
  };
}

/** The stand-in (T122), on the same fixed clock as the local implementation. */
function memory(): Subject {
  let now = ISSUED;
  const storage = new InMemoryStorageAdapter({ now: () => now });
  return {
    storage,
    honouredAfter: (link, seconds) => {
      now = new Date(addSeconds(ISSUED, seconds));
      const honoured = storage.verifyLink(link) !== undefined;
      now = ISSUED;
      return honoured;
    },
  };
}

function notFound(): S3ServiceException {
  return new S3ServiceException({
    name: 'NotFound',
    $fault: 'client',
    $metadata: { httpStatusCode: 404 },
  });
}

/** A real client, so presigning is the library's own; its requests are answered in memory. */
function remote(): Subject {
  const client = new S3Client({
    region: 'eu-central-1',
    endpoint: 'http://127.0.0.1:9',
    forcePathStyle: true,
    credentials: { accessKeyId: 'contract-test', secretAccessKey: 'contract-test' },
  });
  const objects = new Map<string, { readonly body: unknown; readonly type: unknown }>();
  client.send = ((command: unknown) => {
    if (command instanceof PutObjectCommand) {
      objects.set(String(command.input.Key), {
        body: command.input.Body,
        type: command.input.ContentType,
      });
      return Promise.resolve({});
    }
    if (command instanceof GetObjectCommand) {
      const object = objects.get(String(command.input.Key));
      if (object === undefined) return Promise.reject(notFound());
      const bytes = Uint8Array.from(object.body as Uint8Array);
      return Promise.resolve({
        Body: { transformToByteArray: () => Promise.resolve(bytes) },
        ContentType: object.type,
      });
    }
    if (command instanceof HeadObjectCommand) {
      return objects.has(String(command.input.Key))
        ? Promise.resolve({})
        : Promise.reject(notFound());
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(String(command.input.Key));
      return Promise.resolve({});
    }
    return Promise.reject(new Error('not answered by the contract test'));
  }) as S3Client['send'];
  return {
    storage: new S3StorageAdapter(client, 'documents'),
    // The storage service refuses a presigned URL once its X-Amz-Expires seconds have passed.
    honouredAfter: (link, seconds) =>
      seconds < Number(new URL(link).searchParams.get('X-Amz-Expires')),
  };
}

describe('the storage port (T115, FR-055, R-SEC-3)', () => {
  it('has exactly five operations, none of which hands out a lasting path', () => {
    expectTypeOf<keyof StoragePort>().toEqualTypeOf<
      'put' | 'temporaryLink' | 'remove' | 'exists' | 'read'
    >();
    expectTypeOf<ReturnType<StoragePort['read']>>().toEqualTypeOf<Promise<StoredObject>>();
    expectTypeOf<ReturnType<StoragePort['put']>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<ReturnType<StoragePort['remove']>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<ReturnType<StoragePort['exists']>>().toEqualTypeOf<Promise<boolean>>();
  });
});

describe.each([
  { name: 'local', make: local },
  { name: 'remote', make: remote },
  { name: 'in-memory stand-in', make: memory },
])('the $name storage (T115, FR-055, R-SEC-3)', ({ make }) => {
  it('stores, reports and removes an object, and returns no path for it', async () => {
    const { storage } = make();
    const body = new TextEncoder().encode('%PDF-1.7 certificate');

    expect(await storage.put('certificates/2026/a.pdf', body, 'application/pdf')).toBeUndefined();
    expect(await storage.exists('certificates/2026/a.pdf')).toBe(true);
    expect(await storage.remove('certificates/2026/a.pdf')).toBeUndefined();
    expect(await storage.exists('certificates/2026/a.pdf')).toBe(false);
  });

  it('reads back what was put, with its content type, and refuses an absent object', async () => {
    const { storage } = make();
    const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    await storage.put('ijazah-requests/r1/signature.png', body, 'image/png');

    const read = await storage.read('ijazah-requests/r1/signature.png');

    expect([...read.body]).toEqual([...body]);
    expect(read.contentType).toBe('image/png');
    await expect(storage.read('ijazah-requests/r1/absent.png')).rejects.toThrow();
  });

  it('hands out a signed link that names its lifetime', async () => {
    const { storage } = make();
    await storage.put('documents/id.png', new Uint8Array([1, 2, 3]), 'image/png');

    const link = await storage.temporaryLink('documents/id.png', 600);
    const names = [...new URL(link, 'http://link.invalid').searchParams.keys()];

    expect(names.some((name) => /signature/i.test(name))).toBe(true);
    expect(names.some((name) => /expires/i.test(name))).toBe(true);
  });

  it('every link expires: honoured within its lifetime, refused once it has passed', async () => {
    const { storage, honouredAfter } = make();
    await storage.put('documents/id.png', new Uint8Array([1, 2, 3]), 'image/png');

    const link = await storage.temporaryLink('documents/id.png', 600);

    expect(honouredAfter(link, 0)).toBe(true);
    expect(honouredAfter(link, 599)).toBe(true);
    expect(honouredAfter(link, 600)).toBe(false);
    expect(honouredAfter(link, 86_400)).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_LINK_SECONDS + 1])(
    'refuses a link lifetime of %s seconds, so no link lives forever',
    async (seconds) => {
      const { storage } = make();
      await expect(storage.temporaryLink('documents/id.png', seconds)).rejects.toThrow(RangeError);
    },
  );

  it('accepts the longest lifetime, seven days', async () => {
    const { storage } = make();
    await expect(storage.temporaryLink('documents/id.png', MAX_LINK_SECONDS)).resolves.toEqual(
      expect.any(String),
    );
  });

  it.each(['', '../escape', 'a/../../escape', '/absolute', 'a\\b', 'a//b', 'a/./b', 'a/'])(
    'refuses the key %j in every operation, so no key reaches outside the store',
    async (key) => {
      const { storage } = make();
      await expect(storage.put(key, new Uint8Array([1]), 'text/plain')).rejects.toThrow(TypeError);
      await expect(storage.temporaryLink(key, 60)).rejects.toThrow(TypeError);
      await expect(storage.remove(key)).rejects.toThrow(TypeError);
      await expect(storage.exists(key)).rejects.toThrow(TypeError);
      await expect(storage.read(key)).rejects.toThrow(TypeError);
    },
  );
});
