// B16 (T082; the B16 check, decision 1; Egypt PDPL): the `erase-deleted-files` sweep.
//
// A deletion removes a person's stored files after its commit and clears each key only once its file
// is gone; a removal that failed leaves the key, so the file is never forgotten. The sweep retries
// them: every document row the deletion marked erased that still holds its key (the verification
// module's store) and every deleted person whose photo key is still held (the identity module's).
// For each it removes the file through the storage port, then clears the key; a file that still
// cannot be removed keeps its key for the next run, is reported, and does not stop the others.
// Pages are read in id order after the last one read, so the run is bounded. Its double-run
// assertion calls the handler directly over in-memory stores: two runs leave what one run leaves.
//
// T004 of specs/004-sessions (FR-487; research R-327; the owner's decision of 2026-11-05): a file's
// owner is asked once per page through `held` (booking's `heldFileOwnersAmong`); a held owner's
// files are neither removed nor reported and the page goes on in id order, the next page read as
// before; the first run after the owner's last open matter closes removes them.
import { describe, expect, it } from 'vitest';

import { runOnceAndTwice } from './double-run.js';
import { type ErasedFile, type ErasedFileStore, eraseDeletedFiles } from './erase-deleted-files.js';

interface Row {
  readonly id: string;
  readonly owner: string;
  key: string | null;
}

function storeOf(rows: readonly Row[]) {
  const store: ErasedFileStore & { rows: Row[]; pages: number } = {
    rows: rows.map((row) => ({ ...row })),
    pages: 0,
    async pendingPage(after, limit) {
      this.pages += 1;
      return this.rows
        .filter(({ id, key }) => key !== null && (after === undefined || id > after))
        .sort((left, right) => (left.id < right.id ? -1 : 1))
        .slice(0, limit)
        .map(({ id, owner, key }) => ({ id, ownerUserId: owner, storageKey: key ?? '' }));
    },
    async clearKey({ id, storageKey }: ErasedFile) {
      const row = this.rows.find((each) => each.id === id);
      if (row === undefined || row.key !== storageKey) return false;
      row.key = null;
      return true;
    },
  };
  return store;
}

function storageOf(objects: readonly string[], failing: readonly string[] = []) {
  return {
    objects: new Set(objects),
    removed: [] as string[],
    async remove(key: string) {
      if (failing.includes(key)) throw new Error('spec storage: unreachable');
      this.removed.push(key);
      this.objects.delete(key);
    },
  };
}

function world(failing: readonly string[] = [], held: Set<string> = new Set()) {
  const documents = storeOf([
    { id: 'doc-1', owner: 'user-1', key: 'documents/doc-1.pdf' },
    { id: 'doc-2', owner: 'user-2', key: 'documents/doc-2.pdf' },
    { id: 'doc-3', owner: 'user-2', key: null },
  ]);
  const photos = storeOf([{ id: 'user-1', owner: 'user-1', key: 'photos/user-1.jpg' }]);
  const asked: (readonly string[])[] = [];
  const storage = storageOf(
    ['documents/doc-1.pdf', 'documents/doc-2.pdf', 'photos/user-1.jpg'],
    failing,
  );
  const reports: unknown[] = [];
  const job = eraseDeletedFiles({
    stores: [documents, photos],
    storage,
    report: (error) => void reports.push(error),
    held: async (owners) => {
      asked.push([...owners]);
      return new Set(owners.filter((owner) => held.has(owner)));
    },
    pageSize: 1,
  });
  return { documents, photos, storage, reports, job, asked, held };
}

const observe = ({ documents, photos, storage }: ReturnType<typeof world>) => ({
  documents: documents.rows,
  photos: photos.rows,
  objects: [...storage.objects].sort(),
});

