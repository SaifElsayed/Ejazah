// PUBLIC ENTRY of the identity module (T017). Other modules import this file and nothing below it (R-API-3).
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import { IdentityRepository } from './identity.repository.js';

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
