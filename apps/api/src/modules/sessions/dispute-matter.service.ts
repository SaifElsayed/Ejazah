// T040 of specs/004-sessions/tasks.md (FR-475, FR-480, spec FR-487; SRS FR-AUTH-14 as amended on
// 2026-11-06; research R-301, R-314, R-327 «The administrator's read»; contracts/admin-surface.md,
// `disputes.heldFiles` and `disputes.heldFileLink`; contracts/kernel.md, "The composition root"; the
// notes under T040): what an administrator reads inside an open matter, on the administrator call's
// transaction. The audit entries are the router's.
//
// THE MATTER. A `disputeId` of any kind (a session dispute, a compensation case, a complaint of a
// teacher's absence), read through moderation's `caseRecordOf` (the note under T040, F4), admitted
// only while its `status` is `open`: none is `NOT_FOUND`, one no longer open `CONFLICT` with
// `details.cause` `not_open`, as B39's closings refuse one (F5; `dispute-resolution.service.ts`).
// The enrollment's two parties come from `EnrollmentSide` (sessions reads no booking table, R-301).
// Nothing is locked: a read that meets a matter closing at the same moment answers as it was, and a
// link minted then lives `document_link_ttl_seconds` after the close (R-327, item 3).
//
// THE HELD FILES. The `DisputeHeldFiles` port, bound by `main.ts` to verification's
// `createDisputeHeldFiles()` (sessions imports no verification, R-301), asked with the two parties:
// it answers only a deleted owner's files whose keys are still held. The list carries each file's
// reference, kind, owner's role and upload date where recorded, never a link or a storage key
// (U4); the link is one per call, and a reference the port does not mint is `NOT_FOUND`.
//
// THE LOG (the owner's rule). A refusal writes one info line of ids and its cause, marked «logged»;
// never the reference, which is the caller's text. A read writes none.
import type {
  DisputesHeldFileLinkOutput,
  DisputesHeldFilesOutput,
  HeldFileItem,
} from '@ijazah/contracts/admin';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import { type CaseRecord, caseRecordOf } from '../moderation/index.js';
import type { DisputeHeldFiles } from './dispute-held-files.port.js';
import type { EnrollmentSide } from './enrollment-side.port.js';

/** What the reads ask of moderation's entry, with no lock; faked in a spec. */
export interface DisputeMatterStore {
  /** The `disputes` row of any kind, or null. */
  caseRecordOf(tx: Transaction, disputeId: string): Promise<CaseRecord | null>;
}

export const disputeMatterStore: DisputeMatterStore = { caseRecordOf };

export interface DisputeMatterReads {
  /** `disputes.heldFiles`: the enrollment's deleted party's held files, metadata only. */
  heldFiles(
    tx: Transaction,
    adminId: string,
    input: { readonly disputeId: string },
  ): Promise<DisputesHeldFilesOutput>;
  /** `disputes.heldFileLink`: one signed link to one of them. */
  heldFileLink(
    tx: Transaction,
    adminId: string,
    input: { readonly disputeId: string; readonly fileRef: string },
  ): Promise<DisputesHeldFileLinkOutput>;
}

export interface DisputeMatterDependencies {
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentFor'>;
  /** The port `main.ts` binds to verification's `createDisputeHeldFiles()`. */
  readonly heldFiles: DisputeHeldFiles;
  /** For the refusals' lines. */
  readonly log: Pick<Logger, 'info'>;
  readonly store?: DisputeMatterStore;
}

type RefusalCause = 'not_found' | 'not_open' | 'no_enrollment' | 'not_held';

interface RefusalIds {
  readonly adminId: string;
  readonly disputeId: string;
  readonly enrollmentId?: string;
}

/** The refusal's error after its one line, marked «logged»; a `CONFLICT` names its cause. */
function refusal(
  log: Pick<Logger, 'info'>,
  ids: RefusalIds,
  errorCode: 'NOT_FOUND' | 'CONFLICT',
  cause: RefusalCause,
): DomainError {
  log.info({ ...ids, errorCode, cause }, 'A dispute matter read was refused');
  return markRefusalLogged(
    errorCode === 'CONFLICT'
      ? new DomainError(errorCode, undefined, { details: [{ path: 'cause', code: cause }] })
      : new DomainError(errorCode),
  );
}

/** The open matter and its enrollment's two parties. */
interface OpenMatter {
  readonly enrollmentId: string;
  readonly roleOf: ReadonlyMap<string, 'student' | 'teacher'>;
}

export function createDisputeMatterReads({
  enrollments,
  heldFiles,
  log,
  store = disputeMatterStore,
}: DisputeMatterDependencies): DisputeMatterReads {
  /** The dispute, open; refused otherwise, before anything else is read. */
  const openDispute = async (
    tx: Transaction,
    adminId: string,
    disputeId: string,
  ): Promise<CaseRecord> => {
    const dispute = await store.caseRecordOf(tx, disputeId);
    if (dispute === null) throw refusal(log, { adminId, disputeId }, 'NOT_FOUND', 'not_found');
    if (dispute.status !== 'open') {
      const ids = { adminId, disputeId, enrollmentId: dispute.enrollmentId };
      throw refusal(log, ids, 'CONFLICT', 'not_open');
    }
    return dispute;
  };

  /** The open dispute's enrollment and its two parties, through `EnrollmentSide`. */
  const openMatter = async (
    tx: Transaction,
    adminId: string,
    disputeId: string,
  ): Promise<OpenMatter> => {
    const { enrollmentId } = await openDispute(tx, adminId, disputeId);
    const terms = await enrollments.enrollmentFor(tx, enrollmentId);
    if (terms === null) {
      throw refusal(log, { adminId, disputeId, enrollmentId }, 'NOT_FOUND', 'no_enrollment');
    }
    return {
      enrollmentId,
      roleOf: new Map([
        [terms.studentUserId, 'student'],
        [terms.teacherUserId, 'teacher'],
      ]),
    };
  };

  return {
    heldFiles: async (tx, adminId, { disputeId }) => {
      const { roleOf } = await openMatter(tx, adminId, disputeId);
      const held = await heldFiles.heldFilesOf(tx, [...roleOf.keys()]);
      const files = held.map(({ fileRef, kind, ownerUserId, uploadedAt }): HeldFileItem => {
        const ownerRole = roleOf.get(ownerUserId);
        if (ownerRole === undefined) {
          throw new Error('sessions: the held-files port answered a file of neither party');
        }
        return {
          fileRef,
          kind,
          ownerRole,
          ...(uploadedAt === undefined ? {} : { uploadedAt: uploadedAt.toISOString() }),
        };
      });
      return { files };
    },

    heldFileLink: async (tx, adminId, { disputeId, fileRef }) => {
      const { enrollmentId, roleOf } = await openMatter(tx, adminId, disputeId);
      const link = await heldFiles.heldFileLink(tx, [...roleOf.keys()], fileRef);
      if (link === null) {
        throw refusal(log, { adminId, disputeId, enrollmentId }, 'NOT_FOUND', 'not_held');
      }
      return link;
    },
  };
}
