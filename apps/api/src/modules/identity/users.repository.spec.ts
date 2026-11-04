// T024 (PR #80 review, 4) — `replacePhotoKey` is a conditional write, not a read-then-write: the
// row is updated only where it still holds the key that was read, and read again when another
// upload got there first, so the key a caller is told it replaced is the one it actually replaced
// and no object is orphaned in storage. Over a scripted client: what the repository asks of the
// table, not Postgres.
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../platform/db/prisma.repository.js';
import { displayNamesOf, UsersRepository } from './users.repository.js';

const USER = '0199d0a0-0000-7000-8000-00000000000a';

function clientOf(reads: readonly (string | null)[], counts: readonly number[]) {
  const findUnique = vi.fn(async () => ({
    photoKey: reads[findUnique.mock.calls.length - 1] ?? null,
  }));
  const updateMany = vi.fn(async () => ({ count: counts[updateMany.mock.calls.length - 1] ?? 0 }));
  return {
    database: { user: { findUnique, updateMany } } as unknown as Pick<Database, 'user'>,
    findUnique,
    updateMany,
  };
}

describe('replacePhotoKey (T024)', () => {
  it('updates only where the row still holds the key it read, and answers that key', async () => {
    const { database, updateMany } = clientOf(['photos/u/old.jpg'], [1]);
    await expect(
      new UsersRepository(database).replacePhotoKey(USER, 'photos/u/new.jpg'),
    ).resolves.toBe('photos/u/old.jpg');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: USER, photoKey: 'photos/u/old.jpg' },
      data: { photoKey: 'photos/u/new.jpg' },
    });
  });

  it('reads again when another upload changed the key first, and answers the key it did replace', async () => {
    const { database, findUnique, updateMany } = clientOf(
      ['photos/u/old.jpg', 'photos/u/other.jpg'],
      [0, 1],
    );
    await expect(
      new UsersRepository(database).replacePhotoKey(USER, 'photos/u/new.jpg'),
    ).resolves.toBe('photos/u/other.jpg');
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: USER, photoKey: 'photos/u/other.jpg' },
      data: { photoKey: 'photos/u/new.jpg' },
    });
  });

  it('answers null for a person who had no photo, matching the null in the condition', async () => {
    const { database, updateMany } = clientOf([null], [1]);
    await expect(
      new UsersRepository(database).replacePhotoKey(USER, 'photos/u/new.jpg'),
    ).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: USER, photoKey: null },
      data: { photoKey: 'photos/u/new.jpg' },
    });
  });

  it('refuses a user that does not exist', async () => {
    const findUnique = vi.fn(async () => null);
    const database = { user: { findUnique, updateMany: vi.fn() } } as unknown as Pick<
      Database,
      'user'
    >;
    await expect(
      new UsersRepository(database).replacePhotoKey(USER, 'photos/u/new.jpg'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// 003:T049 (FR-391, FR-395, R-HONEST-4): the names booking's lists show of an enrollment's other party,
// read in one statement by id, the display name and nothing else; a deleted account, which the
// client's extension leaves out and whose name is erased, is absent.
describe('displayNamesOf (003:T049)', () => {
  const OTHER = '0199d0a0-0000-7000-8000-00000000000b';

  it('reads the display names of the ids in one statement, selecting nothing else', async () => {
    const findMany = vi.fn(async () => [{ id: USER, displayName: 'يوسف علي' }]);
    const tx = { user: { findMany } } as unknown as Parameters<typeof displayNamesOf>[0];
    const names = await displayNamesOf(tx, [USER, OTHER]);
    expect([...names]).toEqual([[USER, 'يوسف علي']]);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: [USER, OTHER] } },
      select: { id: true, displayName: true },
    });
  });

  it('asks nothing for no id', async () => {
    const findMany = vi.fn();
    const tx = { user: { findMany } } as unknown as Parameters<typeof displayNamesOf>[0];
    expect((await displayNamesOf(tx, [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
