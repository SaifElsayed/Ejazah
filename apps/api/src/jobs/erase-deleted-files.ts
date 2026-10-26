// B16 (T082; the B16 check, decision 1, the owner's decision 2026-10-26 on the reviewer's advice;
// ADR 0015 D3, Egypt PDPL; ARCHITECTURE §5 jobs): the `erase-deleted-files` sweep.
//
// An account's deletion removes the person's stored files after its commit and clears each key only
// once its file is gone, so a removal that failed leaves the key behind rather than a file nobody
// knows of. This sweep retries every one of them: the documents the deletion marked erased that
// still hold a key (the verification module's store) and the deleted people whose photo key is
// still held (the identity module's), each reached through its owner's entry (R-API-6). For each it
// removes the file through the storage port, then clears the key where the row still holds it. A
// file that cannot be removed keeps its key for the next run and is reported; the others go on.
//
// Each store is read a page at a time in id order after the last row read, so a run is bounded and
// never meets a row twice, a failing one included. Idempotent by construction: a second run finds
// only what the first could not remove, and removing an absent object is not an error (R-API-14).
// It reads no setting: there is no window, a held key is retried on the next run. It runs every hour.
import { z } from 'zod';

import { reportError } from '../platform/errors/reporting.js';
import type { StoragePort } from '../platform/ports/storage/storage.port.js';
import { defineJob, type Job } from './job.js';

/** How many rows a store is asked for at a time. */
export const ERASE_PAGE_SIZE = 100;

/** A file still to be removed: its row's id and its storage key, decrypted. */
export interface ErasedFile {
  readonly id: string;
  readonly storageKey: string;
}

/** What the sweep asks of a module that keeps a deleted person's file keys. */
export interface ErasedFileStore {
  /** The files still held, in id order after `after`, at most `limit`. */
  pendingPage(after: string | undefined, limit: number): Promise<readonly ErasedFile[]>;
  /** Clears the key once its file is gone, only where the row still holds it; whether it did. */
  clearKey(file: ErasedFile): Promise<boolean>;
}

export interface EraseDeletedFilesOptions {
  readonly stores: readonly ErasedFileStore[];
  readonly storage: Pick<StoragePort, 'remove'>;
  /** Where a file that could not be removed is reported; the error tracker unless a spec sets one. */
  readonly report?: (error: unknown) => void;
  readonly pageSize?: number;
}

export function eraseDeletedFiles({
  stores,
  storage,
  report = reportError,
  pageSize = ERASE_PAGE_SIZE,
}: EraseDeletedFilesOptions): Job {
  const erase = async (store: ErasedFileStore, file: ErasedFile) => {
    try {
      await storage.remove(file.storageKey);
      await store.clearKey(file);
    } catch (error: unknown) {
      report(error);
    }
  };
  return defineJob({
    name: 'erase-deleted-files',
    payload: z.object({}),
    schedule: '20 * * * *',
    run: async () => {
      for (const store of stores) {
        let after: string | undefined;
        for (;;) {
          const page = await store.pendingPage(after, pageSize);
          for (const file of page) await erase(store, file);
          if (page.length < pageSize) break;
          after = page.at(-1)?.id;
        }
      }
    },
  });
}
