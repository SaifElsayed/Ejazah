// T034 of specs/004-sessions/tasks.md (FR-451, FR-475, FR-480; research R-308, R-322;
// contracts/admin-surface.md, `disputes.list` and `disputes.get`): the administrator's disputes
// queue, two reads on the call's transaction over moderation's rows (read through its entry,
// R-API-6) and sessions' own. Nothing is locked or written; the audit entries are the router's.
//
// THE LIST. The open session disputes first, oldest first, then the closed ones, newest first, in
// pages of `admin_list_page_size`; the cursor is the last dispute's part and id, `open:<id>` or
// `closed:<id>`, so a dispute resolved between two pages skips nothing (PR #133's review, round 1,
// Minor 2). Each names who raised it (the raiser is one of the session's two accounts), the frozen
// outcome (absent before the evaluation, R-308), and its session's enrollment's Teacher-No-Show
// count and the repeated-absence mark (T015, FR-451), read when listed; nothing follows from them
// (R-322).
//
// THE DETAIL. The dispute, its session's telemetry (`telemetry.ts`, T033), and `chatAvailable`, from
// the open dispute alone: the chat itself is read by `disputes.chat` (T040) through the
// `DisputeChat` port. A dispute that is not a session dispute, or none, is `NOT_FOUND`. T059 adds
// `revisable`, `disputes.revise`'s one rule read with no lock (`ruling-revision.ts`), and
// `revisions`, the ruling's `dispute_revised` rows oldest first (`revision.service.ts`).
//
// THE LOG (the owner's rule). A refusal writes one info line of ids and its cause, marked
// «logged»; a read writes none.
import type {
  DisputeDetail,
  DisputesGetOutput,
  DisputesListInput,
  DisputesListItem,
  DisputesListOutput,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type SessionDisputeRow,
  sessionDisputeOf,
  sessionDisputesPage,
} from '../moderation/index.js';
import { type DisputedSessionRow, disputedSessionsAmong } from './dispute-queue.repository.js';
import { teacherNoShowCountsOf } from './repeated-absence.repository.js';
import {
  REPEATED_ABSENCE_FLAG_SETTING,
  repeatedAbsenceFlagCount,
} from './repeated-absence.service.js';
import { type TelemetrySession, telemetrySession } from './review.repository.js';
import type { Revisions } from './revision.service.js';
import type { TelemetryReader } from './telemetry.js';

