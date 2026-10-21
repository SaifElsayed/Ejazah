// T066 (FR-170, research R-107, data-model §6): an administrator's session, a different principal in
// a different table from a user's (R-SEC-8).
//
// THE TOKEN is 32 random bytes in base64url, carried as the panel's bearer and stored only as its
// SHA-256 lookup hash on `admin_sessions`. It is opaque: every request reads the row and the
// administrator's standing, so a revocation or a disabling shows at once.
//
// ITS LIFE. Sign-in opens it with `mfa_verified_at` null; the second factor marks it verified, and
// the administrator caller kind refuses it until then (the sign-in flow's "ticket" is simply this
// session). It ends after `admin_session_idle_minutes` without a request, counted from the last one,
// and at `admin_session_max_hours` after sign-in however busy it was; sign-out ends it, and
// `revokeAll` ends every session of an administrator (disabling, a second-factor reset).
//
// WHAT IT RESOLVES TO. `{ adminId, sessionId, mfaVerified }`, where `mfaVerified` also requires the
// administrator to be enrolled, and null for anything that may not be used: an unknown token, a
// revoked or expired session, a disabled administrator or one whose password was never set. The
// session's id lets `auth.signOut` end the one session the request came on (T061; data-model §6
// named the two other members only).
import { addHours, addMinutes } from '@ijazah/time';
import { z } from 'zod';

import { hashLookupToken } from '../../platform/crypto/hashing.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { generateSecretToken } from '../../platform/guards/identifiers.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { type AdminSessionRow, AdminSessionsRepository } from './admin-sessions.repository.js';

export const SESSION_IDLE_SETTING = 'admin_session_idle_minutes';
export const SESSION_MAX_SETTING = 'admin_session_max_hours';

const positiveWhole = z.int().positive();

/** What the admin services share. */
export interface AdminSessionDependencies {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}

/** What a request's administrator session resolves to (`AdminSession` in surfaces/context.ts). */
export interface ResolvedAdminSession {
  readonly adminId: string;
  readonly sessionId: string;
  readonly mfaVerified: boolean;
}

/** A session still waiting for its second factor, as the sign-in flow's public calls take it. */
export interface PendingAdminSession {
  readonly adminId: string;
  readonly sessionId: string;
}

export class AdminSessionService {
  readonly #database: Database;
  readonly #sessions: AdminSessionsRepository;
  readonly #settings: SettingsReader;
  readonly #now: () => Date;

  constructor({ database, settings, now = () => new Date() }: AdminSessionDependencies) {
    this.#database = database;
    this.#sessions = new AdminSessionsRepository(database);
    this.#settings = settings;
    this.#now = now;
  }

  /** Opens an unverified session for `adminId`: the token, handed out once, and the row's id. */
  async issue(
    adminId: string,
    tx?: Pick<Transaction, 'adminSession'>,
  ): Promise<{ readonly token: string; readonly sessionId: string }> {
    const token = generateSecretToken();
    const now = this.#now();
    const maxHours = await this.#settings.read(SESSION_MAX_SETTING, positiveWhole);
    const row = {
      adminId,
      tokenHash: hashLookupToken(token),
      issuedAt: now,
      expiresAt: new Date(addHours(now, maxHours)),
    };
    const sessionId = await this.#sessions.insert(tx ?? this.#database, row);
    return { token, sessionId };
  }

  /** The session a bearer names, verified or not, or null; the request counts as activity. */
  async resolve(token: string): Promise<ResolvedAdminSession | null> {
    const row = await this.#live(token);
    if (row === null) return null;
    await this.#sessions.touch(row.id, this.#now());
    return {
      adminId: row.adminId,
      sessionId: row.id,
      mfaVerified: row.mfaVerifiedAt !== null && row.admin.mfaEnrolledAt !== null,
    };
  }

  /**
   * The session a sign-in handed out, while its second factor has not passed; ADMIN_SIGN_IN_FAILED
   * for any other token, so the panel starts the sign-in again.
   */
  async pending(token: string): Promise<PendingAdminSession> {
    const row = await this.#live(token);
    if (row === null || row.mfaVerifiedAt !== null) throw new DomainError('ADMIN_SIGN_IN_FAILED');
    await this.#sessions.touch(row.id, this.#now());
    return { adminId: row.adminId, sessionId: row.id };
  }

  /**
   * Marks the second factor passed on the session. A session ended or marked meanwhile answers
   * `ADMIN_SIGN_IN_FAILED`, the one the panel starts again on (B12a review, follow-up 6).
   */
  async markVerified(sessionId: string, tx: Pick<Transaction, 'adminSession'>): Promise<void> {
    if (!(await this.#sessions.markVerified(tx, sessionId, this.#now()))) {
      throw new DomainError('ADMIN_SIGN_IN_FAILED');
    }
  }

  /** Ends the one session (T061) on the sign-out call's transaction. Ending it again changes nothing. */
  async signOut(sessionId: string, tx: Pick<Transaction, 'adminSession'>): Promise<void> {
    await this.#sessions.revoke(tx, sessionId, this.#now());
  }

  /** Ends every open session of the administrator; how many. */
  revokeAll(adminId: string, tx: Pick<Transaction, 'adminSession'>): Promise<number> {
    return this.#sessions.revokeAllOf(tx, adminId, this.#now());
  }

  async #live(token: string): Promise<AdminSessionRow | null> {
    const row = await this.#sessions.findByTokenHash(hashLookupToken(token));
    if (row === null) return null;
    const now = this.#now();
    const idleMinutes = await this.#settings.read(SESSION_IDLE_SETTING, positiveWhole);
    const open =
      row.revokedAt === null &&
      row.expiresAt > now &&
      new Date(addMinutes(row.lastSeenAt, idleMinutes)) > now &&
      row.admin.isActive &&
      row.admin.passwordSetAt !== null;
    return open ? row : null;
  }
}

/** The administrator's session resolver `main.ts` hands the HTTP application (kernel.md). */
export function resolveAdminSession(
  dependencies: AdminSessionDependencies,
): (bearer: string) => Promise<ResolvedAdminSession | null> {
  const sessions = new AdminSessionService(dependencies);
  return (bearer) => sessions.resolve(bearer);
}
