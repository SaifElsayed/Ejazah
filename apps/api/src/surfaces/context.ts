// T106: the request context, assembled on the server before any procedure runs (FR-046, R-GENDER-4,
// R-TIME-6, R-SEC-8; contracts/kernel.md "Request context").
//
// Every field comes from the server: identity, role, standing, gender and locale from the
// server-held session, the correlation identifier generated here, once per request. The factories
// take a session the server resolved and the process's logger, and nothing from the request but
// the client's address, so no client-supplied timestamp, identity, role or gender can be
// expressed, let alone trusted.
//
// ONE CORRELATION IDENTIFIER per request: generated here and handed to `requestLogger` (T100), so
// the context, every log record of the request and a reported error (T111) carry the same one.
//
// TWO CONTEXTS, because administrator and user authentication share no table, token or middleware
// (R-SEC-8): a user session yields an `AppContext`, an administrator session an `AdminContext`,
// and neither type is assignable to the other. The session is resolved by the resolver the HTTP
// application was built with (T017; specs/002-identity/contracts/kernel.md "Session resolution"):
// one call per request from the bearer token, standing read from the database every time, nothing
// cached across requests (FR-108). A resolver that yields null makes the request anonymous.
//
// THE SESSION CARRIES ONE ROLE AND THE ACCOUNT'S STANDING (T016, data-model §6): `role` replaced the
// `activeRoles` set (no procedure had read it, so the contract snapshot is unaffected),
// `accountStatus` is what the restricted-account rule reads, and a teacher's `teacher` block is what
// `teacherProcedure({ admits })` reads. The administrator session says whether this session's second
// factor was verified, which the administrator kind requires (FR-170).
//
// THE ADMINISTRATOR CONTEXT CARRIES WHAT AUDITING NEEDS (T108): the transactions of the process's
// client and the bound audit writer, so the administrator caller kind can run each call in one
// transaction and write its audit record there (FR-049). Both are handed in by the HTTP application,
// which `main.ts` builds with the admin module's writer.
//
// THE ADMINISTRATOR CONTEXT CARRIES THE ADMIN MODULE'S SERVICES (T067) through a port declared here,
// `AdminSurfaceServices`, in the contract's types: this file may not import `modules/admin`, not even
// a type (`boundaries/no-upward-admin-import`), so the admin module implements the port and `main.ts`
// binds it, as the audit writer is bound (owner's decision 2026-10-21 at the conflict check of B12b).
// A drift between the two fails the binding in `main.ts` at type-check time.
//
// BOTH CONTEXTS CARRY THE PROCESS'S RATE LIMITER (T170, T017): the caller kinds apply a procedure's
// declared limit from it, so a limit is declared on the procedure and never applied by hand. The
// administrator context gained it for `adminPublicProcedure`, the anonymous kind of that surface.
//
// BOTH CONTEXTS CARRY THE CLIENT'S ADDRESS (T017, kernel.md): the socket's peer, or, when
// `TRUSTED_PROXY` names the one proxy header to trust, that header's LAST hop — the one the trusted
// proxy appended, never the first, which the client writes itself. It is the subject of the
// anonymous paths that have no better one, and it reaches a log only reduced to its network
// (R-SEC-2: the logger does that for any address-named key).
//
// `RequesterGender` is minted here and nowhere else outside a spec file (R-GENDER-5): from the
// session's gender, never from input. A caller kind narrows this context; it never mints (T107).
//
// BOTH CONTEXTS CARRY THE REQUEST'S LIVE PUBLISHER (T063 of specs/004-sessions; research R-324,
// item 5): `live`, the request's own after-commit list over the process's bus, which the caller kind
// flushes once the call's work has committed and drops otherwise; the user context also carries the
// process's registry of open streams, `liveStreams`, which `live.events` opens a stream in. Both are
// the live channel `main.ts` hands the HTTP application; a context built without one carries a
// publisher that sends nowhere and no registry. The session's access-token expiry travels with the
// caller (`accessExpiresAt`), so a stream ends when the token it opened with does.
import { randomUUID } from 'node:crypto';
import type {
  adminMeOutput,
  adminMfaRecoverOutput,
  adminMfaSetupBeginOutput,
  adminCredentialCorrection,
  applicationsApproveInput,
  applicationsBanInput,
  applicationsGetOutput,
  applicationsListInput,
  applicationsListOutput,
  applicationsRecordCallInput,
  applicationsRejectInput,
  applicationsRequestInfoInput,
  documentsAcceptInput,
  documentsLinkOutput,
  documentsRequestAnotherInput,
  adminCredentialsApproveInput,
  adminCredentialsCorrectInput,
  adminCredentialsGetOutput,
  adminCredentialsListInput,
  adminCredentialsListOutput,
  adminCredentialsRejectInput,
  adminCredentialsRequestDocumentInput,
  adminCredentialTranscription,
  adminRecoveryCodesOutput,
  adminSignInOutput,
  adminsAddInput,
  adminsAddOutput,
  adminsListInput,
  adminsListOutput,
  auditGetOutput,
  auditListInput,
  auditListOutput,
  // T060.
  casesDecideComplaintInput,
  casesDecideComplaintOutput,
  casesDismissInput,
  casesDismissOutput,
  casesGetInput,
  casesGetOutput,
  casesListInput,
  casesListOutput,
  casesOpenManualInput,
  casesOpenManualOutput,
  casesResolveInput,
  casesResolveOutput,
  homeSummaryOutput,
  outagesListInput,
  outagesListOutput,
  outagesRecordInput,
  outagesRecordOutput,
  paymentsGetOutput,
  paymentsListInput,
  paymentsListOutput,
  sessionsCancelInput,
  sessionsCancelOutput,
  sessionsMonitorGetInput,
  sessionsMonitorGetOutput,
  sessionsMonitorListInput,
  sessionsMonitorListOutput,
  sessionsReviewGetInput,
  sessionsReviewGetOutput,
  sessionsReviewListInput,
  sessionsReviewListOutput,
  sessionsReviewResolveInput,
  sessionsReviewResolveOutput,
  disputesGetInput,
  disputesGetOutput,
  disputesListInput,
  disputesListOutput,
  disputesResolveInput,
  disputesResolveOutput,
  sessionsReviewReviseInput,
  sessionsReviewReviseOutput,
  disputesReviseInput,
  disputesReviseOutput,
  // T040 of specs/004-sessions: a deleted party's held files.
  disputesHeldFilesInput,
  disputesHeldFilesOutput,
  disputesHeldFileLinkInput,
  disputesHeldFileLinkOutput,
  disputesChatInput,
  disputesChatOutput,
  // T061.
  sessionsRestoreInput,
  sessionsRestoreOutput,
  // T058.
  usersGetInput,
  usersGetOutput,
  usersListInput,
  usersListOutput,
  // T081 of specs/004-sessions: an administrator's deletion at the owner's request.
  usersDeleteInput,
  // T004 of specs/005-certification: an administrator sets a student's certificate name.
  usersSetCertificateNameInput,
  // T070.
  enrollmentsReleaseSlotInput,
  enrollmentsReleaseSlotOutput,
  // T072.
  banLiftEnrollment,
  // T077 of specs/004-sessions: a deleted teacher's kept data.
  teachersKeptDocumentLinkInput,
  teachersKeptDocumentLinkOutput,
  teachersKeptEraseDateInput,
  teachersKeptEraseNowInput,
  // T082 of specs/004-sessions: an administrator's direct end of an enrollment.
  sessionsEndEnrollmentInput,
  sessionsEndEnrollmentOutput,
} from '@ijazah/contracts/admin';
import type { z } from 'zod';
import type { AuditSnapshot, AuditWriter } from '../platform/audit/audit-writer.js';
import type { Transaction } from '../platform/db/prisma.repository.js';
import type { Transactions } from '../platform/db/transaction.repository.js';
import type { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { DEFAULT_LOCALE, type Locale } from '../platform/http/locale.js';
import type { Gender, RequesterGender } from '../platform/guards/requester-gender.js';
import type { LiveBus } from '../platform/live/live-bus.js';
import { RequestLive, unboundBus } from '../platform/live/live-publisher.js';
import type { LiveRegistry } from '../platform/live/live-registry.js';
import { type Logger, requestLogger } from '../platform/logging/logger.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import type { BookingServices, DiscoveryServices } from '../modules/booking/index.js';
import type { CatalogServices, SubjectsReader } from '../modules/catalog/index.js';
// T037 of specs/004-sessions.
import type { ChatServices } from '../modules/chat/index.js';
// T006 of specs/005-certification (the owner's Q-A2 (a)): the ijazah request's services.
import type { CertificationServices } from '../modules/certification/index.js';
import type { IdentityServices } from '../modules/identity/index.js';
import type { TeacherProfileServices } from '../modules/identity/index.js';
import type { CheckoutServices } from '../modules/payments/index.js';
import type { SessionsServices } from '../modules/sessions/index.js';
import type { VerificationServices } from '../modules/verification/index.js';

// The request's language and the client's address are the kernel's (`platform/http/`, PR #79
// review, finding 1: `platform` depends on nothing above it); they are re-exported here for the
// surfaces and the application, which read them through the context.
export {
  bearerOf,
  clientAddressOf,
  type PeerSource,
  UNKNOWN_CLIENT_ADDRESS,
} from '../platform/http/client-address.js';
export { DEFAULT_LOCALE, type Locale } from '../platform/http/locale.js';

/** The roles a user may hold (ERD §2, `user_roles.role`); one per account (ADR 0016 D3). */
export type Role = 'student' | 'teacher';

/** The account's standing (ERD §2, `users.account_status`). */
export type AccountStatus = 'active' | 'suspended' | 'verification_required' | 'banned';

/** ERD §2, `teacher_profiles.verification_status`. */
export type TeacherVerificationStatus =
  'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';

/** ERD §2, `teacher_profiles.application_status` (data-model §3). */
export type TeacherApplicationStatus =
  'in_review' | 'needs_document' | 'rejected' | 'banned' | 'approved';

/** What the session reads of a teacher's profile, for the teacher kind's `admits` (R-106). */
export interface TeacherStanding {
  readonly verificationStatus: TeacherVerificationStatus;
  /** Whether the payout account is verified: `payout_verified_at` is set. */
  readonly payoutVerified: boolean;
  readonly applicationStatus: TeacherApplicationStatus;
}

/** What a server-held user session records about its holder (data-model §6). */
export interface UserSession {
  readonly userId: string;
  readonly sessionId: string;
  readonly role: Role;
  readonly gender: Gender;
  readonly preferredLanguage: Locale;
  readonly accountStatus: AccountStatus;
  /** Present for a teacher-role holder: the standing the teacher kind narrows by. */
  readonly teacher?: TeacherStanding;
  /**
   * When the access token this request came with expires (T063): identity's resolver always says;
   * a live stream ends then, and is not opened for a session that does not say.
   */
  readonly accessExpiresAt?: Date;
}

/** What a server-held administrator session records. A different principal, not a user role. */
export interface AdminSession {
  readonly adminId: string;
  /** The session the bearer names, so `auth.signOut` ends this one (T061, T066). */
  readonly sessionId: string;
  /** Whether the second factor was verified on this session (`mfa_verified_at` set, FR-170). */
  readonly mfaVerified: boolean;
}

/** The authenticated user making the request. */
export interface UserCaller {
  readonly userId: string;
  readonly sessionId: string;
  readonly role: Role;
  readonly accountStatus: AccountStatus;
  readonly gender: RequesterGender;
  readonly teacher?: TeacherStanding;
  /** When the access token this request came with expires (T063), as the session says. */
  readonly accessExpiresAt?: Date;
}

/** The authenticated administrator making the request. */
export interface AdministratorCaller {
  readonly adminId: string;
  readonly sessionId: string;
  readonly mfaVerified: boolean;
}

/**
 * Resolves the session a bearer token points at, or null: a bad, expired or revoked token is an
 * anonymous request, never a throw (kernel.md "Session resolution"). The identity module's and the
 * admin module's public entries provide the two; `main.ts` hands them to the HTTP application.
 */
export type SessionResolver<TSession> = (bearer: string) => Promise<TSession | null>;

export interface SessionResolvers {
  readonly user: SessionResolver<UserSession>;
  readonly admin: SessionResolver<AdminSession>;
}

/**
 * What a user-surface procedure reads beyond its caller (T038): bound once by `main.ts` and
 * carried by every request, so a router stays a static value the contract snapshot reads. A member
 * joins here with the task whose procedure first reads it.
 */
export interface AppServices {
  /** Every operational number a procedure reads (FR-034). */
  readonly settings: SettingsReader;
  /**
   * `platform.publicConfig`: the support address from the configuration (FR-145), and (003:T109,
   * track 2) the payment mode, which `main.ts` always sets from `PAYMENT_MODE`; a surface that never
   * answers `platform.publicConfig` may leave it out, and the procedure then fails closed.
   */
  readonly publicConfig: {
    readonly supportEmail: string;
    readonly paymentMode?: 'test' | 'live';
  };
  /** `catalog.subjects.list`: the catalog module's subjects read (FR-182). */
  readonly subjects: SubjectsReader;
  /** `auth.*`, `onboarding.*` and `account.*`: the identity module's services (T048, T049). */
  readonly identity: IdentityServices;
  /** `teacher.application.*` and `teacher.credentials.*`: the verification module's services (T056, T057). */
  readonly verification: VerificationServices;
  /**
   * `teacher.packages.*` and `teacher.slots.*`: the catalog module's services (T020), built over the
   * `CatalogUse` port `main.ts` binds to booking's entry (R-207); T018 and T019 fill it.
   */
  readonly catalog: CatalogServices;
  /** `teacher.profile.*`: the identity module's profile service (T017, FR-310). */
  readonly teacherProfile: TeacherProfileServices;
  /**
   * `discovery.*`: catalog's cards composed with booking's nearest free slot on booking's router
   * (T026, R-205).
   */
  readonly discovery: DiscoveryServices;
  /**
   * `booking.*`: the booking sheet's slots on booking's router (T032, R-205); `enrollments.*`,
   * `teacher.students.*` and `teacher.today`, the lists on booking's routers (T049).
   */
  readonly booking: BookingServices;
  /** `checkout.*`: the payments module's checkout over booking's holds and enrollments (T036, R-208). */
  readonly checkout: CheckoutServices;
  /** `sessions.get` and `sessions.join`: the sessions module's services (T011 of specs/004-sessions). */
  readonly sessions: SessionsServices;
  /** T037 of specs/004-sessions: `chat.list` and `chat.send`, the chat module's services. */
  readonly chat: ChatServices;
  /**
   * T006 of specs/005-certification (the owner's Q-A2 (a)): `teacher.ijazahRequests.*`, the
   * certification module's request service, built once by `main.ts`.
   */
  readonly certification: CertificationServices;
}

/** The context of the user surface. `caller` is null for an anonymous request. */
export interface AppContext {
  /** Which surface this is; never 'admin', so an administrator context cannot stand in (T162, R-SEC-8). */
  readonly surface: 'app';
  readonly caller: UserCaller | null;
  readonly locale: Locale;
  readonly correlationId: string;
  readonly log: Logger;
  /** The process's limiter, which the caller kinds apply a declared rate limit from (T170). */
  readonly rateLimiter: RateLimiter;
  /** The client's address as `clientAddressOf` read it; a subject for anonymous limits, never logged whole. */
  readonly clientAddress: string;
  /** The services the surface's procedures read (T038). */
  readonly services: AppServices;
  /** The request's after-commit live events, flushed by the caller kind (T063). */
  readonly live: RequestLive;
  /** The process's open streams, which `live.events` opens one in; null without a channel (T063). */
  readonly liveStreams: LiveRegistry | null;
}

/** The process's live channel (T063): the bus a request's events go out on, and its streams. */
export interface LiveChannel {
  readonly bus: LiveBus;
  readonly registry: LiveRegistry;
}

/** What the administrator caller kind needs to audit every call (T108). */
export interface Administration {
  /** Opens the one transaction each administrative call runs in. */
  readonly transactions: Transactions;
  /** Writes the call's audit records on that transaction; the admin module's, bound in main.ts. */
  readonly auditWriter: AuditWriter;
}

/** What a service answers: the value its procedure's output schema parses. */
type Answer<TSchema extends z.ZodType> = Promise<z.input<TSchema>>;

/** What an action moved, as its audit entry's `before` and `after` hold it (T116). */
type Move = Promise<{ readonly before: AuditSnapshot; readonly after: AuditSnapshot }>;

/**
 * T072 of specs/004-sessions: a ban's or a revocation's lift, keyed through `runOn` on the call's
 * transaction; its move carries each enrollment's result for the audit entry and the answer.
 */
type KeyedLift = (
  tx: Transaction,
  actorId: string,
  request: {
    readonly scope: 'students.liftBan' | 'teachers.liftBan' | 'teachers.liftRevocation';
    readonly userId: string;
    readonly reason: string;
    readonly idempotencyKey: string;
  },
) => Promise<{
  readonly move: {
    readonly before: AuditSnapshot;
    readonly after: AuditSnapshot;
    readonly enrollments: readonly z.input<typeof banLiftEnrollment>[];
  };
  readonly replayed: boolean;
}>;

/**
 * The admin module's services as the administrator surface's procedures call them (T067): the port
 * this file declares and `modules/admin` implements, bound once by `main.ts`. Each administrator
 * kind's call hands in its own transaction (`tx`) and, where the action is someone's, the acting
 * administrator from the session, never from the input.
 */
export interface AdminSurfaceServices {
  /** The sign-in, the second factor and the password-set link: the anonymous kind's (FR-170 to FR-172). */
  readonly auth: {
    signIn(email: string, password: string): Answer<typeof adminSignInOutput>;
    verifyMfa(sessionToken: string, code: string): Promise<void>;
    recover(sessionToken: string, recoveryCode: string): Answer<typeof adminMfaRecoverOutput>;
    beginSetup(sessionToken: string): Answer<typeof adminMfaSetupBeginOutput>;
    confirmSetup(sessionToken: string, code: string): Answer<typeof adminRecoveryCodesOutput>;
    setPassword(inviteToken: string, password: string): Promise<void>;
  };
  /** `auth.signOut`: ends the one session the request came on (T061). */
  readonly sessions: {
    signOut(sessionId: string, tx: Transaction): Promise<void>;
  };
  /** `auth.me` and the admins page (FR-173, FR-174). */
  readonly admins: {
    me(tx: Transaction, adminId: string): Answer<typeof adminMeOutput>;
    list(
      tx: Transaction,
      readerId: string,
      query: z.output<typeof adminsListInput>,
    ): Answer<typeof adminsListOutput>;
    add(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof adminsAddInput>,
    ): Answer<typeof adminsAddOutput>;
    disable(tx: Transaction, actorId: string, adminId: string): Promise<void>;
    resetMfa(tx: Transaction, actorId: string, adminId: string): Promise<void>;
    regenerateRecoveryCodes(
      tx: Transaction,
      adminId: string,
      code: string,
    ): Answer<typeof adminRecoveryCodesOutput>;
  };
  /** The audit log page and the home (FR-176, FR-181; T065). */
  readonly audit: {
    list(tx: Transaction, query: z.output<typeof auditListInput>): Answer<typeof auditListOutput>;
    get(tx: Transaction, entryId: string): Answer<typeof auditGetOutput>;
  };
  readonly home: {
    summary(tx: Transaction): Answer<typeof homeSummaryOutput>;
  };
  /**
   * The credential review (FR-163, FR-164; T069), the catalog module's, composed into the admin
   * module's services. Approval answers the transcription and a correction the transcription before
   * and after, for the call's audit entry; a request for another document the application it set
   * waiting on the applicant, if any (T155).
   */
  readonly credentials: {
    list(
      tx: Transaction,
      query: z.output<typeof adminCredentialsListInput>,
    ): Answer<typeof adminCredentialsListOutput>;
    get(tx: Transaction, credentialId: string): Answer<typeof adminCredentialsGetOutput>;
    approve(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof adminCredentialsApproveInput>,
    ): Promise<{
      readonly before: AuditSnapshot;
      readonly after: z.input<typeof adminCredentialTranscription>;
    }>;
    reject(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof adminCredentialsRejectInput>,
    ): Promise<void>;
    requestDocument(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof adminCredentialsRequestDocumentInput>,
    ): Promise<{ readonly before?: AuditSnapshot; readonly after?: AuditSnapshot }>;
    correct(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof adminCredentialsCorrectInput>,
    ): Answer<typeof adminCredentialCorrection>;
  };
  /**
   * The verification queue (FR-160 to FR-162; T068), the verification module's. An approval answers
   * the subjects it granted, for the call's audit entry.
   */
  readonly applications: {
    list(
      tx: Transaction,
      query: z.output<typeof applicationsListInput>,
    ): Answer<typeof applicationsListOutput>;
    get(tx: Transaction, teacherUserId: string): Answer<typeof applicationsGetOutput>;
    recordCall(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof applicationsRecordCallInput>,
    ): Move;
    approve(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof applicationsApproveInput>,
    ): Promise<{
      readonly before: AuditSnapshot;
      readonly after: AuditSnapshot;
      readonly subjectIds: string[];
    }>;
    reject(tx: Transaction, actorId: string, input: z.output<typeof applicationsRejectInput>): Move;
    requestInfo(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof applicationsRequestInfoInput>,
    ): Move;
    ban(tx: Transaction, actorId: string, input: z.output<typeof applicationsBanInput>): Move;
  };
  /** The document viewer and the identity requests (FR-160, FR-166; T068), the verification module's. */
  readonly documents: {
    link(tx: Transaction, actorId: string, documentId: string): Answer<typeof documentsLinkOutput>;
    requireIdentity(
      tx: Transaction,
      actorId: string,
      input: { readonly userId: string; readonly reason: string },
    ): Promise<{ readonly requestId: string }>;
    accept(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof documentsAcceptInput>,
    ): Promise<unknown>;
    requestAnother(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof documentsRequestAnotherInput>,
    ): Promise<{ readonly requestId: string; readonly documentId: string }>;
  };
  /**
   * The payments monitor (FR-400 to FR-402; T052), the payments module's: two reads on the call's
   * transaction, and nothing written but the call's audit entry (FR-401).
   */
  readonly payments: {
    list(
      tx: Transaction,
      query: z.output<typeof paymentsListInput>,
    ): Answer<typeof paymentsListOutput>;
    get(tx: Transaction, paymentId: string): Answer<typeof paymentsGetOutput>;
  };
  /** An approved teacher's standing (FR-165; T068), the identity module's. */
  readonly teachers: {
    suspend(tx: Transaction, actorId: string, teacherUserId: string): Move;
    revokeApproval(tx: Transaction, actorId: string, teacherUserId: string, reason: string): Move;
    ban(tx: Transaction, actorId: string, teacherUserId: string): Move;
    reinstate(tx: Transaction, actorId: string, teacherUserId: string): Move;
    /** T072: `teachers.liftBan` and `teachers.liftRevocation`. */
    keyedLift: KeyedLift;
    /** T077: `teachers.keptData.*`, verification's kept-data service. */
    keptData: {
      documentLink(
        tx: Transaction,
        actorId: string,
        input: z.output<typeof teachersKeptDocumentLinkInput>,
      ): Answer<typeof teachersKeptDocumentLinkOutput>;
      setEraseDate(
        tx: Transaction,
        actorId: string,
        input: z.output<typeof teachersKeptEraseDateInput>,
      ): Promise<{
        readonly before: string | null;
        readonly after: string | null;
        readonly replayed: boolean;
      }>;
      eraseNow(
        tx: Transaction,
        actorId: string,
        input: z.output<typeof teachersKeptEraseNowInput>,
      ): Promise<{
        readonly documents: number;
        readonly payout: boolean;
        readonly replayed: boolean;
      }>;
    };
  };
  /** A student's standing (FR-421, FR-486; T005 of specs/004-sessions), the identity module's. */
  readonly students: {
    suspendStudent(tx: Transaction, actorId: string, userId: string): Move;
    banStudent(tx: Transaction, actorId: string, userId: string): Move;
    reinstateStudent(tx: Transaction, actorId: string, userId: string): Move;
    /** T072: `students.liftBan`. */
    keyedLift: KeyedLift;
  };
  /**
   * The provider outage windows (FR-445, R-307; T016 of specs/004-sessions), the sessions module's,
   * composed by the admin module: a window recorded on the call's transaction with its sessions'
   * reclassification, and a page of the windows recorded.
   */
  readonly outages: {
    record(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof outagesRecordInput>,
    ): Answer<typeof outagesRecordOutput>;
    list(
      tx: Transaction,
      input: z.output<typeof outagesListInput>,
    ): Answer<typeof outagesListOutput>;
  };
  /**
   * An administrator's cancellation of a session not yet settled (FR-460; T023 of
   * specs/004-sessions), the sessions module's, composed by the admin module: the session
   * `cancelled_by_admin` on the call's transaction under the enrollment's and the session's locks,
   * its enrollment's `admin_cancellation` case opened or joined.
   */
  readonly sessionCancel: {
    cancel(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof sessionsCancelInput>,
    ): Answer<typeof sessionsCancelOutput>;
  };
  /**
   * The enrollment and session monitor (FR-479; T024 of specs/004-sessions), the sessions module's,
   * composed by the admin module: two reads on the call's transaction, nothing written but the
   * call's audit entry.
   */
  readonly monitor: {
    list(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof sessionsMonitorListInput>,
    ): Answer<typeof sessionsMonitorListOutput>;
    get(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof sessionsMonitorGetInput>,
    ): Answer<typeof sessionsMonitorGetOutput>;
  };
  /**
   * The compensation-case queue (FR-478, FR-422; T035 and T036 of specs/004-sessions), the sessions
   * module's, composed by the admin module: two reads and the two closings on the call's
   * transaction, a `student_suspended` case's closing carrying its effect (T036).
   */
  readonly cases: {
    list(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof casesListInput>,
    ): Answer<typeof casesListOutput>;
    get(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof casesGetInput>,
    ): Answer<typeof casesGetOutput>;
    resolve(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof casesResolveInput>,
    ): Answer<typeof casesResolveOutput>;
    dismiss(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof casesDismissInput>,
    ): Answer<typeof casesDismissOutput>;
    /**
     * T064: an administrator's manual case, keyed on the call's transaction; whether the answer
     * was replayed from its key's row, for the kind to record no second entry.
     */
    openManual(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof casesOpenManualInput>,
    ): Promise<{
      readonly answer: z.input<typeof casesOpenManualOutput>;
      readonly replayed: boolean;
    }>;
    // T060: an open complaint of a teacher's absence decided on the call's transaction.
    decideComplaint(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof casesDecideComplaintInput>,
    ): Answer<typeof casesDecideComplaintOutput>;
  };
  /**
   * The review queue (FR-446, FR-450, FR-477; T033 of specs/004-sessions), the sessions module's,
   * composed by the admin module: the queue and a session's telemetry read, and an outcome written
   * on the call's transaction under the enrollment's and the session's locks.
   */
  readonly review: {
    list(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof sessionsReviewListInput>,
    ): Answer<typeof sessionsReviewListOutput>;
    get(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof sessionsReviewGetInput>,
    ): Answer<typeof sessionsReviewGetOutput>;
    resolve(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof sessionsReviewResolveInput>,
    ): Answer<typeof sessionsReviewResolveOutput>;
    /** T059: the correction, keyed on the call's transaction; `replayed` from the key's row. */
    revise(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof sessionsReviewReviseInput>,
    ): Promise<{
      readonly outcome: z.input<typeof sessionsReviewReviseOutput>;
      readonly replayed: boolean;
    }>;
  };
  /**
   * The disputes queue and its resolution (FR-421, FR-474 to FR-476; T034 of specs/004-sessions),
   * the sessions module's over moderation's rows, composed by the admin module with identity's
   * standing for a `party_*` ruling.
   */
  readonly disputes: {
    list(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof disputesListInput>,
    ): Answer<typeof disputesListOutput>;
    get(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof disputesGetInput>,
    ): Answer<typeof disputesGetOutput>;
    resolve(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof disputesResolveInput>,
    ): Answer<typeof disputesResolveOutput>;
    /** T059: a ruling's revision, keyed on the call's transaction; `replayed` from the key's row. */
    revise(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof disputesReviseInput>,
    ): Promise<{
      readonly outcome: z.input<typeof disputesReviseOutput>;
      readonly replayed: boolean;
    }>;
    /** T040: a deleted party's held files inside the open matter, metadata only (FR-487, R-327). */
    heldFiles(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof disputesHeldFilesInput>,
    ): Answer<typeof disputesHeldFilesOutput>;
    /** T040: one signed link to one of them, per press. */
    heldFileLink(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof disputesHeldFileLinkInput>,
    ): Answer<typeof disputesHeldFileLinkOutput>;
    /** T040: a page of the enrollment's chat inside the open matter, and its enrollment. */
    chat(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof disputesChatInput>,
    ): Promise<{
      readonly enrollmentId: string;
      readonly page: z.input<typeof disputesChatOutput>;
    }>;
  };
  /**
   * T061 of specs/004-sessions (FR-454, FR-455): an administrator's restore, the sessions module's,
   * keyed on the call's transaction; `replayed` from the key's row.
   */
  readonly restore: {
    restore(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof sessionsRestoreInput>,
    ): Promise<{
      readonly answer: z.input<typeof sessionsRestoreOutput>;
      readonly replayed: boolean;
    }>;
  };
  /**
   * T058 of specs/004-sessions (FR-481, FR-459; SRS FR-ADMIN-4): the user directory, the
   * verification module's over identity's and sessions' entries, composed by the admin module: two
   * reads on the call's transaction, nothing written but the call's audit entry.
   */
  readonly users: {
    list(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof usersListInput>,
    ): Answer<typeof usersListOutput>;
    get(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof usersGetInput>,
    ): Answer<typeof usersGetOutput>;
    /** T081 (FR-512): `users.delete`, identity's deletion keyed on the call's transaction. ⚠️ Irreversible. */
    delete(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof usersDeleteInput>,
    ): Promise<{ readonly replayed: boolean }>;
    /**
     * T004 of specs/005-certification (FR-602): `users.setCertificateName`, identity's service keyed
     * on the call's transaction; the student's requests awaiting the name are released on it.
     */
    setCertificateName(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof usersSetCertificateNameInput>,
    ): Promise<{ readonly replayed: boolean }>;
  };
  /** T070 of specs/004-sessions: an administrator releases a held slot (`enrollments.releaseSlot`). */
  readonly enrollments: {
    releaseSlot(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof enrollmentsReleaseSlotInput>,
    ): Promise<{
      readonly answer: z.input<typeof enrollmentsReleaseSlotOutput>;
      readonly replayed: boolean;
    }>;
  };
  /** T082 of specs/004-sessions (FR-513): an administrator's direct end, keyed on the call's transaction. */
  readonly enrollmentEnd: {
    endEnrollment(
      tx: Transaction,
      actorId: string,
      input: z.output<typeof sessionsEndEnrollmentInput>,
    ): Promise<{
      readonly answer: z.input<typeof sessionsEndEnrollmentOutput>;
      readonly replayed: boolean;
    }>;
  };
}

/**
 * The context of the administrator surface. No locale: the admin application's language is the
 * browser's, not a session's. `administrator` is null for an unauthenticated request.
 */
export interface AdminContext {
  /** Which surface this is; never 'app', so a user context cannot stand in (T162, R-SEC-8). */
  readonly surface: 'admin';
  readonly administrator: AdministratorCaller | null;
  readonly correlationId: string;
  readonly log: Logger;
  readonly administration: Administration;
  /** The admin module's services, bound once by `main.ts` (T067). */
  readonly services: AdminSurfaceServices;
  /** The process's limiter: the anonymous kind's limits (T017) and the administrator kind's (T062). */
  readonly rateLimiter: RateLimiter;
  readonly clientAddress: string;
  /** The request's after-commit live events, flushed once the call's transaction commits (T063). */
  readonly live: RequestLive;
}

export interface ContextSource<TSession> {
  /** The session the server resolved for this request, or null when there is none. */
  readonly session: TSession | null;
  /** The process's logger; the context derives the request's own from it. */
  readonly log: Logger;
  /** The process's rate limiter (T103), built in main.ts. */
  readonly rateLimiter: RateLimiter;
  /** The client's address, from `clientAddressOf`. */
  readonly clientAddress: string;
  /** The process's live channel (T063), bound in main.ts; absent, events go nowhere. */
  readonly live?: LiveChannel;
}

function correlated(log: Logger, clientAddress: string): { correlationId: string; log: Logger } {
  const correlationId = randomUUID();
  // The logger writes an address-named key reduced to its network (R-SEC-2), never the address.
  return { correlationId, log: requestLogger(log, correlationId).child({ clientAddress }) };
}

export interface AppContextSource extends ContextSource<UserSession> {
  readonly services: AppServices;
}

/** The user surface's context for one request. */
export function createAppContext({
  session,
  log,
  rateLimiter,
  clientAddress,
  services,
  live,
}: AppContextSource): AppContext {
  const caller: UserCaller | null =
    session === null
      ? null
      : {
          userId: session.userId,
          sessionId: session.sessionId,
          role: session.role,
          accountStatus: session.accountStatus,
          // The one place outside a spec file where a requester's gender is minted (R-GENDER-5).
          gender: session.gender as RequesterGender,
          ...(session.teacher === undefined ? {} : { teacher: session.teacher }),
          ...(session.accessExpiresAt === undefined
            ? {}
            : { accessExpiresAt: session.accessExpiresAt }),
        };
  const request = correlated(log, clientAddress);
  return {
    surface: 'app',
    caller,
    locale: session?.preferredLanguage ?? DEFAULT_LOCALE,
    ...request,
    rateLimiter,
    clientAddress,
    services,
    live: new RequestLive(live?.bus ?? unboundBus, request.log),
    liveStreams: live?.registry ?? null,
  };
}

export interface AdminContextSource extends ContextSource<AdminSession> {
  readonly administration: Administration;
  readonly services: AdminSurfaceServices;
}

/** The administrator surface's context for one request. */
export function createAdminContext({
  session,
  log,
  administration,
  services,
  rateLimiter,
  clientAddress,
  live,
}: AdminContextSource): AdminContext {
  const request = correlated(log, clientAddress);
  return {
    surface: 'admin',
    administrator:
      session === null
        ? null
        : {
            adminId: session.adminId,
            sessionId: session.sessionId,
            mfaVerified: session.mfaVerified,
          },
    ...request,
    administration,
    services,
    rateLimiter,
    clientAddress,
    live: new RequestLive(live?.bus ?? unboundBus, request.log),
  };
}