/** The page size of every admin list (SRS §3.14, FR-412). */
const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** What the queue reads, each on the caller's transaction with no lock. */
export interface DisputeQueueStore {
  /** Moderation's: the session dispute, or null. */
  disputeOf(tx: Transaction, disputeId: string): Promise<SessionDisputeRow | null>;
  /** Moderation's: a page of the open (oldest first) or the closed (newest first) disputes. */
  disputesPage(
    tx: Transaction,
    group: 'open' | 'closed',
    after: string | undefined,
    limit: number,
  ): Promise<readonly SessionDisputeRow[]>;
  disputedSessionsAmong(
    tx: Transaction,
    sessionIds: readonly string[],
  ): Promise<ReadonlyMap<string, DisputedSessionRow>>;
  /** T015's count, one per enrollment, 0 for one with none. */
  teacherNoShowCountsOf(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
  telemetrySession(tx: Transaction, sessionId: string): Promise<TelemetrySession | null>;
}

export const disputeQueueStore: DisputeQueueStore = {
  disputeOf: sessionDisputeOf,
  disputesPage: sessionDisputesPage,
  disputedSessionsAmong,
  teacherNoShowCountsOf,
  telemetrySession,
};

export interface DisputeQueue {
  /** `disputes.list`: a page, the open disputes first. */
  list(tx: Transaction, adminId: string, input: DisputesListInput): Promise<DisputesListOutput>;
  /** `disputes.get`: the dispute, its session's telemetry and `chatAvailable`. */
  get(
    tx: Transaction,
    adminId: string,
    input: { readonly disputeId: string },
  ): Promise<DisputesGetOutput>;
}

/** Who raised the dispute: the session's student, or else its teacher (the raiser is a party). */
const raisedByOf = (
  dispute: SessionDisputeRow,
  session: Pick<DisputedSessionRow, 'studentUserId'>,
): 'student' | 'teacher' =>
  dispute.raisedByUserId === session.studentUserId ? 'student' : 'teacher';

function notFound(log: Pick<Logger, 'info'>, adminId: string, disputeId: string): DomainError {
  log.info(
    { adminId, disputeId, errorCode: 'NOT_FOUND', cause: 'not_found' },
    'A disputes queue call was refused',
  );
  return markRefusalLogged(new DomainError('NOT_FOUND'));
}

export function createDisputeQueue({
  telemetry,
  revisions,
  settings,
  log,
  store = disputeQueueStore,
}: {
  readonly telemetry: TelemetryReader;
  /** T059: a ruling's `revisable` and `revisions`. */
  readonly revisions: Pick<Revisions, 'revisionView'>;
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info'>;
  readonly store?: DisputeQueueStore;
}): DisputeQueue {
  /** Up to `limit` disputes after `cursor`: the open part, then the closed part from its start. */
  const disputesAfter = async (
    tx: Transaction,
    cursor: string | undefined,
    limit: number,
  ): Promise<readonly SessionDisputeRow[]> => {
    // The cursor's form is checked by the contract's schema.
    const [part, after] = cursor === undefined ? ['open', undefined] : cursor.split(':');
    if (part === 'closed') return store.disputesPage(tx, 'closed', after, limit);
    const open = await store.disputesPage(tx, 'open', after, limit);
    if (open.length >= limit) return open;
    return [...open, ...(await store.disputesPage(tx, 'closed', undefined, limit - open.length))];
  };

  return {
    list: async (tx, _adminId, { cursor }) => {
      const pageSize = await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
      const read = await disputesAfter(tx, cursor, pageSize + 1);
      const page = read.slice(0, pageSize);
      const sessions = await store.disputedSessionsAmong(
        tx,
        page.map(({ sessionId }) => sessionId),
      );
      const enrollmentIds = [...new Set(page.map(({ enrollmentId }) => enrollmentId))];
      const counts = await store.teacherNoShowCountsOf(tx, enrollmentIds);
      const flagCount =
        page.length === 0
          ? 0
          : await settings.read(REPEATED_ABSENCE_FLAG_SETTING, repeatedAbsenceFlagCount);
      const items = page.flatMap((dispute): DisputesListItem[] => {
        const session = sessions.get(dispute.sessionId);
        // A soft-deleted session is left out of ordinary reads, and its dispute with it (T148).
        if (session === undefined) return [];
        const teacherNoShows = counts.get(dispute.enrollmentId) ?? 0;
        return [
          {
            disputeId: dispute.id,
            sessionId: dispute.sessionId,
            raisedBy: raisedByOf(dispute, session),
            raisedAt: dispute.createdAt.toISOString(),
            ...(session.outcomeUnderDispute === null
              ? {}
              : { outcomeUnderDispute: session.outcomeUnderDispute }),
            teacherNoShows,
            repeatedAbsence: teacherNoShows >= flagCount,
          },
        ];
      });
      const last = page.at(-1);
      return {
        items,
        // A row's status is the part it was read in, by the same statement.
        ...(read.length > pageSize && last !== undefined
          ? { nextCursor: `${last.status === 'open' ? 'open' : 'closed'}:${last.id}` }
          : {}),
      };
    },

    get: async (tx, adminId, { disputeId }) => {
      const dispute = await store.disputeOf(tx, disputeId);
      if (dispute === null) throw notFound(log, adminId, disputeId);
      const session = await store.telemetrySession(tx, dispute.sessionId);
      if (session === null) throw notFound(log, adminId, disputeId);
      const detail: DisputeDetail = {
        disputeId: dispute.id,
        sessionId: dispute.sessionId,
        enrollmentId: dispute.enrollmentId,
        raisedBy: raisedByOf(dispute, session),
        reason: dispute.reason,
        status: dispute.status,
        raisedAt: dispute.createdAt.toISOString(),
        ...(session.outcomeUnderDispute === null
          ? {}
          : { outcomeUnderDispute: session.outcomeUnderDispute }),
        ...(dispute.resolution === null ? {} : { resolution: dispute.resolution }),
        ...(dispute.resolutionNotes === null ? {} : { resolutionNotes: dispute.resolutionNotes }),
        ...(dispute.resolvedAt === null ? {} : { resolvedAt: dispute.resolvedAt.toISOString() }),
      };
      const view = await revisions.revisionView(tx, dispute);
      return {
        dispute: detail,
        telemetry: await telemetry.of(tx, session),
        chatAvailable: dispute.status === 'open',
        revisable: view.revisable,
        revisions: view.revisions.map(({ outcomeBefore, outcomeAfter, revisedAt }) => ({
          outcomeBefore,
          outcomeAfter,
          revisedAt: revisedAt.toISOString(),
        })),
      };
    },
  };
}
