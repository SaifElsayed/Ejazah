// T116: the implementation is chosen by STORAGE_DRIVER from the loaded configuration (FR-055).
import { describe, expect, it } from 'vitest';
import { createStoragePort, type StorageConfig } from './index.js';
import { LocalStorageAdapter } from './local.adapter.js';
import { S3StorageAdapter } from './s3.adapter.js';

const base: StorageConfig = {
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_ROOT: '.storage',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

const s3Values = {
  S3_ENDPOINT: 'http://127.0.0.1:9',
  S3_BUCKET: 'documents',
  S3_REGION: 'eu-central-1',
  S3_ACCESS_KEY_ID: 'selection-test',
  S3_SECRET_ACCESS_KEY: 'selection-test',
};

describe('storage selection (T116, FR-055)', () => {
  it('serves local storage when STORAGE_DRIVER is local, whatever S3 values are present', () => {
    expect(createStoragePort(base)).toBeInstanceOf(LocalStorageAdapter);
    expect(createStoragePort({ ...base, ...s3Values })).toBeInstanceOf(LocalStorageAdapter);
  });

  it('hands local storage API_PUBLIC_ORIGIN, so its links are absolute (T095)', async () => {
    const storage = createStoragePort({ ...base, API_PUBLIC_ORIGIN: 'http://localhost:3000' });
    await expect(storage.temporaryLink('documents/a.pdf', 60)).resolves.toMatch(
      /^http:\/\/localhost:3000\/files\/documents\/a\.pdf\?/,
    );
  });

  it('serves remote storage when STORAGE_DRIVER is s3', () => {
    expect(createStoragePort({ ...base, ...s3Values, STORAGE_DRIVER: 's3' })).toBeInstanceOf(
      S3StorageAdapter,
    );
  });

  it('refuses s3 with a value missing, which the configuration schema refuses first', () => {
    expect(() =>
      createStoragePort({ ...base, ...s3Values, STORAGE_DRIVER: 's3', S3_BUCKET: undefined }),
    ).toThrow('STORAGE_DRIVER=s3 needs every S3 value.');
  });
});
