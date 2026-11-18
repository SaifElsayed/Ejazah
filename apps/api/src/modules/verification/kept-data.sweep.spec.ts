// T077 of specs/004-sessions/tasks.md (FR-509; SRS FR-ADMIN-21; the note under T077, Q-R4 (a);
// contracts/kernel.md, "Jobs", the `erase-kept-data` row; research R-323, P3-38) — what the daily
// `erase-kept-data` runs, verification's, over a recorded store (the real tables are
// `tests/db-integrity/kept-data.spec.ts`'). Written before the sweep, and run red first on a stub.
//
// Every kept profile whose erasure date passed is read a page at a time with no lock; each one is
// then erased in its own transaction under the profile's lock and its kept documents', read again
// there (a date cleared or moved meanwhile, or an erasure already done, erases nothing), with one
// info line `{ userId, reason: 'erase_date_reached', documents, payout }`; an item's failure is
// caught on its own, logged by its id and reported, and the run goes on. Run twice, it leaves what
// one run leaves (R-API-14, `runOnceAndTwice`). ⚠️ Automatic and final.
import { describe, expect, it } from 'vitest';

import { runOnceAndTwice } from '../../jobs/double-run.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import type { KeptProfile } from '../identity/index.js';
import type { KeptDataStore } from './kept-data.service.js';
import { createKeptDataErasureSweep } from './kept-data.sweep.js';

const NOW = new Date('2026-11-14T04:25:00.000Z');
const PASSED = new Date('2026-11-14T00:00:00.000Z');
const AHEAD = new Date('2026-11-20T00:00:00.000Z');

const user = (n: number) => `0199d0a0-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;
const profileOf = (n: number) => `0199d0a0-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;

interface Row {
  profile: KeptProfile;
  documents: number;
}

interface World {
  readonly rows: Map<string, Row>;
  readonly lines: { level: string; entry: object }[];
  readonly reported: Error[];
  transactions: number;
  /** A user whose item fails once read under its locks. */
  failing?: string;
  /** Run when a user's lock is taken, before it is read again (a race staged under the lock). */
  onLock?: (userId: string) => void;
}

function worldOf(entries: readonly [number, Partial<KeptProfile>, number][]): World {
  const rows = new Map<string, Row>();
  for (const [n, profile, documents] of entries) {
    rows.set(user(n), {
      profile: {
        profileId: profileOf(n),
        userId: user(n),
        keptAt: new Date('2026-11-01T09:00:00.000Z'),
        eraseAt: PASSED,
        erasedAt: null,
        payoutKept: true,
        ...profile,
      },
      documents,
    });
  }
  return { rows, lines: [], reported: [], transactions: 0 };
}

function storeOver(w: World): KeptDataStore {
  const rowOfProfile = (profileId: string) =>
    [...w.rows.values()].find(({ profile }) => profile.profileId === profileId);
  return {
    lockProfile: async (_tx, userId) => {
      w.onLock?.(userId);
    },
    profileOf: async (_tx, userId) => {
      if (w.failing === userId) throw new Error('spec: unreachable');
      return w.rows.get(userId)?.profile ?? null;
    },
    documentsOf: async (_tx, userId) => {
      const row = w.rows.get(userId);
      if (row === undefined || row.profile.erasedAt !== null) return [];
      return Array.from({ length: row.documents }, (_, index) => ({
        id: `${row.profile.profileId.slice(0, -2)}${String(index).padStart(2, '0')}`,
        documentType: 'national_id' as const,
        uploadedAt: new Date('2026-10-01T00:00:00Z'),
        storageKeyEncrypted: Uint8Array.from([index]),
      }));
    },
    lockDocuments: async () => undefined,
    setEraseDate: async () => {
      throw new Error('the sweep never sets a date');
    },
    eraseProfile: async (_tx, profileId, at) => {
      const row = rowOfProfile(profileId);
      if (row === undefined || row.profile.erasedAt !== null) return false;
      row.profile = { ...row.profile, erasedAt: at, payoutKept: false };
      return true;
    },
    eraseDocuments: async (_tx, ids) => ids.length,
    // The page is read with no lock, so it may list a profile another run erased meanwhile: only
    // the read under the lock decides (here, every passed date, erased or not).
    duePage: async (_tx, now, after, limit) =>
      [...w.rows.values()]
        .map(({ profile }) => profile)
        .filter(
          (profile) =>
            profile.eraseAt !== null &&
            profile.eraseAt.getTime() <= now.getTime() &&
            (after === undefined || profile.profileId > after),
        )
        .sort((a, b) => a.profileId.localeCompare(b.profileId))
        .slice(0, limit)
        .map(({ profileId, userId }) => ({ profileId, userId })),
    payoutKeptOnDeletedTeacher: async () => false,
    // 005:T031 (rule d): the store reads the kept signature too; the sweep never asks it.
    signatureOf: async () => null,
  };
}

