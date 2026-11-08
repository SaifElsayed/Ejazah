// PUBLIC ENTRY of the identity module (T017). Other modules import this file and nothing below it (R-API-3).
import type { ColumnCipher, EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { NodeHandler } from '../../platform/web/route.js';
import type { EmailPort } from '../../platform/ports/email/email.port.js';
import type { PaymentPort } from '../../platform/ports/payment/payment.port.js';
import type { SignInPort } from '../../platform/ports/sign-in/sign-in.port.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import type { SingleUseMarks } from '../../platform/redis/single-use-marks.js';
import { AccountService } from './account.service.js';
import { EmailAuthService } from './email-auth.service.js';
import {
  AccountsRepository,
  DeletedPhotosRepository,
  type HeldPhoto,
  IdentityRepository,
} from './identity.repository.js';
import { OnboardingService } from './onboarding.service.js';
import type { AccountConsequences } from './consequences.js';
import { DeletionService, type FileErasure, type FileHold } from './deletion.service.js';
import { OneTimeCodes, type WarningLog } from './one-time-codes.js';
import { PayoutService } from './payout.service.js';
import { SignInService } from './sign-in.service.js';
import {
  type TeacherProfileDependencies,
  TeacherProfileService,
} from './teacher-profile.service.js';
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
/** The web deletion pages (T083), mounted with the public pages by `main.ts`. */
export {
  type DeleteAccountRouteDependencies,
  deleteAccountRoutes,
} from './web/delete-account.controller.js';
/** `teacher.payout` (T077), mounted under `teacher` by `app.router.ts`. */
export { payoutRouter } from './payout.router.js';
/** `teacher.profile` (T017), mounted under `teacher` by `app.router.ts`. */
export { teacherProfileRouter } from './teacher-profile.router.js';

/**
 * `teacher.profile.*`'s service, carried by every request in `AppServices.teacherProfile` (T017,
 * FR-310): built once by `main.ts` over the database, the settings and the storage port's links.
 */
export type TeacherProfileServices = Pick<TeacherProfileService, 'get' | 'update'>;

export function createTeacherProfileService(
  dependencies: TeacherProfileDependencies,
): TeacherProfileServices {
  return new TeacherProfileService(dependencies);
}

/**
 * The payments module's two entries for a signed recipient event, on its transaction, and the hash
 * that routes the event to its teacher (T077, R-114, R-121: payments calls identity, never back).
 */
export {
  lockPayoutHolder,
  markPayoutRejected,
  markPayoutVerified,
  payoutRefHash,
} from './payout.service.js';

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
  readonly payout: Pick<PayoutService, 'get' | 'register'>;
  /** `account.delete` and the web deletion pages (T082, T083). */
  readonly deletion: Pick<
    DeletionService,
    'deleteAccount' | 'requestWebCode' | 'confirmWebDeletion'
  >;
}

/** What the module's services are built over, bound once by `main.ts`. */
export interface IdentityServiceDependencies extends IdentityDependencies {
  /**
   * The process's column cipher (`createColumnCipher`): onboarding's and deletion's Apple grant, read
   * under the previous key too while a rotation runs (T134).
   */
  readonly cipher: Pick<ColumnCipher, 'encrypt' | 'decrypt'>;
  /** The single-use marks in Redis: nonces and onboarding tokens (`platform/redis`). */
  readonly marks: SingleUseMarks;
  readonly signIn: SignInPort;
  readonly email: EmailPort;
  /** Photo links (T049) and, after a deletion's commit, the photo's removal (T082). */
  readonly storage: Pick<StoragePort, 'temporaryLink' | 'remove'>;
  /** Where a mail that could not be handed over is reported, never awaited by the request. */
  readonly log: WarningLog;
  /** Payout setup registers the recipient through the port (T077). */
  readonly payment: Pick<PaymentPort, 'registerPayoutRecipient'>;
  /** `teacher.payout.register` and `account.delete` are keyed (FR-106). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  /** The one registry of an account's end, shared with the admin module (FR-142, B16). */
  readonly consequences: AccountConsequences;
  /** The other modules' files of a deleted person, removed after the commit (B16, decision 1). */
  readonly fileErasures?: readonly FileErasure[];
  /**
   * Whether an open matter holds a deleted person's files (T004 of specs/004-sessions, FR-487):
   * booking's `heldFileOwnersAmong`, bound by `main.ts`; none held when absent.
   */
  readonly fileHold?: FileHold;
  /** Where a failure after a deletion's commit is reported; the error tracker unless given. */
  readonly report?: (error: unknown) => void;
}

