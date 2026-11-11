// T033 of specs/004-sessions/tasks.md (FR-446, FR-450, FR-477, FR-480; R-SESS-6; research R-308,
// R-311, R-323 GAP-2; contracts/admin-surface.md, `sessions.review.list/get/resolve`): the review
// queue, on the administrator call's transaction. The audit entries are the router's.
//
// THE QUEUE. The sessions `under_threshold` or `provider_outage`, which wait for an administrator's
// outcome (no automatic transition leaves them, FR-446), oldest first by id, pages of
// `admin_list_page_size`, each with its two parties named (a deleted one unnamed, FR-426).
//
// THE TELEMETRY (`telemetry.ts`). For every session no longer `scheduled`: the two review statuses,
// every other settled status, a disputed one and a cancelled one, whose `room_ended` event is the
// evidence of its room's end (GAP-2). A `scheduled` session is refused `CONFLICT`, `details.cause`
// `not_settled`; none, `NOT_FOUND`.
//
// THE RESOLUTION (R-SESS-6). One of `done`, `student_no_show`, `teacher_no_show`, `both_no_show`,
// with the mandatory reason the audit entry keeps, written through the one writer of an
// administrator's outcome (`admin-outcome.service.ts`: `status`, `settled_by_admin_id`,
// `admin_settled_at` by the database's clock, one `review_resolved` row), then T015's completion
// check. No remedy is offered here: `advance-remedies` offers what the outcome owes once the
// dispute window has closed and no dispute is open (the third analysis, A2). No outcome is set
// automatically. A session neither `under_threshold` nor `provider_outage` is refused `CONFLICT`,
// `details.cause` `not_under_review`, writing nothing (the owner's decision of 2026-11-11 on B39's
// conflict check, Q2); none, `NOT_FOUND`.
//
// THE LOCKS (contracts/kernel.md, «evaluation, a review or dispute resolution»; T005's rules). The
// session is read with no lock only to learn its enrollment; then the enrollment
// (`EnrollmentSide.lockEnrollments`), then the session, each `FOR UPDATE`, and the session read again
// under them (rule 1). The event references the enrollment and the session, both held, and no
// account; no count is checked (R-322).
//
// THE LOG (the owner's rule). Each refusal writes one info line of ids and its cause, marked
// «logged»; a resolution one of ids and the outcome, never the reason. A completion the check made
// writes `{ enrollmentId }` on the call's transaction, as the outage record does
// (`outages.service.ts`; the Not-scheduled row's item (13): the administrator kind has no point
// after its commit for a log line yet).
import type {
  MonitorParty,
  SessionsReviewListInput,
  SessionsReviewListOutput,
  SessionsReviewResolveInput,
  SessionsReviewResolveOutput,
  Telemetry,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError, type ErrorCode } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { displayNamesOf } from '../identity/index.js';
import { type AdminOutcomeWrite, writeAdminOutcome } from './admin-outcome.service.js';
import type { Completion } from './completion.service.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { lockRows } from './remaining-sessions.repository.js';
import {
  type QueuedSession,
  queuedSessions,
  REVIEW_STATUSES,
  type SessionToResolve,
  sessionToResolve,
  type TelemetrySession,
  telemetrySession,
} from './review.repository.js';
import type { TelemetryReader } from './telemetry.js';

