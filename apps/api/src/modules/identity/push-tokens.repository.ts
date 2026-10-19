// T025: the identity module's `device_push_tokens` rows as the `purge-stale-push-tokens` sweep
// reaches them (R-API-6). Queries only; the sweep decides the window. The re-encryption job reaches
// the same table's `token_encrypted` through `identity.repository.ts` (T155).
import type { Database } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'devicePushToken'>;

export class PushTokensRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** Deletes the tokens last seen before `staleBefore`; how many went. */
  async removeNotSeenSince(staleBefore: Date): Promise<number> {
    const { count } = await this.#database.devicePushToken.deleteMany({
      where: { lastSeenAt: { lt: staleBefore } },
    });
    return count;
  }
}
