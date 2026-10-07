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
import { assertLinkLifetime, assertStorageKey, type StoragePort } from './storage.port.js';

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
}
