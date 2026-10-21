// T025: the admin module's `admin_sessions` rows as the `purge-expired-sessions` sweep reaches them
// (R-API-6). Queries only; the sweep decides the window, and `worker.ts` hands this store to the
// job, since a job may not import this module (`boundaries/no-upward-admin-import`). T066 adds what
// the session service reads and writes (research R-107, data-model §6): the row a token's hash
// names with its administrator's standing, and the conditional marks of a session's life.
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'adminSession'>;
type Writer = Pick<Transaction, 'adminSession'>;

/** A session's row with the columns of its administrator that decide whether it may be used. */
export interface AdminSessionRow {
  readonly id: string;
  readonly adminId: string;
  readonly mfaVerifiedAt: Date | null;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly admin: {
    readonly isActive: boolean;
    readonly passwordSetAt: Date | null;
    readonly mfaEnrolledAt: Date | null;
  };
}

export class AdminSessionsRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** Deletes the rows expired at `now` and those revoked before `revokedBefore`; how many went. */
  async removeExpiredOrRevokedBefore(now: Date, revokedBefore: Date): Promise<number> {
    const { count } = await this.#database.adminSession.deleteMany({
      where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { lt: revokedBefore } }] },
    });
    return count;
  }

  /** Writes a new session's row; its id. */
  async insert(
    tx: Writer,
    row: {
      readonly adminId: string;
      readonly tokenHash: string;
      readonly issuedAt: Date;
      readonly expiresAt: Date;
    },
  ): Promise<string> {
    const { id } = await tx.adminSession.create({
      data: { ...row, lastSeenAt: row.issuedAt },
      select: { id: true },
    });
    return id;
  }

  /** The session a token's hash names, with its administrator's standing; null if none. */
  async findByTokenHash(tokenHash: string): Promise<AdminSessionRow | null> {
    return this.#database.adminSession.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        adminId: true,
        mfaVerifiedAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        admin: { select: { isActive: true, passwordSetAt: true, mfaEnrolledAt: true } },
      },
    });
  }

  /** Moves the idle limit's start to `now`, where the session is still open. */
  async touch(id: string, now: Date): Promise<void> {
    await this.#database.adminSession.updateMany({
      where: { id, revokedAt: null, lastSeenAt: { lt: now } },
      data: { lastSeenAt: now },
    });
  }

  /** Marks the second factor passed on an open, unverified session; false if it was not one. */
  async markVerified(tx: Writer, id: string, now: Date): Promise<boolean> {
    const { count } = await tx.adminSession.updateMany({
      where: { id, revokedAt: null, mfaVerifiedAt: null },
      data: { mfaVerifiedAt: now, lastSeenAt: now },
    });
    return count === 1;
  }

  /** Ends one session, where it is still open. */
  async revoke(tx: Writer, id: string, now: Date): Promise<void> {
    await tx.adminSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  /** Ends every open session of an administrator; how many. */
  async revokeAllOf(tx: Writer, adminId: string, now: Date): Promise<number> {
    const { count } = await tx.adminSession.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: now },
    });
    return count;
  }
}
