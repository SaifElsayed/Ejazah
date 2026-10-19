// T024: the identity module's `users` rows as the photo route writes them (R-API-6). Queries only.
//
// `replacePhotoKey` is a conditional write (PR #80 review, finding 4): the row is updated only
// where it still holds the key that was read, and read again when another upload got there first,
// so the key the caller is told it replaced is the one it did replace and no object is orphaned in
// storage. The database decides the race, not the order of two statements.
import type { Database } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';

type Client = Pick<Database, 'user'>;

export class UsersRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** Sets `photo_key`; answers the key it replaced, or null when the person had no photo. */
  async replacePhotoKey(userId: string, key: string): Promise<string | null> {
    for (;;) {
      const before = await this.#database.user.findUnique({
        where: { id: userId },
        select: { photoKey: true },
      });
      if (before === null) throw new DomainError('NOT_FOUND');
      const { count } = await this.#database.user.updateMany({
        where: { id: userId, photoKey: before.photoKey },
        data: { photoKey: key },
      });
      if (count === 1) return before.photoKey;
    }
  }
}
