// T023 of specs/004-sessions/tasks.md (FR-460, FR-480, FR-485, FR-495; SC-413; research R-312;
// contracts/admin-surface.md, `sessions.cancel`): an administrator's cancellation of a session not
// yet settled, on the administrator call's transaction. The session becomes `cancelled_by_admin`
// with no penalty (no no-show is counted against either party, and the database's overlap
// exclusions free both parties' time at once, ERD §15 rule 19); its enrollment's
// `admin_cancellation` compensation case is opened, or the open one joined, through moderation's
// `openCompensationCase`; one `session_events` row `cancelled_by_admin` names that case in
// `case_id` (C4; the second analysis, U2). The case decides what is owed (FR-478); nothing here
// computes or moves an amount (R-MONEY-6) or confirms an enrollment (SC-413). The audit entry, with
// the mandatory reason, is the router's.
//
// «NOT YET SETTLED» is `scheduled` (data-model.md §3: only `scheduled` → `cancelled_by_admin`). A
// `scheduled` session past its end and not yet evaluated is still cancellable; every other status
// is refused `SESSION_NOT_SCHEDULED`, a `disputed` one included, since its outcome is the
// dispute's ruling's to settle (FR-476; the owner's decision of 2026-11-10 on lane B's Q1). A
// pending cancellation request of the session is left as it is (T021's line): it reads as over
// once its session is no longer `scheduled`.
//
// THE LOCKS (contracts/kernel.md, the row «an administrator's `sessions.cancel`»; T005's rules).
// The session is read with no lock only to learn its enrollment; then the enrollment
// (`EnrollmentSide.lockEnrollments`), then the session, each `FOR UPDATE`, and the session read again
// under them (rule 1), so the decision is never made on the first read. The case is opened after
// the session, as the one order puts `disputes` after `sessions`, and its own enrollment lock is
// the one already held. The event's insert references the enrollment, the session and the case,
// each held or written by this transaction, and no account: no `users` row is locked.
//
// THE LOG (the owner's rule). A refusal writes one info line of ids and a reason code, through
// this file's one `refusal`; a cancellation writes one of ids and whether the case was opened
// (an automatic action), never the reason, which the audit entry keeps.
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError, type ErrorCode } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import { type CompensationCase, openCompensationCase } from '../moderation/index.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { cancelByAdmin, lockRows } from './remaining-sessions.repository.js';
import { type SessionToCancel, sessionToCancel } from './session-cancel.repository.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';

/** What the cancellation reads and writes, each on the caller's transaction. */
export interface SessionCancelStore {
  sessionToCancel(tx: Transaction, sessionId: string): Promise<SessionToCancel | null>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** Cancels those of `ids` still `scheduled`, `cancelled_by_admin`. */
  cancelByAdmin(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** The enrollment's `admin_cancellation` case, opened or joined (moderation's). */
  openCase(tx: Transaction, enrollmentId: string): Promise<CompensationCase>;
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

/** The store over sessions' tables and moderation's entry. */
export const sessionCancelStore: SessionCancelStore = {
  sessionToCancel,
  lockSessions: (tx, ids) => lockRows(tx, 'sessions', ids),
  cancelByAdmin,
  openCase: (tx, enrollmentId) => openCompensationCase(tx, enrollmentId, 'admin_cancellation'),
  recordEvents: recordSessionEvents,
};

export interface SessionCancelInput {
  readonly sessionId: string;
  /** The administrator's reason, which the router's audit entry records. */
  readonly reason: string;
}

export interface SessionCancelled {
  readonly sessionId: string;
  readonly status: 'cancelled_by_admin';
  readonly caseId: string;
}

export interface SessionCancel {
  /** `sessions.cancel` on the administrator call's transaction (this file's head). */
  cancel(tx: Transaction, adminId: string, input: SessionCancelInput): Promise<SessionCancelled>;
}

/** Why a cancellation was refused, as its one log line names it. */
type RefusalReason = 'not_found' | 'not_scheduled';

/**
 * Logs the refusal with ids and its reason only, and answers the error to throw, marked «logged»
 * so `onError` writes no second line (PR #130's review, round 1, Minor 4).
 */
function refusal(
  log: Pick<Logger, 'info'>,
  ids: { readonly adminId: string; readonly sessionId: string; readonly enrollmentId?: string },
  errorCode: ErrorCode,
  reason: RefusalReason,
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A session cancellation was refused');
  return markRefusalLogged(new DomainError(errorCode));
}

export function createSessionCancel({
  enrollments,
  log,
  clock = clockTimestamp,
  store = sessionCancelStore,
}: {
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments'>;
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the call's transaction, the event's instant. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: SessionCancelStore;
}): SessionCancel {
  return {
    cancel: async (tx, adminId, { sessionId }) => {
      const seen = await store.sessionToCancel(tx, sessionId);
      if (seen === null) throw refusal(log, { adminId, sessionId }, 'NOT_FOUND', 'not_found');
      const { enrollmentId } = seen;
      await enrollments.lockEnrollments(tx, [enrollmentId]);
      await store.lockSessions(tx, [sessionId]);
      const session = await store.sessionToCancel(tx, sessionId);
      if (session === null) throw refusal(log, { adminId, sessionId }, 'NOT_FOUND', 'not_found');
      if (session.status !== 'scheduled') {
        throw refusal(
          log,
          { adminId, sessionId, enrollmentId },
          'SESSION_NOT_SCHEDULED',
          'not_scheduled',
        );
      }
      const at = await clock(tx);
      await store.cancelByAdmin(tx, [sessionId]);
      const { caseId, opened } = await store.openCase(tx, enrollmentId);
      await store.recordEvents(tx, [
        { enrollmentId, sessionId, kind: 'cancelled_by_admin', caseId, occurredAt: at },
      ]);
      log.info(
        { adminId, sessionId, enrollmentId, caseId, caseOpened: opened },
        'A session was cancelled by an administrator',
      );
      return { sessionId, status: 'cancelled_by_admin', caseId };
    },
  };
}
