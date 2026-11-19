// T116: the remote object-storage implementation, for deployed environments (FR-055, R-SEC-3).
//
// Any S3-compatible service, addressed by path so a non-AWS endpoint works. A link is a presigned
// GET whose lifetime the service enforces, so it cannot outlive what `temporaryLink` was given.
// Every object is written with server-side encryption requested (SRS: verification documents and
// certificates encrypted at rest); a provider that refuses the header has its bucket policy enforce
// it instead (note under T116). The values come from the loaded configuration, never `process.env`.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  assertLinkLifetime,
  assertStorageKey,
  type StoragePort,
  type StoredObject,
} from './storage.port.js';

// 002:T147 (M7): every call to the service ends in bounded time. The purge removes a document's
// object inside the transaction that deletes its row (`verification/unreferenced-documents.ts`),
// and Prisma ends that transaction after 5 s (its default; `db/transaction.repository.ts` sets
// none), so every attempt, with the SDK's backoff between them, must end inside it. The SDK's
// standard retry waits once, a random share of 100 ms, or of 500 ms after throttling (@smithy/core
// 3.35.1, `DefaultRetryBackoffStrategy`): 2 × (800 + 1,200) + 500 = 4,500 ms, the row's delete
// before it in the rest. Its request timer starts with the connection's, so an attempt in fact
// ends by 1,200 ms. A request timeout alone only warns; `throwOnRequestTimeout` makes it fail.
/** How long the connection to the service may take before the attempt is abandoned. */
export const S3_CONNECTION_TIMEOUT_MS = 800;
/** How long one attempt may take, from its start to the answer's headers. */
export const S3_REQUEST_TIMEOUT_MS = 1_200;
/** How many attempts one call makes at most: the first and one retry. */
export const S3_MAX_ATTEMPTS = 2;
// The owner's Q-A2 (a), 2026-11-19: a `put` passes its own request timeout with the call. The
// request timer is total, not idle (@smithy/node-http-handler 4.12.1, `setRequestTimeout`: one
// timer from the request's start to the answer's headers), so it must cover sending the whole
// body. Uploads reach S3 from the API (multipart to the API, then `storage.put`), so the phone's
// own link is not under this timeout, only the API's link to S3. The bound is a 10 MiB file
// (`upload_max_bytes`, 10,485,760). `remove` and `exists`, the purge's calls, keep 1,200 ms.
/** How long one `put` attempt may take, from its start to the answer's headers. */
export const S3_PUT_REQUEST_TIMEOUT_MS = 30_000;

export interface S3ClientOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export function createS3Client(options: S3ClientOptions): S3Client {
  return new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    requestHandler: {
      connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
      requestTimeout: S3_REQUEST_TIMEOUT_MS,
      throwOnRequestTimeout: true,
    },
    maxAttempts: S3_MAX_ATTEMPTS,
  });
}

export class S3StorageAdapter implements StoragePort {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(client: S3Client, bucket: string) {
    this.#client = client;
    this.#bucket = bucket;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertStorageKey(key);
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
      { requestTimeout: S3_PUT_REQUEST_TIMEOUT_MS },
    );
  }

  async temporaryLink(key: string, expiresInSeconds: number): Promise<string> {
    assertStorageKey(key);
    assertLinkLifetime(expiresInSeconds);
    return getSignedUrl(this.#client, new GetObjectCommand({ Bucket: this.#bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async remove(key: string): Promise<void> {
    assertStorageKey(key);
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    assertStorageKey(key);
    try {
      await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
      return true;
    } catch (error: unknown) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /** B46 (Q2 (a)): the object's bytes and content type, read by the server; rejects when absent. */
  async read(key: string): Promise<StoredObject> {
    assertStorageKey(key);
    const object = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
    );
    if (object.Body === undefined) throw new Error('The stored object has no body.');
    return {
      body: await object.Body.transformToByteArray(),
      contentType: object.ContentType ?? 'application/octet-stream',
    };
  }
}
