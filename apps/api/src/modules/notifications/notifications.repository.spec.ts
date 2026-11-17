// T005 of specs/005-certification (R-406): the `notifications` queries the delivery job reaches, over
// a scripted client (what the repository asks of the table, not Postgres). The row is read with its
// ids in the port's names; a kind or a payload v1.0 does not write is refused, naming nothing of it;
// `pushed_at` is set only where it is NULL, so a second mark keeps the first time (R-API-14).
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../platform/db/prisma.repository.js';
import { NotificationsRepository } from './notifications.repository.js';

const NOTIFICATION = '0199f6a0-0000-7000-8000-00000000c001';
const USER = '0199f6a0-0000-7000-8000-0000000000a1';
const ENROLLMENT = '0199f6a0-0000-7000-8000-00000000e001';
const AT = new Date('2026-11-17T08:00:00Z');

function repositoryOver(row: Record<string, unknown> | null) {
  const findUnique = vi.fn(async () => row);
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const database = { notification: { findUnique, updateMany } } as unknown as Pick<
    Database,
    'notification'
  >;
  return { repository: new NotificationsRepository(database), findUnique, updateMany };
}

const stored = {
  id: NOTIFICATION,
  userId: USER,
  type: 'payment_confirmed',
  payload: { enrollment_id: ENROLLMENT },
  pushedAt: null,
};

describe('NotificationsRepository (T005)', () => {
  it('reads a notification with its ids in the port names', async () => {
    const { repository } = repositoryOver(stored);

    await expect(repository.find(NOTIFICATION)).resolves.toEqual({
      id: NOTIFICATION,
      userId: USER,
      kind: 'payment_confirmed',
      payload: { enrollmentId: ENROLLMENT },
      pushedAt: null,
    });
  });

  it('answers null for a notification that is not there', async () => {
    await expect(repositoryOver(null).repository.find(NOTIFICATION)).resolves.toBeNull();
  });

  it.each([
    ['a kind v1.0 does not push', { ...stored, type: 'new_review' }],
    ['a payload holding text', { ...stored, payload: { enrollment_id: 'Ahmed Ali' } }],
  ])('refuses %s, naming nothing of it', async (_case, row) => {
    const read = repositoryOver(row).repository.find(NOTIFICATION);

    await expect(read).rejects.toThrow(NOTIFICATION);
    await expect(read).rejects.not.toThrow(/Ahmed|new_review/);
  });

  it('sets pushed_at only where it is NULL', async () => {
    const { repository, updateMany } = repositoryOver(stored);

    await repository.markPushed(NOTIFICATION, AT);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: NOTIFICATION, pushedAt: null },
      data: { pushedAt: AT },
    });
  });
});
