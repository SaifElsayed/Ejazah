// T024: the identity module's `users` rows as the photo route writes them (R-API-6). Queries only.
import type { Database } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'user'>;

export class UsersRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** Sets `photo_key`; answers the key it replaced, or null when the person had no photo. */
  async replacePhotoKey(userId: string, key: string): Promise<string | null> {
    const before = await this.#database.user.findUnique({
      where: { id: userId },
      select: { photoKey: true },
    });
    await this.#database.user.update({ where: { id: userId }, data: { photoKey: key } });
    return before?.photoKey ?? null;
  }
}
