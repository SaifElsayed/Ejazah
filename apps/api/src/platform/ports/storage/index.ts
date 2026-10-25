// T116: the storage port's entry. Which implementation serves it is configuration, never a code
// change (FR-055, FR-056): `STORAGE_DRIVER` from the loaded configuration picks local or remote.
// T121 binds the result to the port's token in `ports.module.ts`; nothing else names an adapter.
import type { Config } from '../../config/config.module.js';
import { deriveLinkKey, LocalStorageAdapter } from './local.adapter.js';
import { createS3Client, S3StorageAdapter } from './s3.adapter.js';
import type { StoragePort } from './storage.port.js';

export { MAX_LINK_SECONDS, type StoragePort } from './storage.port.js';

export type StorageConfig = Pick<
  Config,
  | 'STORAGE_DRIVER'
  | 'STORAGE_LOCAL_ROOT'
  | 'API_PUBLIC_ORIGIN'
  | 'ENCRYPTION_KEY'
  | 'S3_ENDPOINT'
  | 'S3_BUCKET'
  | 'S3_REGION'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY'
>;

export function createStoragePort(config: StorageConfig): StoragePort {
  if (config.STORAGE_DRIVER === 'local') {
    return new LocalStorageAdapter({
      root: config.STORAGE_LOCAL_ROOT,
      linkKey: deriveLinkKey(config.ENCRYPTION_KEY),
      ...(config.API_PUBLIC_ORIGIN === undefined ? {} : { origin: config.API_PUBLIC_ORIGIN }),
    });
  }
  const { S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = config;
  // The configuration schema already refuses STORAGE_DRIVER=s3 with any of these unset (T015).
  if (
    S3_ENDPOINT === undefined ||
    S3_BUCKET === undefined ||
    S3_REGION === undefined ||
    S3_ACCESS_KEY_ID === undefined ||
    S3_SECRET_ACCESS_KEY === undefined
  ) {
    throw new Error('STORAGE_DRIVER=s3 needs every S3 value.');
  }
  return new S3StorageAdapter(
    createS3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    }),
    S3_BUCKET,
  );
}
