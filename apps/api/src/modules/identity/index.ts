// PUBLIC ENTRY of the identity module (T017). Other modules import this file and nothing below it (R-API-3).
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { NodeHandler } from '../../platform/web/route.js';
import type { EmailPort } from '../../platform/ports/email/email.port.js';
import type { SignInPort } from '../../platform/ports/sign-in/sign-in.port.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import type { SingleUseMarks } from '../../platform/redis/single-use-marks.js';
import { AccountService } from './account.service.js';
import { EmailAuthService } from './email-auth.service.js';
import { AccountsRepository, IdentityRepository } from './identity.repository.js';
import { OnboardingService } from './onboarding.service.js';
import { OneTimeCodes, type WarningLog } from './one-time-codes.js';
import { SignInService } from './sign-in.service.js';
import {
  PHOTOS_UPLOAD_PATH,
  type PhotoUploadDependencies,
  photoUploadRoute,
} from './photo-upload.controller.js';
import { UsersRepository } from './users.repository.js';
import { OtpCodesRepository } from './otp-codes.repository.js';
import { PushTokensRepository } from './push-tokens.repository.js';
import {
  type IdentityDependencies,
  type ResolvedUserSession,
  type RevokeAllOptions,
  SessionService,
} from './session.service.js';
import { type SessionRevokedReason, UserSessionsRepository } from './user-sessions.repository.js';

/** The module's three namespaces of the user surface (T048, T049), mounted by `app.router.ts`. */
export { accountRouter } from './account.router.js';
export { authRouter } from './auth.router.js';
export { onboardingRouter } from './onboarding.router.js';

/**
 * What the module's routers call, carried by every request in `AppServices.identity` (T048): each
 * service narrowed to the methods a procedure reaches.
 */
export interface IdentityServices {
  readonly sessions: Pick<SessionService, 'refresh' | 'signOut'>;
  readonly signIn: Pick<SignInService, 'providerNonce' | 'signInWithProvider'>;
  readonly emailAuth: Pick<
    EmailAuthService,
    'requestSignUpCode' | 'verifySignUpCode' | 'signIn' | 'requestPasswordReset' | 'resetPassword'
  >;
  readonly onboarding: Pick<OnboardingService, 'requestEmailCode' | 'complete'>;
  readonly account: Pick<
    AccountService,
    'me' | 'updateProfile' | 'setLanguage' | 'setTimezone' | 'reportDeviceTimezone'
  >;
}

/** What the module's services are built over, bound once by `main.ts`. */
export interface IdentityServiceDependencies extends IdentityDependencies {
  /** The single-use marks in Redis: nonces and onboarding tokens (`platform/redis`). */
  readonly marks: SingleUseMarks;
  readonly signIn: SignInPort;
  readonly email: EmailPort;
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
  /** Where a mail that could not be handed over is reported, never awaited by the request. */
  readonly log: WarningLog;
}

/** The module's services over one set of dependencies (T048; the composition the specs use). */
export function createIdentityServices({
  marks,
  signIn: signInPort,
  email,
  storage,
  log,
  ...base
}: IdentityServiceDependencies): IdentityServices {
  const sessions = new SessionService(base);
  const codes = new OneTimeCodes({ ...base, email, log });
  const onboarding = new OnboardingService({ ...base, marks, sessions, codes });
  return {
    sessions,
    signIn: new SignInService({ ...base, marks, signIn: signInPort, onboarding, sessions }),
    emailAuth: new EmailAuthService({ ...base, codes, onboarding, sessions }),
    onboarding,
    account: new AccountService({ ...base, storage }),
  };
}

/**
 * The teacher's application, a state of this module's `teacher_profiles` row, as the verification
 * module reads and moves it on its own transaction (T056, data-model §3, R-121).
 */
export {
  type ApplicationChange,
  type ApplicationRecord,
  type ApplicationStatus,
  readApplication,
  setApplication,
} from './identity.service.js';

/** The person an audit target names, for the admin module's read-time name (T021, R-108). */
export { readTargetPerson, type TargetPerson } from './identity.repository.js';

export { PHOTOS_UPLOAD_PATH };

export type { IdentityDependencies, ResolvedUserSession, RevokeAllOptions, SessionRevokedReason };

/**
 * The user surface's session resolver (T047, data-model §6): the session a bearer points at and the
 * account's standing, read on every request, or null for a token it does not accept. `main.ts`
 * binds it in place of the stand-in resolver (B10, with the routers).
 */
export function resolveUserSession(
  dependencies: IdentityDependencies,
): (bearer: string) => Promise<ResolvedUserSession | null> {
  const sessions = new SessionService(dependencies);
  return (bearer) => sessions.resolveUserSession(bearer);
}

/**
 * Revokes every live session of a person (T047, FR-135): deletion, ban, suspension and an
 * administrator's action call it, inside their own transaction when they hand one in.
 */
export function revokeAll(
  dependencies: IdentityDependencies,
): (userId: string, reason: SessionRevokedReason, options?: RevokeAllOptions) => Promise<number> {
  const sessions = new SessionService(dependencies);
  return (userId, reason, options) => sessions.revokeAll(userId, reason, options);
}

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
  database: Pick<
    Database,
    'otpCode' | 'devicePushToken' | 'userSession' | 'userSessionRetiredToken'
  >,
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

/**
 * The documents this module's rows point at, `teacher_profiles.identity_document_id`, for the
 * verification module's unreferenced documents (T093, R-API-6).
 */
export function createDocumentReferences(database: Database): {
  referencedAmong(documentIds: readonly string[]): Promise<ReadonlySet<string>>;
} {
  const accounts = new AccountsRepository(database);
  return { referencedAmong: (documentIds) => accounts.identityDocumentsAmong(documentIds) };
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
