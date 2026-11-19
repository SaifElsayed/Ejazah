// T116: what the remote implementation sends, read off a real client whose `send` is recorded and
// answered in memory. No network and no credential (SC-005).
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import {
  createS3Client,
  S3_CONNECTION_TIMEOUT_MS,
  S3_MAX_ATTEMPTS,
  S3_PUT_REQUEST_TIMEOUT_MS,
  S3_REQUEST_TIMEOUT_MS,
  S3StorageAdapter,
} from './s3.adapter.js';

function recorded(answer: (command: unknown) => Promise<unknown> = () => Promise.resolve({})): {
  client: S3Client;
  sent: unknown[];
} {
  const client = createS3Client({
    endpoint: 'http://127.0.0.1:9',
    region: 'eu-central-1',
    accessKeyId: 'adapter-test',
    secretAccessKey: 'adapter-test',
  });
  const sent: unknown[] = [];
  client.send = ((command: unknown) => {
    sent.push(command);
    return answer(command);
  }) as S3Client['send'];
  return { client, sent };
}

function failure(status: number, name: string): S3ServiceException {
  return new S3ServiceException({ name, $fault: 'client', $metadata: { httpStatusCode: status } });
}

describe('the remote storage (T116, FR-055)', () => {
  it('writes into the configured bucket with the content type and encryption at rest', async () => {
    const { client, sent } = recorded();
    await new S3StorageAdapter(client, 'documents').put(
      'certificates/a.pdf',
      new Uint8Array([1]),
      'application/pdf',
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect((sent[0] as PutObjectCommand).input).toMatchObject({
      Bucket: 'documents',
      Key: 'certificates/a.pdf',
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
    });
  });

  it('presigns a GET on the bucket and key, path-addressed, for the lifetime asked', async () => {
    const { client, sent } = recorded();
    const link = new URL(
      await new S3StorageAdapter(client, 'documents').temporaryLink('certificates/a.pdf', 900),
    );

    expect(link.origin).toBe('http://127.0.0.1:9');
    expect(link.pathname).toBe('/documents/certificates/a.pdf');
    expect(link.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(link.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(sent).toHaveLength(0);
  });

  it('reports absence on 404 and lets any other failure through', async () => {
    const absent = recorded(() => Promise.reject(failure(404, 'NotFound')));
    const forbidden = failure(403, 'Forbidden');
    const denied = recorded(() => Promise.reject(forbidden));

    expect(await new S3StorageAdapter(absent.client, 'documents').exists('a.pdf')).toBe(false);
    expect(absent.sent[0]).toBeInstanceOf(HeadObjectCommand);
    await expect(new S3StorageAdapter(denied.client, 'documents').exists('a.pdf')).rejects.toBe(
      forbidden,
    );
  });
});

// 002:T147 (M7): the built client's own configuration, read without a request. The HTTP handler
// resolves its options behind a promise it keeps privately (@smithy/node-http-handler 4.12.1), so
// the spec awaits that promise; the retry count is the client's resolved provider.
describe('the remote storage ends every call in bounded time (T147)', () => {
  const client = (): S3Client =>
    createS3Client({
      endpoint: 'http://127.0.0.1:9',
      region: 'eu-central-1',
      accessKeyId: 'adapter-test',
      secretAccessKey: 'adapter-test',
    });

  /** The handler's resolved options, as it applies them to every attempt. */
  async function handlerOptions(built: S3Client): Promise<Record<string, unknown>> {
    const handler = built.config.requestHandler as unknown as {
      readonly configProvider: Promise<Record<string, unknown>>;
    };
    return handler.configProvider;
  }

  it('abandons a connection and an attempt at their timeouts, and fails on the attempt’s rather than warn', async () => {
    const options = await handlerOptions(client());
    expect(options['connectionTimeout']).toBe(S3_CONNECTION_TIMEOUT_MS);
    expect(options['requestTimeout']).toBe(S3_REQUEST_TIMEOUT_MS);
    expect(options['throwOnRequestTimeout']).toBe(true);
  });

  it('makes S3_MAX_ATTEMPTS attempts at most, fewer than the SDK’s default three', async () => {
    expect(await client().config.maxAttempts()).toBe(S3_MAX_ATTEMPTS);
    expect(S3_MAX_ATTEMPTS).toBeLessThan(3);
  });

  it('keeps every attempt and the backoff inside the purge transaction’s 5 s, the row’s delete given its rest', () => {
    // Prisma's interactive transaction ends after 5,000 ms by default; `transaction.repository.ts`
    // sets no other. The SDK's standard retry waits at most 500 ms once (after throttling).
    const purgeTransactionMs = 5_000;
    const worstBackoffMs = 500;
    const rowDeleteShareMs = 300;
    expect(
      S3_MAX_ATTEMPTS * (S3_CONNECTION_TIMEOUT_MS + S3_REQUEST_TIMEOUT_MS) +
        (S3_MAX_ATTEMPTS - 1) * worstBackoffMs +
        rowDeleteShareMs,
    ).toBeLessThan(purgeTransactionMs);
  });

  // The owner's Q-A2 (a), 2026-11-19: an upload of up to 10 MiB takes longer than the client's
  // 1,200 ms, so `put` alone passes its own timeout with the call; `remove` and `exists`, the
  // purge's calls, keep the client's.
  it('gives a put its own 30 s, and leaves remove and exists on the client’s timeout', async () => {
    const options: unknown[] = [];
    const built = client();
    built.send = ((_command: unknown, callOptions?: unknown) => {
      options.push(callOptions);
      return Promise.resolve({});
    }) as S3Client['send'];
    const adapter = new S3StorageAdapter(built, 'documents');

    await adapter.put('documents/a.pdf', new Uint8Array([1]), 'application/pdf');
    await adapter.remove('documents/a.pdf');
    await adapter.exists('documents/a.pdf');

    expect(S3_PUT_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(options).toEqual([{ requestTimeout: S3_PUT_REQUEST_TIMEOUT_MS }, undefined, undefined]);
  });
});
