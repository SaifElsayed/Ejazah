// T047: a device's session (research R-101, FR-135, FR-108).
//
// THE ACCESS TOKEN is `v1.<session id>.<expiry>.<HMAC-SHA256>`, the key derived from ENCRYPTION_KEY
// under `ijazah:access-token:v1`, the expiry an instant in canonical UTC (`session_access_ttl_minutes`
// after issue or refresh). It is a pointer, never a claim set: `resolveUserSession` checks the
// signature and the expiry, then reads the row and the account's standing in one query on every
// request (data-model §6), so a revocation or a suspension shows at once.
//
// THE REFRESH TOKEN is 32 random bytes in base64url, stored only as its SHA-256 lookup hash, with
// an absolute lifetime of `session_refresh_ttl_days` from issue that rotation never extends. Each
// refresh rotates it, keeps the retired hash on the row for the grace window, and keeps it for good
// among the session's retired hashes (T094). The last retired token presented within
// `session_refresh_grace_seconds` of the rotation is answered once more, with another rotation
// that retires the token it had been given in the meantime (a device that lost the first answer is
// not signed out). Any other retired token, whichever rotation retired it, revokes the session
// (`reuse_detected`): so a stolen token rotated twice to evict the device's is caught the moment the
// device presents its own (review of B9, observation 9; owner's decision 2026-10-20, the safe
// option, at the price of a device that lost two answers in a row signing in again). A token that
// is no session's, or names a revoked or expired one, is refused with UNAUTHENTICATED and nothing
// else, so a refusal never says why (FR-135).
//
// Sign-out revokes the device's row; `revokeAll` revokes every live row of the person, but the one
// a password reset just issued, for deletion, ban, suspension, a reset and an administrator action.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { addDays, addMinutes, addSeconds } from '@ijazah/time';
import { z } from 'zod';

import { ACCESS_TOKEN_LABEL, deriveSubkey } from '../../platform/crypto/encryption.js';
import { hashLookupToken } from '../../platform/crypto/hashing.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { generateSecretToken } from '../../platform/guards/identifiers.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { AccountsRepository, type AccountStanding } from './identity.repository.js';
import { type SessionRevokedReason, UserSessionsRepository } from './user-sessions.repository.js';

export const ACCESS_TTL_SETTING = 'session_access_ttl_minutes';
export const REFRESH_TTL_SETTING = 'session_refresh_ttl_days';
export const REFRESH_GRACE_SETTING = 'session_refresh_grace_seconds';

const positiveWhole = z.int().positive();
const ACCESS_VERSION = 'v1';

/** What the identity services share. */
export interface IdentityDependencies {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly encryptionKey: string;
  readonly now?: () => Date;
}

/** Where the app lands after a sign-in (FR-130, FR-137; `landing` in packages/contracts). */
export type Landing = 'student_home' | 'teacher_application' | 'teacher_home' | 'restricted';

/** What `revokeAll` may be told: a session to keep, a transaction to write in. */
export interface RevokeAllOptions {
  readonly except?: string | undefined;
  readonly tx?: Transaction | undefined;
}

/** A session's two tokens. */
export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/** What a request's session resolves to (data-model §6; `UserSession` in surfaces/context.ts). */
export interface ResolvedUserSession {
  readonly userId: string;
  readonly sessionId: string;
  readonly role: 'student' | 'teacher';
  readonly gender: 'male' | 'female';
  readonly preferredLanguage: 'ar' | 'en';
  readonly accountStatus: 'active' | 'suspended' | 'verification_required' | 'banned';
  /** A teacher's standing once the application exists (R-106); absent before. */
  readonly teacher?: {
    readonly verificationStatus:
      'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';
    readonly payoutVerified: boolean;
    readonly applicationStatus: 'in_review' | 'needs_document' | 'rejected' | 'banned' | 'approved';
  };
  /**
   * When the bearer access token expires, as it carries it (T063 of specs/004-sessions, additive):
   * a live stream opened with it ends then (FR-429; research R-324, item 8).
   */
  readonly accessExpiresAt: Date;
}

/**
 * Where an account lands (FR-130, FR-137): a suspended or banned account on the restricted screen;
 * a student home; a teacher home once approved, on the application otherwise.
 */
export function landingFor(
  standing: Pick<AccountStanding, 'role' | 'accountStatus' | 'teacher'>,
): Landing {
  if (standing.accountStatus === 'suspended' || standing.accountStatus === 'banned') {
    return 'restricted';
  }
  if (standing.role === 'student') return 'student_home';
  return standing.teacher?.verificationStatus === 'approved'
    ? 'teacher_home'
    : 'teacher_application';
}

function refused(): DomainError {
  return new DomainError('UNAUTHENTICATED');
}

export class SessionService {
  readonly #sessions: UserSessionsRepository;
  readonly #accounts: AccountsRepository;
  readonly #transactions;
  readonly #settings: SettingsReader;
  readonly #key: Buffer;
  readonly #now: () => Date;

