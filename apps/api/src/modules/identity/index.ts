// PUBLIC ENTRY of the identity module (T017). Other modules import this file and nothing below it (R-API-3).
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { NodeHandler } from '../../platform/web/route.js';
import { IdentityRepository } from './identity.repository.js';
import {
  PHOTOS_UPLOAD_PATH,
  type PhotoUploadDependencies,
  photoUploadRoute,
} from './photo-upload.controller.js';
import { UsersRepository } from './users.repository.js';
import { OtpCodesRepository } from './otp-codes.repository.js';
import { PushTokensRepository } from './push-tokens.repository.js';
import { UserSessionsRepository } from './user-sessions.repository.js';

/** The person an audit target names, for the admin module's read-time name (T021, R-108). */
export { readTargetPerson, type TargetPerson } from './identity.repository.js';

export { PHOTOS_UPLOAD_PATH };

/** `POST /uploads/photos`, over this module's repository (T024, R-API-6). */
export function createPhotoUploadRoute({
  database,
  ...dependencies
}: Omit<PhotoUploadDependencies, 'users'> & {
  readonly database: Pick<Database, 'user'>;
}): NodeHandler {
  return photoUploadRoute({ ...dependencies, users: new UsersRepository(database) });
}

/** The identity module's stores for the three purge sweeps (T025, FR-107, R-API-6). */
export function createPurgeStores(
  database: Pick<Database, 'otpCode' | 'devicePushToken' | 'userSession'>,
): {
  readonly otpCodes: OtpCodesRepository;
  readonly pushTokens: PushTokensRepository;
  readonly userSessions: UserSessionsRepository;
} {
  return {
    otpCodes: new OtpCodesRepository(database),
    pushTokens: new PushTokensRepository(database),
    userSessions: new UserSessionsRepository(database),
  };
}

/** The identity module's `_encrypted` columns, for the `reencrypt-columns` job (T155, R-API-6; the third since T013). */
export function createEncryptedColumns(
  database: Pick<Database, 'teacherProfile' | 'devicePushToken' | 'authIdentity'>,
): readonly EncryptedColumn[] {
  const repository = new IdentityRepository(database);
  return [
    repository.payoutAccountRefs(),
    repository.pushTokens(),
    repository.providerRefreshTokens(),
  ];
}