describe('erase-deleted-files', () => {
  it('is a scheduled sweep that runs with no payload', () => {
    const { job } = world();
    expect(job.name).toBe('erase-deleted-files');
    expect(job.schedule).toEqual(expect.any(String));
  });

  it('removes every pending file through the storage port, then clears its key, page by page', async () => {
    const state = world();
    await state.job.handle({});
    expect(state.storage.removed).toEqual([
      'documents/doc-1.pdf',
      'documents/doc-2.pdf',
      'photos/user-1.jpg',
    ]);
    expect(observe(state)).toEqual({
      documents: [
        { id: 'doc-1', owner: 'user-1', key: null },
        { id: 'doc-2', owner: 'user-2', key: null },
        { id: 'doc-3', owner: 'user-2', key: null },
      ],
      photos: [{ id: 'user-1', owner: 'user-1', key: null }],
      objects: [],
    });
    expect(state.documents.pages).toBeGreaterThan(1);
  });

  it('keeps the key of a file it could not remove, reports it, and goes on with the others', async () => {
    const state = world(['documents/doc-1.pdf']);
    await state.job.handle({});
    expect(observe(state)).toEqual({
      documents: [
        { id: 'doc-1', owner: 'user-1', key: 'documents/doc-1.pdf' },
        { id: 'doc-2', owner: 'user-2', key: null },
        { id: 'doc-3', owner: 'user-2', key: null },
      ],
      photos: [{ id: 'user-1', owner: 'user-1', key: null }],
      objects: ['documents/doc-1.pdf'],
    });
    expect(state.reports).toHaveLength(1);
  });

  it('two runs leave what one run leaves (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => world(),
      run: (state) => state.job.handle({}),
      observe,
    });
    expect(twice).toEqual(once);
  });

  it('two runs with a failing file leave what one run leaves, the key still held', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => world(['photos/user-1.jpg']),
      run: (state) => state.job.handle({}),
      observe,
    });
    expect(twice).toEqual(once);
  });

  it("a held owner's files are neither removed nor reported, and the next page's are removed (T004)", async () => {
    const state = world([], new Set(['user-1']));
    await state.job.handle({});
    expect(state.storage.removed).toEqual(['documents/doc-2.pdf']);
    expect(state.reports).toEqual([]);
    expect(observe(state)).toEqual({
      documents: [
        { id: 'doc-1', owner: 'user-1', key: 'documents/doc-1.pdf' },
        { id: 'doc-2', owner: 'user-2', key: null },
        { id: 'doc-3', owner: 'user-2', key: null },
      ],
      photos: [{ id: 'user-1', owner: 'user-1', key: 'photos/user-1.jpg' }],
      objects: ['documents/doc-1.pdf', 'photos/user-1.jpg'],
    });
  });

  it("asks each page's owners once, in one call per page", async () => {
    const state = world([], new Set(['user-1']));
    await state.job.handle({});
    expect(state.asked).toEqual([['user-1'], ['user-2'], ['user-1']]);
  });

  it('removes them on the first run once no open matter holds the owner (T004)', async () => {
    const state = world([], new Set(['user-1']));
    await state.job.handle({});
    state.held.clear();
    await state.job.handle({});
    expect(observe(state).objects).toEqual([]);
    expect(state.storage.removed).toEqual([
      'documents/doc-2.pdf',
      'documents/doc-1.pdf',
      'photos/user-1.jpg',
    ]);
  });

  it('two runs with a held owner leave what one run leaves (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => world([], new Set(['user-1'])),
      run: (state) => state.job.handle({}),
      observe,
    });
    expect(twice).toEqual(once);
  });
});

// 005:T031 of specs/005-certification (FR-631; R-411; the note under T031, Q-D3 (a)): a deleted
// teacher's kept signature is the sweep's third store once it is no longer kept (verification's
// `createKeptSignatureErasure`): its `clearKey` deletes the row where it still holds the key, so the
// file is removed first and the row goes after it; a removal that fails leaves the row; two runs
// leave what one leaves. Which signatures the store answers is that store's spec's and the database
// spec's (`tests/db-integrity/teacher-deletion.spec.ts`).
describe('erase-deleted-files: a store whose clear deletes the row (005:T031)', () => {
  function signatures(failing: readonly string[] = []) {
    const rows = [
      { id: 'sig-1', owner: 'teacher-1', key: 'signatures/teacher-1.png' },
      { id: 'sig-2', owner: 'teacher-2', key: 'signatures/teacher-2.png' },
    ];
    const order: string[] = [];
    const store: ErasedFileStore = {
      async pendingPage(after, limit) {
        return rows
          .filter(({ id }) => after === undefined || id > after)
          .slice(0, limit)
          .map(({ id, owner, key }) => ({ id, ownerUserId: owner, storageKey: key }));
      },
      async clearKey({ id, storageKey }) {
        const at = rows.findIndex((row) => row.id === id && row.key === storageKey);
        if (at === -1) return false;
        order.push(`delete ${id}`);
        rows.splice(at, 1);
        return true;
      },
    };
    const storage = {
      objects: new Set(rows.map(({ key }) => key)),
      async remove(key: string) {
        if (failing.includes(key)) throw new Error('spec storage: unreachable');
        order.push(`remove ${key}`);
        this.objects.delete(key);
      },
    };
    const job = eraseDeletedFiles({
      stores: [store],
      storage,
      held: async () => new Set(),
      report: () => undefined,
      pageSize: 1,
    });
    return { rows, order, storage, job };
  }

  const observe = ({ rows, storage }: ReturnType<typeof signatures>) => ({
    rows: rows.map(({ id }) => id),
    objects: [...storage.objects].sort(),
  });

  it('removes each file, then deletes its row', async () => {
    const state = signatures();
    await state.job.handle({});
    expect(state.order).toEqual([
      'remove signatures/teacher-1.png',
      'delete sig-1',
      'remove signatures/teacher-2.png',
      'delete sig-2',
    ]);
    expect(observe(state)).toEqual({ rows: [], objects: [] });
  });

  it('keeps the row of a file it could not remove', async () => {
    const state = signatures(['signatures/teacher-1.png']);
    await state.job.handle({});
    expect(observe(state)).toEqual({ rows: ['sig-1'], objects: ['signatures/teacher-1.png'] });
  });

  it('two runs leave what one run leaves (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => signatures(['signatures/teacher-2.png']),
      run: (state) => state.job.handle({}),
      observe,
    });
    expect(twice).toEqual(once);
  });
});
