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
import { describe, expect, it } from 'vitest';

import { runOnceAndTwice } from './double-run.js';
import { type ErasedFile, type ErasedFileStore, eraseDeletedFiles } from './erase-deleted-files.js';

interface Row {
  readonly id: string;
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
        .map(({ id, key }) => ({ id, storageKey: key ?? '' }));
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

function world(failing: readonly string[] = []) {
  const documents = storeOf([
    { id: 'doc-1', key: 'documents/doc-1.pdf' },
    { id: 'doc-2', key: 'documents/doc-2.pdf' },
    { id: 'doc-3', key: null },
  ]);
  const photos = storeOf([{ id: 'user-1', key: 'photos/user-1.jpg' }]);
  const storage = storageOf(
    ['documents/doc-1.pdf', 'documents/doc-2.pdf', 'photos/user-1.jpg'],
    failing,
  );
  const reports: unknown[] = [];
  const job = eraseDeletedFiles({
    stores: [documents, photos],
    storage,
    report: (error) => void reports.push(error),
    pageSize: 1,
  });
  return { documents, photos, storage, reports, job };
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
        { id: 'doc-1', key: null },
        { id: 'doc-2', key: null },
        { id: 'doc-3', key: null },
      ],
      photos: [{ id: 'user-1', key: null }],
      objects: [],
    });
    expect(state.documents.pages).toBeGreaterThan(1);
  });

  it('keeps the key of a file it could not remove, reports it, and goes on with the others', async () => {
    const state = world(['documents/doc-1.pdf']);
    await state.job.handle({});
    expect(observe(state)).toEqual({
      documents: [
        { id: 'doc-1', key: 'documents/doc-1.pdf' },
        { id: 'doc-2', key: null },
        { id: 'doc-3', key: null },
      ],
      photos: [{ id: 'user-1', key: null }],
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
});
