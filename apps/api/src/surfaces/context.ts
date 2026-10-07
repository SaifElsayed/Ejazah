// T106: the request context, assembled on the server before any procedure runs (FR-046, R-GENDER-4,
// R-TIME-6, R-SEC-8; contracts/kernel.md "Request context").
//
// Every field comes from the server: identity, role, gender and locale from the server-held
// session, the correlation identifier generated here, once per request. The factories take a
// session the server resolved and the process's logger, and nothing from the request, so no
// client-supplied timestamp, identity, role or gender can be expressed, let alone trusted.
//
// ONE CORRELATION IDENTIFIER per request: generated here and handed to `requestLogger` (T100), so
// the context, every log record of the request and a reported error (T111) carry the same one.
//
// TWO CONTEXTS, because administrator and user authentication share no table, token or middleware
// (R-SEC-8): a user session yields an `AppContext`, an administrator session an `AdminContext`,
// and neither type is assignable to the other. The session itself is resolved by whoever
// authenticates the request; until the identity work exists, the HTTP application (T149) resolves
// none, so every request arrives anonymous.
//
// `RequesterGender` is minted here and nowhere else outside a spec file (R-GENDER-5): from the
// session's gender, never from input. A caller kind narrows this context; it never mints (T107).
import { randomUUID } from 'node:crypto';
import type { Gender, RequesterGender } from '../platform/guards/requester-gender.js';
import { type Logger, requestLogger } from '../platform/logging/logger.js';

/** The two languages of ERD §2 (`users.preferred_language`). */
export type Locale = 'ar' | 'en';

/** Arabic unless the session says otherwise (contracts/kernel.md). */
export const DEFAULT_LOCALE: Locale = 'ar';

/** The roles a user may hold (ERD §2, `user_roles.role`). */
export type Role = 'student' | 'teacher';

/** What a server-held user session records about its holder. */
export interface UserSession {
  readonly userId: string;
  /** The roles the user holds whose status is active; a suspended role is not listed. */
  readonly activeRoles: readonly Role[];
  readonly gender: Gender;
  readonly preferredLanguage: Locale;
}

/** What a server-held administrator session records. A different principal, not a user role. */
export interface AdminSession {
  readonly adminId: string;
}

/** The authenticated user making the request. */
export interface UserCaller {
  readonly userId: string;
  readonly activeRoles: ReadonlySet<Role>;
  readonly gender: RequesterGender;
}

/** The authenticated administrator making the request. */
export interface AdministratorCaller {
  readonly adminId: string;
}

/** The context of the user surface. `caller` is null for an anonymous request. */
export interface AppContext {
  readonly caller: UserCaller | null;
  readonly locale: Locale;
  readonly correlationId: string;
  readonly log: Logger;
}

/**
 * The context of the administrator surface. No locale: the admin application is English only
 * (ARCHITECTURE §6.5). `administrator` is null for an unauthenticated request.
 */
export interface AdminContext {
  readonly administrator: AdministratorCaller | null;
  readonly correlationId: string;
  readonly log: Logger;
}

export interface ContextSource<TSession> {
  /** The session the server resolved for this request, or null when there is none. */
  readonly session: TSession | null;
  /** The process's logger; the context derives the request's own from it. */
  readonly log: Logger;
}

function correlated(log: Logger): { correlationId: string; log: Logger } {
  const correlationId = randomUUID();
  return { correlationId, log: requestLogger(log, correlationId) };
}

/** The user surface's context for one request. */
export function createAppContext({ session, log }: ContextSource<UserSession>): AppContext {
  const caller: UserCaller | null =
    session === null
      ? null
      : {
          userId: session.userId,
          activeRoles: new Set(session.activeRoles),
          // The one place outside a spec file where a requester's gender is minted (R-GENDER-5).
          gender: session.gender as RequesterGender,
        };
  return {
    caller,
    locale: session?.preferredLanguage ?? DEFAULT_LOCALE,
    ...correlated(log),
  };
}

/** The administrator surface's context for one request. */
export function createAdminContext({ session, log }: ContextSource<AdminSession>): AdminContext {
  return {
    administrator: session === null ? null : { adminId: session.adminId },
    ...correlated(log),
  };
}
