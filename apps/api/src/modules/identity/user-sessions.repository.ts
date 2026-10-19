// T025: the identity module's `user_sessions` rows as the `purge-expired-sessions` sweep reaches
// them (R-API-6). Queries only; the sweep decides the window. A session is a credential, deleted
// outright: the application role keeps DELETE on this table (ERD §6, data-model.md §2).
import type { Database } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'userSession'>;

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
}
