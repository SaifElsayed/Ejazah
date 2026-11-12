// T024 (PR #80 review, 4) — `replacePhotoKey` is a conditional write, not a read-then-write: the
// row is updated only where it still holds the key that was read, and read again when another
// upload got there first, so the key a caller is told it replaced is the one it actually replaced
// and no object is orphaned in storage. Over a scripted client: what the repository asks of the
// table, not Postgres.
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../platform/db/prisma.repository.js';
import {
  displayNamesOf,
  userDirectoryPage,
  userRecordOf,
  UsersRepository,
} from './users.repository.js';

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

// T058 of specs/004-sessions (FR-481; SRS FR-ADMIN-4; the owner's decision Q8 of 2026-11-12): the user
// directory's two readers, past the soft-delete filter (`includeDeleted`, outside any transaction,
// as `DeletedPhotosRepository` reads), so a deleted user is listed and read, without its name.
describe('userDirectoryPage and userRecordOf (T058 of specs/004-sessions)', () => {
  const DELETED = '0199d0a0-0000-7000-8000-00000000000c';
  const JOINED = new Date('2026-09-01T08:00:00Z');
  const BORN = new Date('2012-03-04T00:00:00Z');

  function deletedClient(user: { findMany?: unknown; findUnique?: unknown }) {
    return { includeDeleted: { user } } as unknown as Pick<Database, 'includeDeleted'>;
  }

  it('reads a page newest first after the cursor, with the name, the deleted flag, the role and the status', async () => {
    const findMany = vi.fn(async () => [
      {
        id: USER,
        displayName: 'سارة',
        deletedAt: null,
        accountStatus: 'active',
        roles: [{ role: 'teacher' }],
      },
      {
        id: DELETED,
        displayName: 'الاسم القديم',
        deletedAt: new Date('2026-10-01T00:00:00Z'),
        accountStatus: 'banned',
        roles: [{ role: 'student' }],
      },
    ]);
    const page = await userDirectoryPage(deletedClient({ findMany }), DELETED, 26);
    expect(page).toEqual([
      { id: USER, displayName: 'سارة', deleted: false, role: 'teacher', accountStatus: 'active' },
      { id: DELETED, displayName: null, deleted: true, role: 'student', accountStatus: 'banned' },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { lt: DELETED } },
      orderBy: { id: 'desc' },
      take: 26,
      select: {
        id: true,
        displayName: true,
        deletedAt: true,
        accountStatus: true,
        roles: { select: { role: true } },
      },
    });
  });

  it('reads the first page with no condition, and answers a role row missing as null', async () => {
    const findMany = vi.fn(async () => [
      { id: USER, displayName: 'سارة', deletedAt: null, accountStatus: 'active', roles: [] },
    ]);
    const page = await userDirectoryPage(deletedClient({ findMany }), undefined, 3);
    expect(page).toEqual([
      { id: USER, displayName: 'سارة', deleted: false, role: null, accountStatus: 'active' },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, take: 3 }));
  });

  it("reads a user's record past the filter: name, email, sign-up instant, gender, date of birth, role, status, a teacher's profile", async () => {
    const findUnique = vi.fn(async () => ({
      id: USER,
      displayName: 'سارة',
      email: 'sara@example.test',
      createdAt: JOINED,
      deletedAt: null,
      gender: 'female',
      dateOfBirth: BORN,
      accountStatus: 'active',
      roles: [{ role: 'teacher' }],
      teacherProfile: {
        bio: 'معلمة',
        qualificationSummary: 'إجازة',
        verificationStatus: 'approved',
      },
    }));
    expect(await userRecordOf(deletedClient({ findUnique }), USER)).toEqual({
      id: USER,
      displayName: 'سارة',
      email: 'sara@example.test',
      createdAt: JOINED,
      deleted: false,
      gender: 'female',
      dateOfBirth: BORN,
      accountStatus: 'active',
      role: 'teacher',
      teacherProfile: { bio: 'معلمة', qualification: 'إجازة', verificationStatus: 'approved' },
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: USER },
      select: {
        id: true,
        displayName: true,
        email: true,
        createdAt: true,
        deletedAt: true,
        gender: true,
        dateOfBirth: true,
        accountStatus: true,
        roles: { select: { role: true } },
        teacherProfile: {
          select: { bio: true, qualificationSummary: true, verificationStatus: true },
        },
      },
    });
  });

  it("answers a deleted user's record without a name, and a student's without a teacher's profile", async () => {
    const findUnique = vi.fn(async () => ({
      id: DELETED,
      displayName: 'الاسم القديم',
      email: null,
      createdAt: JOINED,
      deletedAt: new Date('2026-10-01T00:00:00Z'),
      gender: 'male',
      dateOfBirth: null,
      accountStatus: 'active',
      roles: [{ role: 'student' }],
      teacherProfile: null,
    }));
    expect(await userRecordOf(deletedClient({ findUnique }), DELETED)).toEqual({
      id: DELETED,
      displayName: null,
      email: null,
      createdAt: JOINED,
      deleted: true,
      gender: 'male',
      dateOfBirth: null,
      accountStatus: 'active',
      role: 'student',
      teacherProfile: null,
    });
  });

  it('answers null for no such user', async () => {
    const findUnique = vi.fn(async () => null);
    expect(await userRecordOf(deletedClient({ findUnique }), USER)).toBeNull();
  });
});