  constructor(dependencies: IdentityDependencies) {
    this.#sessions = new UserSessionsRepository(dependencies.database);
    this.#accounts = new AccountsRepository(dependencies.database);
    this.#transactions = transactionsOver(dependencies.database);
    this.#settings = dependencies.settings;
    this.#key = deriveSubkey(dependencies.encryptionKey, ACCESS_TOKEN_LABEL);
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** A new session for `userId`, written inside `tx` when one is given. */
  async issue(userId: string, tx?: Transaction): Promise<SessionTokens> {
    const days = await this.#settings.read(REFRESH_TTL_SETTING, positiveWhole);
    const now = this.#now();
    const refreshToken = generateSecretToken();
    const row = {
      userId,
      refreshTokenHash: hashLookupToken(refreshToken),
      issuedAt: now,
      expiresAt: new Date(addDays(now, days)),
    };
    const sessionId =
      tx === undefined
        ? await this.#transactions.run((own) => this.#sessions.insert(own, row))
        : await this.#sessions.insert(tx, row);
    return { accessToken: await this.#accessToken(sessionId), refreshToken };
  }

  /** Where `userId` lands now, read inside `tx` when one is given. */
  async landing(userId: string, tx?: Pick<Transaction, 'user'>): Promise<Landing> {
    const standing = await this.#accounts.readStanding(userId, tx);
    if (standing === null) throw new Error('A session was issued for a person with no role.');
    return landingFor(standing);
  }

  /** Rotates the refresh token (research R-101); UNAUTHENTICATED for anything it refuses. */
  async refresh(refreshToken: string): Promise<SessionTokens> {
    const now = this.#now();
    const presented = hashLookupToken(refreshToken);
    const current = await this.#sessions.findByRefreshHash(presented);
    if (current !== null) return this.#rotate(current.id, presented, now);
    const last = await this.#sessions.findByPreviousHash(presented);
    if (last !== null && last.revokedAt === null && now < last.expiresAt) {
      const grace = await this.#settings.read(REFRESH_GRACE_SETTING, positiveWhole);
      if (last.refreshedAt !== null && now < new Date(addSeconds(last.refreshedAt, grace))) {
        // Answered once: the token handed out meanwhile is retired in its place, so this one is no
        // longer the last retired, and a further presentation of it revokes the session.
        return this.#rotate(last.id, last.refreshTokenHash, now);
      }
    }
    const reused = await this.#sessions.findSessionByRetiredHash(presented);
    if (reused !== null) await this.#sessions.revoke(reused, 'reuse_detected', now);
    throw refused();
  }

  async #rotate(id: string, from: string, now: Date): Promise<SessionTokens> {
    const refreshToken = generateSecretToken();
    const to = hashLookupToken(refreshToken);
    const rotated = await this.#transactions.run((tx) =>
      this.#sessions.rotate(tx, id, from, { to, at: now }),
    );
    if (!rotated) throw refused();
    return { accessToken: await this.#accessToken(id), refreshToken };
  }

  /** Revokes one device's session (`sign_out`). */
  async signOut(sessionId: string): Promise<void> {
    await this.#sessions.revoke(sessionId, 'sign_out', this.#now());
  }

  /** Revokes every live session of `userId` but `except`, inside `tx` when given; how many. */
  revokeAll(
    userId: string,
    reason: SessionRevokedReason,
    options: RevokeAllOptions = {},
  ): Promise<number> {
    return this.#sessions.revokeAll(options.tx, userId, reason, {
      at: this.#now(),
      except: options.except,
    });
  }

  /** The session a bearer points at, or null; never a throw for a token it does not accept. */
  async resolveUserSession(bearer: string): Promise<ResolvedUserSession | null> {
    const [version, sessionId, expiry, mac, ...rest] = bearer.split('.');
    if (
      version !== ACCESS_VERSION ||
      sessionId === undefined ||
      expiry === undefined ||
      mac === undefined ||
      rest.length > 0 ||
      !this.#signed(`${version}.${sessionId}.${expiry}`, mac)
    ) {
      return null;
    }
    const now = this.#now();
    const expiresAt = new Date(expiry);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) return null;
    const row = await this.#sessions.readLive(sessionId, now);
    if (row === null || row.role === null) return null;
    const teacher =
      row.role === 'teacher' && row.teacher !== null && row.teacher.applicationStatus !== null
        ? {
            verificationStatus: row.teacher.verificationStatus,
            payoutVerified: row.teacher.payoutVerifiedAt !== null,
            applicationStatus: row.teacher.applicationStatus,
          }
        : undefined;
    return {
      userId: row.userId,
      sessionId: row.id,
      role: row.role,
      gender: row.gender,
      preferredLanguage: row.preferredLanguage,
      accountStatus: row.accountStatus,
      ...(teacher === undefined ? {} : { teacher }),
      accessExpiresAt: expiresAt,
    };
  }

  async #accessToken(sessionId: string): Promise<string> {
    const minutes = await this.#settings.read(ACCESS_TTL_SETTING, positiveWhole);
    const body = `${ACCESS_VERSION}.${sessionId}.${addMinutes(this.#now(), minutes)}`;
    return `${body}.${this.#mac(body)}`;
  }

  #mac(body: string): string {
    return createHmac('sha256', this.#key).update(body).digest('base64url');
  }

  #signed(body: string, mac: string): boolean {
    const expected = Buffer.from(this.#mac(body));
    const given = Buffer.from(mac);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