/** The page size of every admin list (SRS §3.14, FR-412). */
const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** What the queue reads and writes, each on the caller's transaction. */
export interface SessionReviewStore {
  queuedSessions(
    tx: Transaction,
    after: string | undefined,
    limit: number,
  ): Promise<readonly QueuedSession[]>;
  /** Identity's: display names by account, a deleted account absent. */
  namesOf(tx: Transaction, userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  telemetrySession(tx: Transaction, sessionId: string): Promise<TelemetrySession | null>;
  sessionToResolve(tx: Transaction, sessionId: string): Promise<SessionToResolve | null>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** The one writer of an administrator's outcome. */
  writeOutcome(tx: Transaction, write: AdminOutcomeWrite): Promise<void>;
}

export const sessionReviewStore: SessionReviewStore = {
  queuedSessions,
  namesOf: displayNamesOf,
  telemetrySession,
  sessionToResolve,
  lockSessions: (tx, ids) => lockRows(tx, 'sessions', ids),
  writeOutcome: (tx, write) => writeAdminOutcome(tx, write),
};

export interface SessionReview {
  /** `sessions.review.list`: a page of the queue. */
  list(
    tx: Transaction,
    adminId: string,
    input: SessionsReviewListInput,
  ): Promise<SessionsReviewListOutput>;
  /** `sessions.review.get`: the session's telemetry. */
  get(tx: Transaction, adminId: string, input: { readonly sessionId: string }): Promise<Telemetry>;
  /** `sessions.review.resolve`: the outcome written under the locks (this file's head). */
  resolve(
    tx: Transaction,
    adminId: string,
    input: SessionsReviewResolveInput,
  ): Promise<SessionsReviewResolveOutput>;
}

/** Why a review call was refused, as its one log line names it. */
type RefusalCause = 'not_found' | 'not_settled' | 'not_under_review';

/**
 * Logs the refusal with ids and its cause only, and answers the error to throw, marked «logged» so
 * `onError` writes no second line. A `CONFLICT` names its cause in `details`.
 */
function refusal(
  log: Pick<Logger, 'info'>,
  ids: { readonly adminId: string; readonly sessionId: string; readonly enrollmentId?: string },
  errorCode: ErrorCode,
  cause: RefusalCause,
): DomainError {
  log.info({ ...ids, errorCode, cause }, 'A session review call was refused');
  return markRefusalLogged(
    errorCode === 'CONFLICT'
      ? new DomainError(errorCode, undefined, { details: [{ path: 'cause', code: cause }] })
      : new DomainError(errorCode),
  );
}

/** A party as this phase names one: a deleted account (no name answered) unnamed (FR-426). */
function partyOf(userId: string, names: ReadonlyMap<string, string>): MonitorParty {
  const displayName = names.get(userId);
  return displayName === undefined
    ? { userId, displayName: null, deleted: true }
    : { userId, displayName, deleted: false };
}

const UNDER_REVIEW: ReadonlySet<string> = new Set(REVIEW_STATUSES);

export function createSessionReview({
  enrollments,
  completion,
  telemetry,
  settings,
  log,
  clock = clockTimestamp,
  store = sessionReviewStore,
}: {
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments'>;
  readonly completion: Completion;
  readonly telemetry: TelemetryReader;
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the call's transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: SessionReviewStore;
}): SessionReview {
  return {
    list: async (tx, _adminId, { cursor }) => {
      const pageSize = await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
      const read = await store.queuedSessions(tx, cursor, pageSize + 1);
      const page = read.slice(0, pageSize);
      const names = await store.namesOf(tx, [
        ...new Set(
          page.flatMap(({ studentUserId, teacherUserId }) => [studentUserId, teacherUserId]),
        ),
      ]);
      const last = page.at(-1);
      return {
        items: page.map((session) => ({
          sessionId: session.id,
          enrollmentId: session.enrollmentId,
          status: session.status,
          startsAt: session.startsAt.toISOString(),
          endsAt: session.endsAt.toISOString(),
          simultaneousSeconds: session.simultaneousSeconds,
          parties: {
            student: partyOf(session.studentUserId, names),
            teacher: partyOf(session.teacherUserId, names),
          },
        })),
        ...(read.length > pageSize && last !== undefined ? { nextCursor: last.id } : {}),
      };
    },

    get: async (tx, adminId, { sessionId }) => {
      const session = await store.telemetrySession(tx, sessionId);
      if (session === null) throw refusal(log, { adminId, sessionId }, 'NOT_FOUND', 'not_found');
      if (session.status === 'scheduled') {
        throw refusal(
          log,
          { adminId, sessionId, enrollmentId: session.enrollmentId },
          'CONFLICT',
          'not_settled',
        );
      }
      return telemetry.of(tx, session);
    },

    resolve: async (tx, adminId, { sessionId, outcome }) => {
      const seen = await store.sessionToResolve(tx, sessionId);
      if (seen === null) throw refusal(log, { adminId, sessionId }, 'NOT_FOUND', 'not_found');
      const { enrollmentId } = seen;
      await enrollments.lockEnrollments(tx, [enrollmentId]);
      await store.lockSessions(tx, [sessionId]);
      const session = await store.sessionToResolve(tx, sessionId);
      if (session === null) throw refusal(log, { adminId, sessionId }, 'NOT_FOUND', 'not_found');
      if (!UNDER_REVIEW.has(session.status)) {
        throw refusal(log, { adminId, sessionId, enrollmentId }, 'CONFLICT', 'not_under_review');
      }
      const at = await clock(tx);
      await store.writeOutcome(tx, {
        sessionId,
        enrollmentId,
        from: session.status,
        outcome,
        adminId,
        at,
        event: { kind: 'review_resolved' },
      });
      log.info(
        { adminId, sessionId, enrollmentId, outcome },
        'A session under review was resolved',
      );
      // On the call's transaction; after its commit waits in the Not-scheduled row's item (13).
      if (await completion.completeIfDue(tx, enrollmentId)) {
        log.info({ enrollmentId }, 'Enrollment completed');
      }
      return { sessionId, status: outcome };
    },
  };
}
