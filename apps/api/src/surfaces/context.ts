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
import type { IncomingHttpHeaders } from 'node:http';
import type { AuditWriter } from '../platform/audit/audit-writer.js';
import type { Transactions } from '../platform/db/transaction.repository.js';
import type { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import type { Gender, RequesterGender } from '../platform/guards/requester-gender.js';
import { type Logger, requestLogger } from '../platform/logging/logger.js';

/** The two languages of ERD §2 (`users.preferred_language`). */
export type Locale = 'ar' | 'en';

/** Arabic unless the session says otherwise (contracts/kernel.md). */
export const DEFAULT_LOCALE: Locale = 'ar';

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

/** The bearer token of the `Authorization` header, or null when the header carries none. */
export function bearerOf(headers: IncomingHttpHeaders): string | null {
  const header = headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

/** What the client's address is read from: the socket, and the request's headers. */
export interface PeerSource {
  readonly remoteAddress: string | undefined;
  readonly headers: IncomingHttpHeaders;
}

/** A socket that reports no peer: counted under one subject rather than refused. */
export const UNKNOWN_CLIENT_ADDRESS = 'unknown';

/**
 * The client's address: the socket's peer, or the last hop of the trusted proxy header when
 * `TRUSTED_PROXY` names one and the request carries it. The first hop is never read: an appended
 * `X-Forwarded-For` opens with whatever the caller sent (kernel.md "Session resolution").
 */
export function clientAddressOf(source: PeerSource, trustedProxyHeader?: string): string {
  const socket = source.remoteAddress ?? UNKNOWN_CLIENT_ADDRESS;
  if (trustedProxyHeader === undefined) return socket;
  const raw = source.headers[trustedProxyHeader.toLowerCase()];
  const header = Array.isArray(raw) ? raw.join(',') : raw;
  if (header === undefined) return socket;
  const hops = header
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop !== '');
  return hops[hops.length - 1] ?? socket;
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
}

/** What the administrator caller kind needs to audit every call (T108). */
export interface Administration {
  /** Opens the one transaction each administrative call runs in. */
  readonly transactions: Transactions;
  /** Writes the call's audit records on that transaction; the admin module's, bound in main.ts. */
  readonly auditWriter: AuditWriter;
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

export type AppContextSource = ContextSource<UserSession>;

/** The user surface's context for one request. */
export function createAppContext({
  session,
  log,
  rateLimiter,
  clientAddress,
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
  };
}

export interface AdminContextSource extends ContextSource<AdminSession> {
  readonly administration: Administration;
}

/** The administrator surface's context for one request. */
export function createAdminContext({
  session,
  log,
  administration,
  rateLimiter,
  clientAddress,
}: AdminContextSource): AdminContext {
  return {
    surface: 'admin',
    administrator:
      session === null ? null : { adminId: session.adminId, mfaVerified: session.mfaVerified },
    ...correlated(log, clientAddress),
    administration,
    rateLimiter,
    clientAddress,
  };
}
