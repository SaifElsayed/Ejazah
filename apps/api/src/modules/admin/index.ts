// PUBLIC ENTRY of the admin module (T017). Other modules import this file and nothing below it (R-API-3).
// Only the three composition files may import it (R-API-4, T143): main.ts, worker.ts, admin.router.ts.
import type { AuditWriter } from '../../platform/audit/audit-writer.js';
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { AdminSessionsRepository } from './admin-sessions.repository.js';
import { AdminUsersRepository } from './admin-users.repository.js';
import { AuditRepository } from './audit.repository.js';
import { SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';

/** The audit label's read-time name and the Arabic of the moved catalogue keys (T021, R-108). */
export { resolveTargetName, arabic as auditArabic, withLam } from './labels/target-name.js';
export { type AuditTargetType, targetLabel } from './labels/target-label.js';

/** The admin module's settings reader over the `settings` table, for the kernel to read through (T113). */
export function createSettingsReader(database: Database): SettingsReader {
  return new SettingsService(new SettingsRepository(database));
}

/**
 * The admin module's audit writer over `audit_logs`, for the administrator caller kind (T108). It
 * holds no client: each write runs on the action's own transaction.
 */
export function createAuditWriter(): AuditWriter {
  return new AuditRepository();
}

/** The admin module's `admin_sessions` store, for the `purge-expired-sessions` sweep (T025, R-API-6). */
export function createAdminSessionPurgeStore(
  database: Pick<Database, 'adminSession'>,
): AdminSessionsRepository {
  return new AdminSessionsRepository(database);
}

/** The admin module's `_encrypted` column, for the `reencrypt-columns` job (T155, R-API-6). */
export function createEncryptedColumns(
  database: Pick<Database, 'adminUser'>,
): readonly EncryptedColumn[] {
  return [new AdminUsersRepository(database).mfaSecrets()];
}
