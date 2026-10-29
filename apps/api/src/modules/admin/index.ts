// PUBLIC ENTRY of the admin module (T017). Other modules import this file and nothing below it (R-API-3).
// Only the three composition files may import it (R-API-4, T143): main.ts, worker.ts, admin.router.ts.
import type { AuditWriter } from '../../platform/audit/audit-writer.js';
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import {
  createCredentialReviewService,
  type CredentialReviewService,
  readCredentialQueue,
  revokeSubjects,
} from '../catalog/index.js';
import {
  AccountConsequences,
  readApplicationQueue,
  StandingService,
  standingStoreOver,
} from '../identity/index.js';
import {
  type ApplicationReviewService,
  createVerificationAdminServices,
  openRequestOf,
  type VerificationRequestService,
} from '../verification/index.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminInvites, type AdminInviteDependencies } from './admin-invite.js';
import { AdminSessionService, type AdminSessionDependencies } from './admin-session.service.js';
import { AdminSessionsRepository } from './admin-sessions.repository.js';
import { AdminUsersRepository } from './admin-users.repository.js';
import { type AdminInviteQueue, AdminsService } from './admins.service.js';
import { AuditQueryService } from './audit-query.service.js';
import { AuditRepository } from './audit.repository.js';
import { HomeService } from './home.service.js';
import { SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';

/** The four namespaces of the administrator surface, mounted by `admin.router.ts` (T067). */
export { adminsRouter } from './admins.router.js';
export { auditRouter } from './audit.router.js';
export { authRouter } from './auth.router.js';
export { homeRouter } from './home.router.js';

/** The administrator's session resolver, bound by `main.ts` for the HTTP application (T066). */
export { resolveAdminSession, type ResolvedAdminSession } from './admin-session.service.js';
export type { AdminInviteQueue, SignInNextStep };

type SignInNextStep = Awaited<ReturnType<AdminAuthService['signIn']>>['next'];

/**
 * The admin module's services, for the administrator surface's routers (T066, T067). `main.ts` binds
 * them to the surface's port (`AdminSurfaceServices` in `surfaces/context.ts`), which this module
 * may not name; a drift between the two fails that binding at type-check time.
 */
export interface AdminServices {
  readonly auth: Pick<
    AdminAuthService,
    'signIn' | 'verifyMfa' | 'recover' | 'beginSetup' | 'confirmSetup' | 'setPassword'
  >;
  readonly sessions: Pick<AdminSessionService, 'signOut'>;
  readonly admins: Pick<
    AdminsService,
    'me' | 'list' | 'add' | 'disable' | 'resetMfa' | 'regenerateRecoveryCodes'
  >;
  readonly audit: Pick<AuditQueryService, 'list' | 'get'>;
  readonly home: Pick<HomeService, 'summary'>;
  /** The catalog module's credential review, composed here for the surface (T069). */
  readonly credentials: Pick<
    CredentialReviewService,
    'list' | 'get' | 'approve' | 'reject' | 'requestDocument' | 'correct'
  >;
  /** The verification module's review and identity requests, and identity's standing (T068). */
  readonly applications: Pick<
    ApplicationReviewService,
    'list' | 'get' | 'recordCall' | 'approve' | 'reject' | 'requestInfo' | 'ban'
  >;
  readonly documents: Pick<
    VerificationRequestService,
    'link' | 'requireIdentity' | 'accept' | 'requestAnother'
  >;
  readonly teachers: Pick<StandingService, 'suspend' | 'revokeApproval' | 'ban' | 'reinstate'>;
}

export interface AdminServiceDependencies extends AdminSessionDependencies {
  readonly encryptionKey: string;
  readonly inviteQueue: AdminInviteQueue;
  /** For the document viewer's signed links (T068). */
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
  /** The one registry of an account's end (FR-142), shared with the identity module's deletion (B16). */
  readonly consequences?: AccountConsequences;
}

export function createAdminServices(dependencies: AdminServiceDependencies): AdminServices {
  const sessions = new AdminSessionService(dependencies);
  const audit = new AuditQueryService(dependencies);
  // One registry for every action that ends an account (FR-142); Phase 2 and 3 subscribe to it.
  const standing = new StandingService({
    store: standingStoreOver(dependencies.database),
    consequences: dependencies.consequences ?? new AccountConsequences(),
    revokeSubjects,
    // A reinstatement lands on `verification_required` while verification's request is open (T113).
    hasOpenIdentityRequest: async (tx, userId) => (await openRequestOf(tx, userId)) !== null,
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  });
  return {
    auth: new AdminAuthService({ ...dependencies, sessions }),
    sessions,
    admins: new AdminsService({ ...dependencies, sessions }),
    audit,
    // The home's two queues are the identity and catalog modules' tables, read through their
    // entries on the call's transaction (T065, R-API-6).
    home: new HomeService({
      ...dependencies,
      audit,
      queues: { applications: readApplicationQueue, credentials: readCredentialQueue },
    }),
    credentials: createCredentialReviewService(dependencies),
    ...createVerificationAdminServices({ ...dependencies, standing }),
    teachers: standing,
  };
}

/** The invites `deliver-admin-invite` sends, handed to the job by `worker.ts` (T066, R-110). */
export function createAdminInvites(dependencies: AdminInviteDependencies): AdminInvites {
  return new AdminInvites(dependencies);
}

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
