// PUBLIC ENTRY of the identity module (T017). Other modules import this file and nothing below it (R-API-3).
import type { ColumnCipher, EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { LiveBus } from '../../platform/live/live-bus.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { NodeHandler } from '../../platform/web/route.js';
import type { EmailPort } from '../../platform/ports/email/email.port.js';
import type { PaymentPort } from '../../platform/ports/payment/payment.port.js';
import type { SignInPort } from '../../platform/ports/sign-in/sign-in.port.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import type { SingleUseMarks } from '../../platform/redis/single-use-marks.js';
import { AccountService } from './account.service.js';
import {
  type CertificateNameDependencies,
  CertificateNameService,
  certificateNameStoreOver,
} from './certificate-name.service.js';
import { EmailAuthService } from './email-auth.service.js';
import {
  AccountsRepository,
  DeletedPhotosRepository,
  type HeldPhoto,
  IdentityRepository,
} from './identity.repository.js';
import { OnboardingService } from './onboarding.service.js';
import type { AccountConsequences } from './consequences.js';
import {
  type DeletionLog,
  DeletionService,
  type FileErasure,
  type FileHold,
  // T080 of specs/004-sessions: the count's port, bound by `main.ts`.
  type OngoingEnrollments,
} from './deletion.service.js';
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
import { PushRecipientsService } from './push-recipients.service.js';
import { DeviceTokensRepository, PushTokensRepository } from './push-tokens.repository.js';
import { PushTokenService } from './push-tokens.service.js';
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
    // T081 of specs/004-sessions: `users.delete`, handed to the admin services by `main.ts`.
    'deleteAccount' | 'requestWebCode' | 'confirmWebDeletion' | 'deleteByAdministrator'
  >;
  /**
   * T004 of specs/005-certification (FR-602): `account.certificateName.set`, and
   * `users.setCertificateName`, handed to the admin services by `main.ts`.
   */
  readonly certificateName: CertificateNames;
  /** T005 of specs/005-certification (FR-620, R-405): `account.pushToken.register` and `.remove`. */
  readonly pushTokens: Pick<PushTokenService, 'register' | 'remove'>;
}

