// T093: the `purge-unreferenced-documents` sweep (PR #80 review, finding 9; owner's decision
// 2026-10-19; ARCHITECTURE §5 jobs).
//
// A document is uploaded before the submission that points at it, so an upload nobody submits
// would stay in storage, an identity document among them, for ever. The sweep deletes every
// `verification_documents` row uploaded longer ago than `document_unreferenced_purge_after_hours`
// that no `teacher_profiles.identity_document_id`, `teacher_credentials.document_id` or
// `verification_requests.document_id` points at, and its object through the storage port. The rows
// are reached through the verification module's store (R-API-6), which reads the two other
// modules' pointers through their entries and answers each candidate with its storage key
// decrypted for the one `remove`. The store removes a row only while nothing points at it and
// removes the object inside that removal, so a document pointed at after it was listed is kept,
// row and object, and an object that cannot be removed keeps its row for the next run.
//
// The window is read through the settings reader on every run (FR-034). Idempotent by
// construction: a second run finds nothing more to delete, and removing an absent object is not an
// error (R-API-14). It runs every hour.
import { z } from 'zod';

import type { StoragePort } from '../platform/ports/storage/storage.port.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { defineJob, type Job } from './job.js';
import { instantBefore, SECONDS_PER_HOUR } from './window.js';

/** The settings key of how long an upload may wait for its submission (data-model.md §4). */
export const DOCUMENT_UNREFERENCED_PURGE_AFTER_HOURS_SETTING =
  'document_unreferenced_purge_after_hours';

const hours = z.int().positive();

/** A document nothing points at, its storage key decrypted. */
export interface UnreferencedDocument {
  readonly id: string;
  readonly storageKey: string;
}

/** What the sweep asks of the verification module. */
export interface UnreferencedDocumentStore {
  /** The documents uploaded before `uploadedBefore` that no row of any module points at. */
  listUnreferencedUploadedBefore(uploadedBefore: Date): Promise<readonly UnreferencedDocument[]>;
  /**
   * Deletes the row while nothing points at it, calling `removeObject` with its key inside that
   * deletion; whether it was deleted. A failing `removeObject` keeps the row.
   */
  removeUnreferenced(
    document: UnreferencedDocument,
    removeObject: (storageKey: string) => Promise<void>,
  ): Promise<boolean>;
}

export interface PurgeUnreferencedDocumentsOptions {
  readonly store: UnreferencedDocumentStore;
  readonly storage: Pick<StoragePort, 'remove'>;
  readonly settings: SettingsReader;
  /** The clock; the system clock unless a spec sets one. */
  readonly clock?: () => Date;
}

export function purgeUnreferencedDocuments({
  store,
  storage,
  settings,
  clock = () => new Date(),
}: PurgeUnreferencedDocumentsOptions): Job {
  return defineJob({
    name: 'purge-unreferenced-documents',
    payload: z.object({}),
    schedule: '50 * * * *',
    run: async () => {
      const window = await settings.read(DOCUMENT_UNREFERENCED_PURGE_AFTER_HOURS_SETTING, hours);
      const candidates = await store.listUnreferencedUploadedBefore(
        instantBefore(clock(), window * SECONDS_PER_HOUR),
      );
      for (const document of candidates) {
        await store.removeUnreferenced(document, (storageKey) => storage.remove(storageKey));
      }
    },
  });
}
