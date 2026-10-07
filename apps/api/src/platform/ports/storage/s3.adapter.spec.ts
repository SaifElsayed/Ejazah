// T116: what the remote implementation sends, read off a real client whose `send` is recorded and
// answered in memory. No network and no credential (SC-005).
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { createS3Client, S3StorageAdapter } from './s3.adapter.js';

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
