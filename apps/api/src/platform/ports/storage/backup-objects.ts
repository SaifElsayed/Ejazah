// R2 T179 (`specs/002-identity/tasks.md` T179 and its R2 note; SRS DEC-100, DEC-108): the object
// store's calls of `scripts/ops/backup.ts`, the server's nightly backup, its documents' copy and its
// restore. Not a port's adapter: nothing in the API calls it. It lives here only because the
// workspace is isolated (`.npmrc`), so `@aws-sdk/client-s3` resolves from `apps/api` alone, as
// `scripts/dev/admin-invite.ts` reaches BullMQ through `jobs/queue`. It reads no configuration:
// each client is built from the values the script hands it (`deploy/backup.env.example`).
//
// Any S3-compatible service, addressed by path, as `s3.adapter.ts`. Cloudflare R2 has no
// versioning, so the documents' second copy is the script's own (T179's R2 note, item 3).
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// A nightly job, not a request someone waits on: longer bounds than the API's, still bounded. Each is
// named in R-MONEY-12's exception (amended 2026-11-27, PR #162 r1 Major 1): a transport number of the
// backup script, not a setting, since its expiry only fails that night's run, which the timer reports;
// none is a window or limit of the work.
/**
 * How long the connection to the service may take before the attempt is abandoned (transport: a stuck
 * connect fails the night).
 */
export const BACKUP_CONNECTION_TIMEOUT_MS = 10_000;
/**
 * How long one listing, read, copy or delete may take, from its start to the answer's headers
 * (transport: one call).
 */
export const BACKUP_REQUEST_TIMEOUT_MS = 60_000;
/**
 * How long a dump's upload or download may take: the request timer covers the whole body (transport:
 * one dump's transfer).
 */
export const BACKUP_TRANSFER_TIMEOUT_MS = 3_600_000;
/** How many attempts one call makes at most (transport: a passing fault retried, a lasting one fails the night). */
export const BACKUP_MAX_ATTEMPTS = 3;

/** Only the owner reads or writes a downloaded dump. */
const OWNER_ONLY_FILE_MODE = 0o600;

/** One bucket and the token that reaches it. */
export interface BucketAccess {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** The one method of the client this file calls. */
export type ObjectClient = Pick<S3Client, 'send'>;

/** An object of a listing: its key and when the service last wrote it. */
export interface ObjectSummary {
  readonly key: string;
  readonly lastModified: Date;
}

/** What `read` hands back: the stored bytes and the content type they were put with. */
export interface ObjectBytes {
  readonly body: Uint8Array;
  readonly contentType: string | undefined;
}

export function createBackupClient(access: BucketAccess): S3Client {
  return new S3Client({
    endpoint: access.endpoint,
    region: access.region,
    forcePathStyle: true,
    credentials: { accessKeyId: access.accessKeyId, secretAccessKey: access.secretAccessKey },
    requestHandler: {
      connectionTimeout: BACKUP_CONNECTION_TIMEOUT_MS,
      requestTimeout: BACKUP_REQUEST_TIMEOUT_MS,
      throwOnRequestTimeout: true,
    },
    maxAttempts: BACKUP_MAX_ATTEMPTS,
  });
}

/** `CopySource` is the bucket and the key, each segment URL-encoded, the separators kept. */
function copySourceOf(bucket: string, key: string): string {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** The calls on one bucket. */
export class S3BackupObjects {
  readonly #client: ObjectClient;
  readonly #bucket: string;

  constructor(client: ObjectClient, bucket: string) {
    this.#client = client;
    this.#bucket = bucket;
  }

  /** Every object under `prefix`, page by page, in the service's order (by key). */
  async list(prefix: string): Promise<ObjectSummary[]> {
    const objects: ObjectSummary[] = [];
    let token: string | undefined;
    do {
      const page = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const entry of page.Contents ?? []) {
        if (entry.Key !== undefined && entry.LastModified !== undefined) {
          objects.push({ key: entry.Key, lastModified: entry.LastModified });
        }
      }
      token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
    return objects;
  }

  /** Uploads the file at `path` under `key` with its length; the length uploaded. */
  async putFile(key: string, path: string): Promise<number> {
    const { size } = await stat(path);
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
        ContentType: 'application/octet-stream',
        ServerSideEncryption: 'AES256',
      }),
      { requestTimeout: BACKUP_TRANSFER_TIMEOUT_MS },
    );
    return size;
  }

  /** Writes the object under `key` into a new file at `path`, readable by its owner only. */
  async download(key: string, path: string): Promise<void> {
    const object = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      {
        requestTimeout: BACKUP_TRANSFER_TIMEOUT_MS,
      },
    );
    if (object.Body === undefined) throw new Error('The stored object has no body.');
    await pipeline(
      object.Body as Readable,
      createWriteStream(path, { mode: OWNER_ONLY_FILE_MODE, flags: 'wx' }),
    );
  }

  /** The object's bytes and content type (a document, at most the upload limit). */
  async read(key: string): Promise<ObjectBytes> {
    const object = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
    );
    if (object.Body === undefined) throw new Error('The stored object has no body.');
    return { body: await object.Body.transformToByteArray(), contentType: object.ContentType };
  }

  /** Stores `body` under `key`, with server-side encryption requested as `s3.adapter.ts` does. */
  async put(key: string, body: Uint8Array, contentType: string | undefined): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  /** Copies `from` to `to` inside this bucket, the copy dated now; no SSE header (R2 has none). */
  async copy(from: string, to: string): Promise<void> {
    await this.#client.send(
      new CopyObjectCommand({
        Bucket: this.#bucket,
        Key: to,
        CopySource: copySourceOf(this.#bucket, from),
      }),
    );
  }

  /** Deletes the object; deleting an absent key is not an error. */
  async remove(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }
}

/** The calls on the bucket `access` names, through a client of its own. */
export function openBucket(access: BucketAccess): S3BackupObjects {
  return new S3BackupObjects(createBackupClient(access), access.bucket);
}
