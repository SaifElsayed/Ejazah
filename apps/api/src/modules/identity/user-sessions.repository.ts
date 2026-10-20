// T025: the identity module's `user_sessions` rows as the `purge-expired-sessions` sweep reaches
// them (R-API-6). T047 adds the queries the session service needs (research R-101): the row a
// refresh token's hash names, the conditional rotation and revocation, and the one read a request's
// session resolution makes (data-model §6). T094 keeps every hash a rotation retires in
// `user_session_retired_tokens`, written in the rotation's own transaction, and finds the session
// any of them names. Queries only; the service decides what a token means. A session is a
// credential, deleted outright: the application role keeps DELETE on both tables (ERD §2,
// data-model.md §2), and a session's retired hashes go with it (ON DELETE CASCADE).
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'userSession' | 'userSessionRetiredToken'>;
type Writer = Pick<Transaction, 'userSession'>;
type Rotator = Pick<Transaction, 'userSession' | 'userSessionRetiredToken'>;

/** Why a session ended (ERD §2, `session_revoked_reason`). */
export type SessionRevokedReason =
  | 'sign_out'
  | 'reuse_detected'
  | 'password_reset'
  | 'account_deleted'
  | 'account_suspended'
  | 'account_banned'
  | 'admin_action';

/** What a refresh reads of the row its token names. */
export interface RefreshRow {
  readonly id: string;
  readonly refreshTokenHash: string;
  readonly refreshedAt: Date | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

/** What one request reads to resolve its session (data-model §6). */
export interface LiveSessionRow {
  readonly id: string;
  readonly userId: string;
  readonly gender: 'male' | 'female';
  readonly preferredLanguage: 'ar' | 'en';
  readonly accountStatus: 'active' | 'suspended' | 'verification_required' | 'banned';
  readonly role: 'student' | 'teacher' | null;
  readonly teacher: {
    readonly verificationStatus:
      'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';
    readonly payoutVerifiedAt: Date | null;
    readonly applicationStatus:
      'in_review' | 'needs_document' | 'rejected' | 'banned' | 'approved' | null;
  } | null;
}

export class UserSessionsRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** Deletes the rows expired at `now` and those revoked before `revokedBefore`; how many went. */
  async removeExpiredOrRevokedBefore(now: Date, revokedBefore: Date): Promise<number> {
    const { count } = await this.#database.userSession.deleteMany({
      where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { lt: revokedBefore } }] },
    });
    return count;
  }

  /** Writes a new session's row; its id. */
  async insert(
    tx: Writer,
    row: {
      readonly userId: string;
      readonly refreshTokenHash: string;
      readonly issuedAt: Date;
      readonly expiresAt: Date;
    },
  ): Promise<string> {
    const { id } = await tx.userSession.create({ data: row, select: { id: true } });
    return id;
  }

  /** The row whose current refresh token hashes to `hash`. */
  findByRefreshHash(hash: string): Promise<RefreshRow | null> {
    return this.#database.userSession.findUnique({
      where: { refreshTokenHash: hash },
      select: {
        id: true,
        refreshTokenHash: true,
        refreshedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
  }

  /** The row whose retired refresh token hashes to `hash`. */
  findByPreviousHash(hash: string): Promise<RefreshRow | null> {
    return this.#database.userSession.findFirst({
      where: { previousRefreshTokenHash: hash },
      select: {
        id: true,
        refreshTokenHash: true,
        refreshedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
  }

  /**
   * Rotates the row, inside `tx`, from the refresh token hashing to `from` to the one hashing to
   * `to`: `from` becomes the retired hash the grace window reads, and joins the session's retired
   * hashes for good (T094). Only where the row is live and still holds `from`, so of two rotations
   * racing on one token exactly one is applied. True when it was.
   */
  async rotate(
    tx: Rotator,
    id: string,
    from: string,
    { to, at }: { readonly to: string; readonly at: Date },
  ): Promise<boolean> {
    const { count } = await tx.userSession.updateMany({
      where: { id, refreshTokenHash: from, revokedAt: null, expiresAt: { gt: at } },
      data: { refreshTokenHash: to, previousRefreshTokenHash: from, refreshedAt: at },
    });
    if (count !== 1) return false;
    await tx.userSessionRetiredToken.create({
      data: { sessionId: id, tokenHash: from, retiredAt: at },
      select: { id: true },
    });
    return true;
  }

  /** The session a retired refresh token's hash names, whichever rotation retired it (T094). */
  async findSessionByRetiredHash(hash: string): Promise<string | null> {
    const row = await this.#database.userSessionRetiredToken.findUnique({
      where: { tokenHash: hash },
      select: { sessionId: true },
    });
    return row?.sessionId ?? null;
  }

  /** Revokes one live row. */
  async revoke(id: string, reason: SessionRevokedReason, at: Date): Promise<void> {
    await this.#database.userSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at, revokedReason: reason },
    });
  }

  /** Revokes every live row of `userId` but `except`, inside `tx` when one is given; how many. */
  async revokeAll(
    tx: Writer | undefined,
    userId: string,
    reason: SessionRevokedReason,
    { at, except }: { readonly at: Date; readonly except?: string | undefined },
  ): Promise<number> {
    const { count } = await (tx ?? this.#database).userSession.updateMany({
      where: { userId, revokedAt: null, ...(except === undefined ? {} : { id: { not: except } }) },
      data: { revokedAt: at, revokedReason: reason },
    });
    return count;
  }

  /**
   * The one read of a request (data-model §6): the session not revoked and not expired at `now`,
   * its live person, the one role and, for a teacher, the profile's standing. Null when the session
   * or its person is gone.
   */
  async readLive(sessionId: string, now: Date): Promise<LiveSessionRow | null> {
    const row = await this.#database.userSession.findFirst({
      where: {
        id: sessionId,
        revokedAt: null,
        expiresAt: { gt: now },
        user: { deletedAt: null },
      },
      select: {
        id: true,
        userId: true,
        user: {
          select: {
            gender: true,
            preferredLanguage: true,
            accountStatus: true,
            roles: { select: { role: true } },
            teacherProfile: {
              select: { verificationStatus: true, payoutVerifiedAt: true, applicationStatus: true },
            },
          },
        },
      },
    });
    if (row === null) return null;
    return {
      id: row.id,
      userId: row.userId,
      gender: row.user.gender,
      preferredLanguage: row.user.preferredLanguage,
      accountStatus: row.user.accountStatus,
      role: row.user.roles[0]?.role ?? null,
      teacher: row.user.teacherProfile,
    };
  }
}
