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
  homeSummaryOutput,
  paymentsGetOutput,
  paymentsListInput,
  paymentsListOutput,
} from '@ijazah/contracts/admin';
import type { z } from 'zod';
import type { AuditSnapshot, AuditWriter } from '../platform/audit/audit-writer.js';
import type { Transaction } from '../platform/db/prisma.repository.js';
import type { Transactions } from '../platform/db/transaction.repository.js';
import type { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { DEFAULT_LOCALE, type Locale } from '../platform/http/locale.js';
import type { Gender, RequesterGender } from '../platform/guards/requester-gender.js';
import { type Logger, requestLogger } from '../platform/logging/logger.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import type { BookingServices, DiscoveryServices } from '../modules/booking/index.js';
import type { CatalogServices, SubjectsReader } from '../modules/catalog/index.js';
import type { IdentityServices } from '../modules/identity/index.js';
import type { TeacherProfileServices } from '../modules/identity/index.js';
import type { CheckoutServices } from '../modules/payments/index.js';
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
  /** `platform.publicConfig`: the support address from the configuration (FR-145). */
  readonly publicConfig: { readonly supportEmail: string };
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
  /** The process's limiter, for the surface's anonymous kind (`adminPublicProcedure`, T017). */
  readonly rateLimiter: RateLimiter;
  readonly clientAddress: string;
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
        };
  return {
    surface: 'app',
    caller,
    locale: session?.preferredLanguage ?? DEFAULT_LOCALE,
    ...correlated(log, clientAddress),
    rateLimiter,
    clientAddress,
    services,
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
}: AdminContextSource): AdminContext {
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
    ...correlated(log, clientAddress),
    administration,
    services,
    rateLimiter,
    clientAddress,
  };
}
