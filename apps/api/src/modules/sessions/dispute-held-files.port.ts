// T040 of specs/004-sessions/tasks.md (spec FR-487; SRS FR-AUTH-14 as amended on 2026-11-06; research
// R-327, «The administrator's read»; contracts/kernel.md, "The composition root"): what
// `disputes.heldFiles` and `disputes.heldFileLink` need of a deleted party's held files, which only
// verification (its documents) and identity (the photo) can answer. Verification imports sessions
// (R-301), so sessions may not import verification; sessions asks this port instead, and `main.ts`
// binds it to verification's `createDisputeHeldFiles()`, as `EnrollmentSide` is bound to booking's.
//
// Sessions checks the dispute is open and reads the enrollment's two parties first, then asks with
// those two ids. The port answers only a deleted owner's files whose keys are still held: a live
// person's documents are read through `documents.link`, and a removed file is none. A file is named
// by its `fileRef`, `document:<documentId>` or `photo:<userId>`, never by its storage key, and the
// list carries no link (the owner's decision of 2026-11-06 on the fifth analysis, U4).
//
// THE TRANSACTION. Both functions take the caller's transaction for the documents
// (`verification_documents` is not soft-deleted); the photo is read past the soft-delete filter
// (`includeDeleted`), outside any transaction (the note under T040, F6). No lock is taken.
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** A held file's kind: the photo, or the document's `document_type` (ERD, `verification_document_type`). */
export type HeldFileKind = 'photo' | 'national_id' | 'passport' | 'credential' | 'other';

/** One held file of a deleted owner, metadata only. */
export interface HeldFile {
  /** `document:<documentId>` or `photo:<userId>`, stable across reads; never a storage key. */
  readonly fileRef: string;
  readonly kind: HeldFileKind;
  /** The deleted person the file belongs to, one of the ids asked about. */
  readonly ownerUserId: string;
  /** A document's `uploaded_at`; absent for the photo, which records none. */
  readonly uploadedAt?: Date;
}

/** A signed link to one held file, valid `document_link_ttl_seconds`. */
export interface HeldFileLink {
  readonly url: string;
  /** The link's end, an ISO instant. */
  readonly expiresAt: string;
}

export interface DisputeHeldFiles {
  /** The held files of whichever of `userIds` is deleted; none for a live person. */
  heldFilesOf(tx: Transaction, userIds: readonly string[]): Promise<readonly HeldFile[]>;
  /**
   * One signed link to the file `fileRef` names, when it is a held file of one of `userIds`; null
   * for a reference of neither form, a file not held (its file already removed included), or one
   * of anyone else.
   */
  heldFileLink(
    tx: Transaction,
    userIds: readonly string[],
    fileRef: string,
  ): Promise<HeldFileLink | null>;
}
