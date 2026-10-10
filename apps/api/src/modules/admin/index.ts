// PUBLIC ENTRY of the admin module (T017). Other modules import this file and nothing below it (R-API-3).
// Only the three composition files may import it (R-API-4, T143): main.ts, worker.ts, admin.router.ts.
import type { AuditWriter } from '../../platform/audit/audit-writer.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { AuditRepository } from './audit.repository.js';
import { SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';

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
