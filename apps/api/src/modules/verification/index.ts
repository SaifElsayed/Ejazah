// PUBLIC ENTRY of the verification module (T017). Other modules import this file and nothing below it (R-API-3).
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import { VerificationRepository } from './verification.repository.js';

/** The verification module's `_encrypted` column, for the `reencrypt-columns` job (T155, R-API-6). */
export function createEncryptedColumns(
  database: Pick<Database, 'verificationDocument'>,
): readonly EncryptedColumn[] {
  return [new VerificationRepository(database).documentStorageKeys()];
}
