// T025: the admin module's `admin_sessions` rows as the `purge-expired-sessions` sweep reaches them
// (R-API-6). Queries only; the sweep decides the window, and `worker.ts` hands this store to the
// job, since a job may not import this module (`boundaries/no-upward-admin-import`).
import type { Database } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'adminSession'>;

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
}
