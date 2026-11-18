// 005:T031 of specs/005-certification (FR-631; R-411; the note under T031, Q-D3 (a), Q-D4 (a)) — a
// deleted teacher's signature, erased once it is no longer kept, over a recorded store (the real
// tables are `tests/db-integrity/teacher-deletion.spec.ts`'). Written before the erasure, and run red
// first on a stub.
//
// - A page answers only the signatures whose owner identity answers erasable, in id order, reading
//   the table again until the page is full or the table ends.
// - The file is removed first, then the row deleted where it still holds that key; a removal that
//   fails leaves the row and throws.
// - The deletion's work after its commit erases an erasable teacher's signature and leaves a kept
//   one's file and row alone.
import { describe, expect, it } from 'vitest';

import type { Database } from '../../platform/db/prisma.repository.js';
import { createKeptSignatureErasure, type KeptSignatureStore } from './kept-data.signatures.js';

interface Row {
  readonly id: string;
  readonly teacherUserId: string;
  readonly storageKey: string;
}

function world(rows: readonly Row[], erasable: readonly string[], failing: readonly string[] = []) {
  const live = rows.map((row) => ({ ...row }));
  const calls: string[] = [];
  const store: KeptSignatureStore = {
    page: async (after, limit) => {
      calls.push(`page ${after ?? '-'} ${String(limit)}`);
      return live
        .filter(({ id }) => after === undefined || id > after)
        .sort((left, right) => (left.id < right.id ? -1 : 1))
        .slice(0, limit);
    },
    rowOf: async (teacherUserId) => live.find((row) => row.teacherUserId === teacherUserId) ?? null,
    erasableAmong: async (userIds) => {
      calls.push(`erasable ${userIds.join(',')}`);
      return new Set(userIds.filter((userId) => erasable.includes(userId)));
    },
    remove: async ({ id, storageKey }) => {
      calls.push(`delete ${id}`);
      const at = live.findIndex((row) => row.id === id && row.storageKey === storageKey);
      if (at === -1) return false;
      live.splice(at, 1);
      return true;
    },
  };
  const storage = {
    async remove(key: string) {
      calls.push(`remove ${key}`);
      if (failing.includes(key)) throw new Error('spec storage: unreachable');
    },
  };
  const erasure = createKeptSignatureErasure({ database: {} as Database, storage, store });
  return { erasure, live, calls };
}

const row = (n: number, owner: string): Row => ({
  id: `sig-${String(n)}`,
  teacherUserId: owner,
  storageKey: `signatures/${owner}.png`,
});

describe('the kept signature’s erasure (005:T031)', () => {
  it('answers only the erasable owners’ signatures, in id order, reading on until the page is full', async () => {
    const { erasure } = world(
      [row(1, 'kept-1'), row(2, 'gone-1'), row(3, 'kept-2'), row(4, 'kept-3'), row(5, 'gone-2')],
      ['gone-1', 'gone-2'],
    );
    expect(await erasure.pendingPage(undefined, 2)).toEqual([
      { id: 'sig-2', ownerUserId: 'gone-1', storageKey: 'signatures/gone-1.png' },
      { id: 'sig-5', ownerUserId: 'gone-2', storageKey: 'signatures/gone-2.png' },
    ]);
    expect(await erasure.pendingPage('sig-5', 2)).toEqual([]);
  });

  it('answers a short page only once the table ends, and resumes after the last file answered', async () => {
    const { erasure } = world(
      [row(1, 'gone-1'), row(2, 'gone-2'), row(3, 'gone-3')],
      ['gone-1', 'gone-2', 'gone-3'],
    );
    const first = await erasure.pendingPage(undefined, 2);
    expect(first.map(({ id }) => id)).toEqual(['sig-1', 'sig-2']);
    const second = await erasure.pendingPage(first.at(-1)?.id, 2);
    expect(second.map(({ id }) => id)).toEqual(['sig-3']);
  });

  it('deletes the row where it still holds the key, and answers false for another key or a row gone', async () => {
    const { erasure, live } = world([row(1, 'gone-1')], ['gone-1']);
    expect(
      await erasure.clearKey({ id: 'sig-1', ownerUserId: 'gone-1', storageKey: 'other.png' }),
    ).toBe(false);
    expect(live).toHaveLength(1);
    const file = { id: 'sig-1', ownerUserId: 'gone-1', storageKey: 'signatures/gone-1.png' };
    expect(await erasure.clearKey(file)).toBe(true);
    expect(live).toEqual([]);
    expect(await erasure.clearKey(file)).toBe(false);
  });

  it('after a deletion’s commit: removes an erasable teacher’s file, then deletes the row', async () => {
    const { erasure, live, calls } = world([row(1, 'gone-1')], ['gone-1']);
    await erasure.eraseFilesOf('gone-1');
    expect(live).toEqual([]);
    expect(calls.filter((call) => !call.startsWith('erasable'))).toEqual([
      'remove signatures/gone-1.png',
      'delete sig-1',
    ]);
  });

  it('after a deletion’s commit: leaves a kept signature’s file and row alone', async () => {
    const { erasure, live, calls } = world([row(1, 'kept-1')], []);
    await erasure.eraseFilesOf('kept-1');
    expect(live).toHaveLength(1);
    expect(calls.some((call) => call.startsWith('remove') || call.startsWith('delete'))).toBe(
      false,
    );
  });

  it('a removal that fails keeps the row and throws, for the job to try again', async () => {
    const { erasure, live } = world([row(1, 'gone-1')], ['gone-1'], ['signatures/gone-1.png']);
    await expect(erasure.eraseFilesOf('gone-1')).rejects.toThrow('spec storage: unreachable');
    expect(live).toHaveLength(1);
  });

  it('does nothing for a teacher with no signature', async () => {
    const { erasure, calls } = world([], ['gone-1']);
    await erasure.eraseFilesOf('gone-1');
    expect(calls.some((call) => call.startsWith('remove') || call.startsWith('delete'))).toBe(
      false,
    );
  });
});
