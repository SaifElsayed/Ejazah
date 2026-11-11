// T040 of specs/004-sessions/tasks.md (spec FR-487; SRS FR-AUTH-14 as amended on 2026-11-06; research
// R-327, «The administrator's read»; contracts/kernel.md, "The composition root"): the binding of
// sessions' `DisputeHeldFiles` port, which `main.ts` hands the administrator's services. Sessions
// asks it with an open matter's two parties, after checking the matter open; this answers only a
// deleted owner's files whose keys are still held, so a live person's documents stay with
// `documents.link`.
//
// THE READS. The documents through verification's own held-document readers beside `readDocument`
// (`verification.repository.ts`), on the caller's transaction; `readDocument` is untouched, so every
// other path still answers an erased document as none (item 4). The photo through identity's entry
// (`createHeldPhotos`, over `DeletedPhotosRepository`), past the soft-delete filter, outside any
// transaction (the note under T040, F6). Nothing is locked or written.
//
// THE REFERENCE. A file is named `document:<documentId>` or `photo:<userId>` (U4), lower-case ids as
// the database writes them; anything else, an id of another form included, is no file and reaches
// no reader. A document or photo whose owner is not one of the ids asked about is no file either.
//
// THE LINK. One per call, valid `document_link_ttl_seconds` (no new setting), as
// `VerificationService.documentLinkFor` mints one: a document's key decrypted for its own row and
// column for this one call; the photo's key is stored plain. Neither key leaves this file.
import { addSeconds } from '@ijazah/time';

import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { DOCUMENT_LINK_TTL_SETTING, documentLinkTtl } from '../../platform/settings/keys.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { createHeldPhotos, type HeldPhoto } from '../identity/index.js';
import type { DisputeHeldFiles, HeldFile, HeldFileLink } from '../sessions/index.js';
import {
  DOCUMENT_STORAGE_KEY_COLUMN,
  type HeldDocument,
  heldErasedDocumentsOf,
  readHeldErasedDocument,
  type StoredDocument,
} from './verification.repository.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DOCUMENT_REF = new RegExp(`^document:(${UUID})$`);
const PHOTO_REF = new RegExp(`^photo:(${UUID})$`);

/** What the binding reads; faked in a spec. */
export interface HeldFilesStore {
  heldDocumentsOf(tx: Transaction, userIds: readonly string[]): Promise<readonly HeldDocument[]>;
  heldDocument(tx: Transaction, documentId: string): Promise<StoredDocument | null>;
  /** Outside any transaction (`includeDeleted`). */
  heldPhotoOf(userId: string): Promise<HeldPhoto | null>;
}

/** The store over verification's table and identity's entry (R-API-6). */
export function heldFilesStoreOver(database: Pick<Database, 'includeDeleted'>): HeldFilesStore {
  const photos = createHeldPhotos(database);
  return {
    heldDocumentsOf: heldErasedDocumentsOf,
    heldDocument: readHeldErasedDocument,
    heldPhotoOf: (userId) => photos.heldPhotoOf(userId),
  };
}

export interface DisputeHeldFilesDependencies {
  readonly database: Pick<Database, 'includeDeleted'>;
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
  readonly settings: SettingsReader;
  /** The link's end is told from the process's clock, as `documentLinkFor` tells it. */
  readonly clock?: () => Date;
  readonly store?: HeldFilesStore;
}

export function createDisputeHeldFiles({
  database,
  storage,
  cipher,
  settings,
  clock = () => new Date(),
  store = heldFilesStoreOver(database),
}: DisputeHeldFilesDependencies): DisputeHeldFiles {
  const linkTo = async (storageKey: string): Promise<HeldFileLink> => {
    const ttl = await settings.read(DOCUMENT_LINK_TTL_SETTING, documentLinkTtl);
    const url = await storage.temporaryLink(storageKey, ttl);
    return { url, expiresAt: addSeconds(clock(), ttl) };
  };

  const documentLink = async (
    tx: Transaction,
    owners: readonly string[],
    documentId: string,
  ): Promise<HeldFileLink | null> => {
    const document = await store.heldDocument(tx, documentId);
    if (document === null || !owners.includes(document.userId)) return null;
    return linkTo(
      cipher.decrypt(document.storageKeyEncrypted, DOCUMENT_STORAGE_KEY_COLUMN, document.id),
    );
  };

  const photoLink = async (
    owners: readonly string[],
    userId: string,
  ): Promise<HeldFileLink | null> => {
    if (!owners.includes(userId)) return null;
    const photo = await store.heldPhotoOf(userId);
    return photo === null ? null : linkTo(photo.storageKey);
  };

  return {
    heldFilesOf: async (tx, userIds) => {
      const [documents, photos] = await Promise.all([
        store.heldDocumentsOf(tx, userIds),
        Promise.all(userIds.map((userId) => store.heldPhotoOf(userId))),
      ]);
      return [
        ...photos.flatMap((photo): HeldFile[] =>
          photo === null
            ? []
            : [
                {
                  fileRef: `photo:${photo.ownerUserId}`,
                  kind: 'photo',
                  ownerUserId: photo.ownerUserId,
                },
              ],
        ),
        ...documents.map(({ id, userId, documentType, uploadedAt }): HeldFile => ({
          fileRef: `document:${id}`,
          kind: documentType,
          ownerUserId: userId,
          uploadedAt,
        })),
      ];
    },

    heldFileLink: async (tx, userIds, fileRef) => {
      const documentId = DOCUMENT_REF.exec(fileRef)?.[1];
      if (documentId !== undefined) return documentLink(tx, userIds, documentId);
      const userId = PHOTO_REF.exec(fileRef)?.[1];
      if (userId !== undefined) return photoLink(userIds, userId);
      return null;
    },
  };
}