function sweepOver(w: World, pageSize = 10) {
  const transactions: Transactions = {
    run: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
      w.transactions += 1;
      return work({} as Transaction);
    },
  };
  return createKeptDataErasureSweep({
    transactions,
    log: {
      info: (entry: object) => void w.lines.push({ level: 'info', entry }),
      error: (entry: object) => void w.lines.push({ level: 'error', entry }),
    },
    pageSize,
    report: (error) => void w.reported.push(error),
    clock: async () => NOW,
    store: storeOver(w),
  });
}

const erasedOf = (w: World) =>
  [...w.rows.values()].map(({ profile }) => [
    profile.userId,
    profile.erasedAt?.toISOString() ?? null,
  ]);

describe('erase-kept-data: the sweep (T077, FR-509) ⚠️ automatic and final', () => {
  it('erases each kept profile whose date passed, each in its own transaction, with one info line', async () => {
    const w = worldOf([
      [1, {}, 2],
      [2, { eraseAt: AHEAD }, 1],
      [3, { eraseAt: null }, 1],
      [4, { payoutKept: false }, 0],
    ]);
    expect(await sweepOver(w).run()).toEqual({ erased: [user(1), user(4)], failed: [] });
    expect(erasedOf(w)).toEqual([
      [user(1), NOW.toISOString()],
      [user(2), null],
      [user(3), null],
      [user(4), NOW.toISOString()],
    ]);
    expect(w.lines).toEqual([
      {
        level: 'info',
        entry: { userId: user(1), reason: 'erase_date_reached', documents: 2, payout: true },
      },
      {
        level: 'info',
        entry: { userId: user(4), reason: 'erase_date_reached', documents: 0, payout: false },
      },
    ]);
    // One read of the page, one transaction per item.
    expect(w.transactions).toBe(3);
  });

  it('erases nothing for a date cleared or moved after the page was read, read again under the lock', async () => {
    const w = worldOf([
      [1, {}, 1],
      [2, {}, 1],
    ]);
    w.onLock = (userId) => {
      const row = w.rows.get(userId);
      if (row === undefined) return;
      row.profile = { ...row.profile, eraseAt: userId === user(1) ? null : AHEAD };
    };
    expect(await sweepOver(w).run()).toEqual({ erased: [], failed: [] });
    expect(erasedOf(w)).toEqual([
      [user(1), null],
      [user(2), null],
    ]);
    expect(w.lines).toEqual([]);
  });

  it('catches an item’s failure on its own, logs its id and reports it, and goes on', async () => {
    const w = worldOf([
      [1, {}, 1],
      [2, {}, 1],
    ]);
    w.failing = user(1);
    expect(await sweepOver(w).run()).toEqual({ erased: [user(2)], failed: [user(1)] });
    expect(w.lines).toContainEqual({ level: 'error', entry: { userId: user(1) } });
    expect(w.reported).toHaveLength(1);
  });

  it('reads the candidates a page at a time', async () => {
    const w = worldOf([
      [1, {}, 1],
      [2, {}, 1],
      [3, {}, 1],
    ]);
    expect((await sweepOver(w, 1).run()).erased).toEqual([user(1), user(2), user(3)]);
  });

  it('run twice, leaves what one run leaves (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () =>
        worldOf([
          [1, {}, 2],
          [2, { eraseAt: AHEAD }, 1],
        ]),
      run: async (w) => {
        await sweepOver(w).run();
      },
      observe: (w) => ({ erased: erasedOf(w), lines: w.lines }),
    });
    expect(twice).toEqual(once);
  });
});