/** The module's services over one set of dependencies (T048; the composition the specs use). */
export function createIdentityServices({
  cipher,
  marks,
  signIn: signInPort,
  email,
  storage,
  log,
  payment,
  idempotency,
  consequences,
  fileErasures,
  fileHold,
  report,
  ...base
}: IdentityServiceDependencies): IdentityServices {
  const sessions = new SessionService(base);
  const codes = new OneTimeCodes({ ...base, email, log });
  const onboarding = new OnboardingService({ ...base, cipher, marks, sessions, codes });
  return {
    sessions,
    signIn: new SignInService({ ...base, marks, signIn: signInPort, onboarding, sessions }),
    emailAuth: new EmailAuthService({ ...base, codes, onboarding, sessions }),
    onboarding,
    account: new AccountService({ ...base, storage }),
    payout: new PayoutService({ ...base, payment, idempotency }),
    deletion: new DeletionService({
      ...base,
      cipher,
      consequences,
      marks,
      signIn: signInPort,
      email,
      storage,
      idempotency,
      codes,
      log,
      fileErasures,
      fileHold,
      report,
    }),
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

/**
 * The admin home's applications card, counted on the administrator's transaction (T065, R-API-6);
 * whether a teacher is approved, for the credential review (T069).
 */
export { isApprovedTeacher, readApplicationQueue } from './application.repository.js';

/**
 * The applications queue and its decisions, read and written by the verification module's review
 * on the administrator's transaction (T068, R-121): the applicants' rows and detail, the call record,
 * the approval, the rejection and the request for information.
 */
export {
  type ApplicantDetail,
  type ApplicantRow,
  type ApplicantsFilter,
  type ApplicantStatus,
  applicantsCount,
  applicantsPage,
  readApplicant,
} from './applicants.repository.js';
export {
  type CallRecord,
  decideApplication,
  lockApplication,
  recordApplicationCall,
} from './application.repository.js';

/**
 * A person's standing as the administrator changes it (T068, FR-165, FR-166): the service, its store
 * over this module's tables, and the one consequences entry Phase 2 and 3 subscribe to (FR-142).
 */
export {
  AccountConsequences,
  type AccountConsequence,
  type TerminationCause,
} from './consequences.js';
export {
  StandingService,
  type StandingDependencies,
  type StandingStore,
  standingStoreOver,
} from './standing.service.js';
/** The account's row lock, taken first by verification's identity request (T126). */
export { lockAccount, readStanding } from './standing.repository.js';
/** The account's zone on the caller's transaction, a teacher's new slot's (T019, FR-313). */
export { accountTimezone } from './users.repository.js';
/** The display names of some accounts, for booking's lists (003:T049, FR-390, FR-391, FR-395). */
export { displayNamesOf } from './users.repository.js';
/** A session's parties' gender, standing, approval and name, for sessions' read and join (T011 of specs/004-sessions). */
export { type SessionPartyRecord, sessionPartiesOf } from './users.repository.js';

/**
 * The visibility predicate (T010, `002:T143`, SRS §3.7.1, R-201): the only way any module learns
 * which teachers a student may see, each on the caller's transaction. `visibleTeachers` and
 * `visibleTeacherPage` take the requester's gender; `isBookablePair` serves the confirm job, which
 * has no request, and answers a boolean. `isPublishedTeacher` is a teacher's own `published`, the
 * profile's and the packages' (T017, T018).
 */
export {
  isBookablePair,
  isPublishedTeacher,
  type TeacherPageCursor,
  type TeacherPageQuery,
  type VisibilityPurpose,
  type VisibleTeacher,
  visibleTeacherPage,
  visibleTeachers,
} from './visible-teachers.repository.js';

/** The administrator surface's `teachers` namespace (T068), mounted by `admin.router.ts`. */
export { teachersRouter } from './teachers.router.js';
/** The administrator surface's `students` namespace (T005 of specs/004-sessions), mounted there too. */
export { studentsRouter } from './students.router.js';

/** The person an audit target names, for the admin module's read-time name (T021, R-108). */
export { readTargetPerson, type TargetPerson } from './identity.repository.js';

/** The administrator's invite mail, which the admin module sends through its job (T066, R-110). */
export { renderAdminInviteMail } from './mail/admin-invite-mail.js';

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

/** A file the deletion leaves to the `erase-deleted-files` sweep, and the deletion's file erasure (B16). */
export type { FileErasure, FileHold, HeldPhoto };

/**
 * Deleted people's photo keys still held, for the `erase-deleted-files` sweep (B16, decision 1): a
 * page of them in id order, and the key cleared once its file is gone (R-API-6).
 */
export function createErasedPhotos(database: Pick<Database, 'includeDeleted'>): {
  pendingPage(after: string | undefined, limit: number): Promise<readonly HeldPhoto[]>;
  clearKey(photo: HeldPhoto): Promise<boolean>;
} {
  const photos = new DeletedPhotosRepository(database);
  return {
    pendingPage: (after, limit) => photos.heldPage(after, limit),
    clearKey: (photo) => photos.clear(photo),
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