/** T077: the logger's `info`, where the log handed in has one. */
function infoLogOf(log: WarningLog): { readonly log?: Pick<Logger, 'info'> } {
  return 'info' in log && typeof log.info === 'function'
    ? { log: log as WarningLog & Pick<Logger, 'info'> }
    : {};
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
  /**
   * Where a mail that could not be handed over is reported, never awaited by the request; and
   * (T080 of specs/004-sessions) a refused deletion's one info line.
   */
  readonly log: DeletionLog;
  /** Payout setup registers the recipient through the port (T077). */
  readonly payment: Pick<PaymentPort, 'registerPayoutRecipient'>;
  /**
   * `teacher.payout.register` and `account.delete` are keyed (FR-106); T081's `users.delete` on
   * the administrator kind's transaction (`runOn`).
   */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run' | 'runOn'>;
  /** The one registry of an account's end, shared with the admin module (FR-142, B16). */
  readonly consequences: AccountConsequences;
  /** The other modules' files of a deleted person, removed after the commit (B16, decision 1). */
  readonly fileErasures?: readonly FileErasure[];
  /**
   * Whether an open matter holds a deleted person's files (T004 of specs/004-sessions, FR-487):
   * booking's `heldFileOwnersAmong`, bound by `main.ts`; none held when absent.
   */
  readonly fileHold?: FileHold;
  /**
   * T080 of specs/004-sessions (FR-511; the note under T080, Q-R11 (a)): whether an account has an
   * ongoing enrollment, on the deletion's transaction: booking's `createOngoingEnrollments`, bound
   * by `main.ts` as `fileHold` is.
   */
  readonly ongoingEnrollments: OngoingEnrollments;
  /** Where a failure after a deletion's commit is reported; the error tracker unless given. */
  readonly report?: (error: unknown) => void;
  /**
   * The process's live bus (T063 of specs/004-sessions): a deleted person's `account`, sent after the
   * deletion's commit, ends their live streams. Bound by `main.ts`.
   */
  readonly live?: Pick<LiveBus, 'publish'>;
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
  ongoingEnrollments,
  report,
  live,
  ...base
}: IdentityServiceDependencies): Omit<IdentityServices, 'certificateName'> {
  const sessions = new SessionService(base);
  const codes = new OneTimeCodes({ ...base, email, log });
  const onboarding = new OnboardingService({ ...base, cipher, marks, sessions, codes });
  return {
    sessions,
    signIn: new SignInService({ ...base, marks, signIn: signInPort, onboarding, sessions }),
    emailAuth: new EmailAuthService({ ...base, codes, onboarding, sessions }),
    onboarding,
    account: new AccountService({ ...base, storage }),
    // T077 of specs/004-sessions (Q-E (a)): the registration's `payout_kept_match` line, where the
    // logger handed in answers `info` (the process's does; a spec's warning log may not).
    payout: new PayoutService({ ...base, payment, idempotency, ...infoLogOf(log) }),
    // T005 of specs/005-certification: the phone's push token, encrypted with the process's cipher.
    // #145 r1 Minor 1: a token moved from another account is logged where the log answers `info`.
    pushTokens: new PushTokenService({
      devices: new DeviceTokensRepository(base.database),
      cipher,
      ...infoLogOf(log),
      ...(base.now === undefined ? {} : { now: base.now }),
    }),
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
      ongoingEnrollments,
      report,
      ...(live === undefined ? {} : { live }),
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
 * T058 of specs/004-sessions (FR-481, SRS FR-ADMIN-4; the owner's decision Q8 of 2026-11-12): the
 * user directory's two readers for verification's `users.list` and `users.get`, deleted users
 * included through `includeDeleted`, outside any transaction.
 */
export {
  type DirectoryUser,
  userDirectoryPage,
  userRecordOf,
  type UserRecordRow,
} from './users.repository.js';

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

/**
 * T076 of specs/004-sessions (FR-508): whether a teacher was ever approved, read by verification's
 * `documentErasureConsequence` on the deletion's transaction (R-121).
 */
export { everApprovedTeacher } from './identity.repository.js';

/**
 * T077 of specs/004-sessions (FR-509; SRS FR-ADMIN-21; the note under T077, Q-R3 (a)): a deleted
 * teacher's kept profile, read, dated and erased by verification's kept-data service and the
 * `erase-kept-data` sweep on their transaction (R-121), and the payout match `users.get` answers.
 */
export {
  eraseKeptProfile,
  type KeptProfile,
  keptProfileOf,
  keptProfilesDue,
  setKeptEraseDate,
} from './identity.repository.js';
export { payoutKeptOnDeletedTeacher } from './payout.repository.js';

/**
 * 003:T101 (ADR 0025 D2, SRS DEC-80; Q-B2 (a)): the teacher's verified payout recipient, which the
 * payments module's checkout splits the teacher's share to.
 */
export { payoutRecipientOf } from './payout.repository.js';

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
 * T080 of specs/004-sessions (FR-511; the note under T080, Q-R11 (a)): the port booking's count is
 * bound to in `main.ts`, and the deletion's log (a refusal's info line).
 */
export type { DeletionLog, OngoingEnrollments };
/**
 * T081 of specs/004-sessions (FR-512; SRS FR-ADMIN-22): the administrator's deletion the admin
 * module composes into `users.delete`, filled by `main.ts` with the identity services' `deletion`.
 */
export type AdministratorDeletion = Pick<DeletionService, 'deleteByAdministrator'>;

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

/**
 * T040 of specs/004-sessions (spec FR-487; research R-327, «The administrator's read», item 4): a
 * deleted person's photo while its key is still held, for verification's `createDisputeHeldFiles()`
 * alone, over the repository the erase sweep reads (`DeletedPhotosRepository`); past the
 * soft-delete filter, so outside any transaction (the note under T040, F6). Null for a live person
 * or a photo already removed.
 */
export function createHeldPhotos(database: Pick<Database, 'includeDeleted'>): {
  heldPhotoOf(userId: string): Promise<HeldPhoto | null>;
} {
  const photos = new DeletedPhotosRepository(database);
  return { heldPhotoOf: (userId) => photos.heldOf(userId) };
}

/**
 * T004 of specs/005-certification (FR-602; ADR 0019 D1; research R-411; the note under T004, Q4 (a)):
 * the student's certificate name, `account.certificateName.set` and `users.setCertificateName`.
 * Identity imports no module (`docs/ARCHITECTURE.md:183`), so the student's requests waiting for the
 * name are released through the port `AwaitingNameRelease`, which `main.ts` hands in: a no-op until
 * T006, then certification's entry (`docs/ARCHITECTURE.md:197`, a dependency against the arrows).
 */
export type { AwaitingNameRelease } from './certificate-name.service.js';
export type CertificateNames = Pick<CertificateNameService, 'setOwn' | 'setByAdministrator'>;

/**
 * T004: the certificate-name service over this module's repository, built once by `main.ts` with the
 * process's idempotency (`run` for the student's own, `runOn` for the administrator's), its logger,
 * and the port.
 */
export function createCertificateNameService(
  dependencies: Omit<CertificateNameDependencies, 'store'>,
): CertificateNames {
  return new CertificateNameService({ ...dependencies, store: certificateNameStoreOver() });
}

// ---------------------------------------------------------------------------------------------
// T003 of specs/005-certification, the owner's Q16 (b): the teacher's signature is stored without its
// metadata through the photo's own strip (T145), in a turn of the one `PhotoTurns` the process hands
// both routes (T073's one-image memory bound), so catalog's signature route forks neither.
export { withoutMetadata as imageWithoutMetadata } from './photo-upload.controller.js';
export { PhotoTurns } from './photo-turns.js';

/**
 * T005 of specs/005-certification (FR-620, FR-621; R-405, R-406; the review session's answer Q-E1-1
 * (b)): identity's `PushRecipients`, the store `deliver-notification` declares, bound by `worker.ts`
 * with the process's cipher: a user's tokens decrypted with their platforms and `preferred_language`
 * (null for a deleted user), and the removal of the tokens the provider no longer accepts, matched
 * by `token_hash`. ⚠️ The removal is automatic and final.
 */
export type { PushRecipientDevices, PushRecipientTarget } from './push-recipients.service.js';
export type PushRecipientsStore = Pick<PushRecipientsService, 'targetsOf' | 'removeStale'>;

export function createPushRecipients({
  database,
  cipher,
}: {
  readonly database: Pick<Database, 'devicePushToken' | 'user' | '$queryRaw'>;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
}): PushRecipientsStore {
  return new PushRecipientsService({ devices: new DeviceTokensRepository(database), cipher });
}

// ---------------------------------------------------------------------------------------------
// T006 of specs/005-certification (FR-602, FR-603; the note under T006, Q1 (a)): what the ijazah
// request reads of identity, on the caller's transaction: the student's certificate name, read
// under the student's `users` lock, and (already above) `readStanding` for the teacher's standing,
// `accountTimezone` for the teacher's day.
export { certificateNameOf } from './certificate-name.repository.js';

// ---------------------------------------------------------------------------------------------
// 005:T014 (FR-616, FR-617; SRS FR-GENDER-4; research R-409): the declared gender's read and its one
// writer, administrators-only, which the admin module's correction (T014) and fraud ban (T015) call
// under the person's `users` lock. No user procedure reaches it (R-GENDER-6).
export {
  type DeclaredGender,
  declaredGenderOf,
  setDeclaredGender,
} from './declared-gender.repository.js';
