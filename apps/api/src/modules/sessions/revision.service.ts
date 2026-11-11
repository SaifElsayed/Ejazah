// T059 of specs/004-sessions/tasks.md (SRS FR-DISPUTE-7, FR-ADMIN-20 (b); FR-439, FR-472, FR-480,
// FR-495; research R-308, «A ruling's revision», R-323 GAP-3; contracts/admin-surface.md,
// `disputes.revise` and `sessions.review.revise`; contracts/kernel.md, the revision's and the
// correction's rows): an administrator's revision of a dispute's ruling and correction of an
// outcome nobody disputed, on the administrator call's transaction. Both write the session's outcome
// through the one writer of an administrator's outcome (`admin-outcome.service.ts`): `status`,
// `settled_by_admin_id`, `admin_settled_at` by the database's clock, and one event row,
// `dispute_revised` (the dispute in `case_id`) or `outcome_corrected`, each with the outcome before
// and after. The audit entry, with the mandatory reason, is the router's.
//
// THE KEY (the note under T059, Q1 (a)). Each call is keyed through the kernel's
// `IdempotencyService.runOn` on the call's own transaction, scope `disputes.revise` or
// `sessions.review.revise`, the actor the administrator, the input hashed without its key; the key
// is claimed before any row is locked. A repeat answers the first result and `replayed`, and writes
// nothing: the router then records no audit entry (the first call's is the record). The same key
// with another input is `CONFLICT`. A refusal rolls the whole call back, the key's claim with it.
//
// THE REVISION. Refused, writing nothing, by `ruling-revision.ts`' one rule: `SESSION_UNDER_REVIEW`,
// `DISPUTE_OPEN`, `RULING_FINAL` (`window_closed`, `remedy_offered`), `RULING_SUPERSEDED`; no session
// dispute, `NOT_FOUND`. The dispute's `resolution`, `resolution_notes`, `resolved_by_admin_id` and
// `resolved_at` are never written: the ruling stays as ruled. `notUndone` names what the ruling did
// that stays: a `party_suspended` or `party_banned` ruling, and the enrollment no longer `confirmed`.
// A revision suspends, bans, reinstates and reopens nothing, and checks no count (R-322).
//
// THE CORRECTION. Refused, writing nothing, by `outcome-correction.ts`' one function (F2's order):
// `CONFLICT` `not_settled`, `SESSION_UNDER_REVIEW`, `DISPUTE_OPEN`, `RULING_FINAL` (`window_closed`,
// `remedy_offered`), `CONFLICT` `ruled` with the resolved dispute's id (its ruling is revised by
// `disputes.revise`); none, `NOT_FOUND`. A participant may still dispute the corrected outcome
// inside the window (T026).
//
// Neither offers a remedy: `advance-remedies` offers what the outcome owes once the window has
// closed and no dispute is open (A2). Neither runs the completion check: the window is still open,
// so completion would be postponed; the sweep completes the enrollment after the window's close.
//
// THE LOCKS (kernel.md; T005's rules). The session, or the dispute and then its session, read with
// no lock only to learn the enrollment; then the enrollment (`EnrollmentSide.lockEnrollments`), the
// session and, for a revision, the dispute revised, each `FOR UPDATE`, and everything read again
// under them (rule 1). The session's other disputes and its remedy are read under the session's
// lock, which a dispute's raising and a remedy's offer take first. Nothing of `disputes` is written;
// no `StandingService`, so no account. The event references the enrollment, the session and, for a
// revision, the dispute, all held.
//
// THE LOG (the owner's rule). Each refusal writes one info line of ids and its code and cause,
// marked «logged»; each revision or correction one of ids and the two outcomes, never the reason.
import type {
  DisputesReviseInput,
  DisputesReviseOutput,
  SessionsReviewReviseInput,
  SessionsReviewReviseOutput,
} from '@ijazah/contracts/admin';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  DomainError,
  type ErrorCode,
  type FieldIssue,
} from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  lockDispute,
  type SessionDisputeRow,
  sessionDisputeOf,
  sessionDisputesOfSession,
} from '../moderation/index.js';
import { type AdminOutcomeWrite, writeAdminOutcome } from './admin-outcome.service.js';
import { DISPUTE_WINDOW_SETTING, disputeWindowHours } from './completion.service.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { correctionRefusal } from './outcome-correction.js';
import { lockRows } from './remaining-sessions.repository.js';
import {
  type RulingRevision,
  revisionsOf,
  type SessionToRevise,
  sessionToRevise,
} from './revision.repository.js';
import { revisionRefusal } from './ruling-revision.js';
import type { RecordedOutcome } from './session-events.repository.js';

/** What the revision and the correction read, lock and write, each on the caller's transaction. */
export interface RevisionStore {
  /** Moderation's: the session dispute, or null. */
  disputeOf(tx: Transaction, disputeId: string): Promise<SessionDisputeRow | null>;
  /** Moderation's: the session's session disputes, oldest first. */
  disputesOfSession(tx: Transaction, sessionId: string): Promise<readonly SessionDisputeRow[]>;
  sessionToRevise(tx: Transaction, sessionId: string): Promise<SessionToRevise | null>;
  revisionsOf(tx: Transaction, disputeId: string): Promise<readonly RulingRevision[]>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** Moderation's: the dispute's row lock, after the session. */
  lockDispute(tx: Transaction, disputeId: string): Promise<void>;
  /** The one writer of an administrator's outcome. */
  writeOutcome(tx: Transaction, write: AdminOutcomeWrite): Promise<void>;
}

export const revisionStore: RevisionStore = {
  disputeOf: sessionDisputeOf,
  disputesOfSession: sessionDisputesOfSession,
  sessionToRevise,
  revisionsOf,
  lockSessions: (tx, ids) => lockRows(tx, 'sessions', ids),
  lockDispute,
  writeOutcome: (tx, write) => writeAdminOutcome(tx, write),
};

/** A keyed call's answer and whether it was replayed from the key's row. */
export interface Keyed<TAnswer> {
  readonly outcome: TAnswer;
  readonly replayed: boolean;
}

export interface Revisions {
  /** `disputes.revise` (this file's head). */
  reviseRuling(
    tx: Transaction,
    adminId: string,
    input: DisputesReviseInput,
  ): Promise<Keyed<DisputesReviseOutput>>;
  /** `sessions.review.revise` (this file's head). */
  correctOutcome(
    tx: Transaction,
    adminId: string,
    input: SessionsReviewReviseInput,
  ): Promise<Keyed<SessionsReviewReviseOutput>>;
  /** `disputes.get`'s `revisable` and `revisions`, read with no lock. */
  revisionView(
    tx: Transaction,
    dispute: SessionDisputeRow,
  ): Promise<{ readonly revisable: boolean; readonly revisions: readonly RulingRevision[] }>;
}

/** The ids a refusal's line names. */
interface RefusalIds {
  readonly adminId: string;
  readonly sessionId?: string;
  readonly disputeId?: string;
  readonly enrollmentId?: string;
}

/**
 * Logs the refusal with ids, its code and its cause only, and answers the error to throw, marked
 * «logged»; a cause travels as `details: [{ path: 'cause', code }]`.
 */
function refusal(
  log: Pick<Logger, 'info'>,
  message: string,
  ids: RefusalIds,
  errorCode: ErrorCode,
  cause?: string,
  extra: readonly FieldIssue[] = [],
): DomainError {
  log.info({ ...ids, errorCode, ...(cause === undefined ? {} : { cause }) }, message);
  const details = [...(cause === undefined ? [] : [{ path: 'cause', code: cause }]), ...extra];
  return markRefusalLogged(
    new DomainError(errorCode, undefined, details.length === 0 ? {} : { details }),
  );
}

const REVISION_REFUSED = 'A ruling revision was refused';
const CORRECTION_REFUSED = 'An outcome correction was refused';

const RECORDED: ReadonlySet<string> = new Set([
  'done',
  'student_no_show',
  'teacher_no_show',
  'both_no_show',
]);

/** The session's status as one of the four outcomes; a broken invariant otherwise. */
function recorded(status: string): RecordedOutcome {
  if (!RECORDED.has(status)) throw new Error('sessions: a revisable session holds no outcome');
  return status as RecordedOutcome;
}

/** The input hashed with the key, without the key itself (ADR 0008). */
function withoutKey<T extends { readonly idempotencyKey: string }>({
  idempotencyKey: _key,
  ...rest
}: T): Omit<T, 'idempotencyKey'> {
  return rest;
}

export function createRevisions({
  enrollments,
  idempotency,
  settings,
  log,
  clock = clockTimestamp,
  store = revisionStore,
}: {
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments' | 'enrollmentFor'>;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the call's transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: RevisionStore;
}): Revisions {
  const windowAt = async (tx: Transaction) => ({
    now: await clock(tx),
    disputeWindowHours: await settings.read(DISPUTE_WINDOW_SETTING, disputeWindowHours),
  });

  /** The revision under its locks, the key already claimed. */
  const revise = async (
    tx: Transaction,
    adminId: string,
    input: DisputesReviseInput,
  ): Promise<DisputesReviseOutput> => {
    const { disputeId } = input;
    const seen = await store.disputeOf(tx, disputeId);
    if (seen === null) {
      throw refusal(log, REVISION_REFUSED, { adminId, disputeId }, 'NOT_FOUND', 'not_found');
    }
    const { sessionId, enrollmentId } = seen;
    const ids = { adminId, disputeId, sessionId, enrollmentId };
    await enrollments.lockEnrollments(tx, [enrollmentId]);
    await store.lockSessions(tx, [sessionId]);
    await store.lockDispute(tx, disputeId);
    const dispute = await store.disputeOf(tx, disputeId);
    const session = await store.sessionToRevise(tx, sessionId);
    if (dispute === null || session === null) {
      throw refusal(log, REVISION_REFUSED, ids, 'NOT_FOUND', 'not_found');
    }
    const disputes = await store.disputesOfSession(tx, sessionId);
    const window = await windowAt(tx);
    const refused = revisionRefusal(
      {
        dispute,
        disputes,
        status: session.status,
        scheduledEndAt: session.scheduledEndAt,
        hasRemedy: session.hasRemedy,
      },
      window,
    );
    if (refused !== null) {
      throw refusal(
        log,
        REVISION_REFUSED,
        ids,
        refused.code,
        'cause' in refused ? refused.cause : undefined,
      );
    }
    const previousStatus = recorded(session.status);
    await store.writeOutcome(tx, {
      sessionId,
      enrollmentId,
      from: session.status,
      outcome: input.outcome,
      adminId,
      at: window.now,
      event: { kind: 'dispute_revised', disputeId, outcomeBefore: previousStatus },
    });
    const terms = await enrollments.enrollmentFor(tx, enrollmentId);
    const notUndone: DisputesReviseOutput['notUndone'] = [
      ...(dispute.resolution === 'party_suspended' || dispute.resolution === 'party_banned'
        ? [dispute.resolution]
        : []),
      ...(terms !== null && terms.status !== 'confirmed' ? (['enrollment_ended'] as const) : []),
    ];
    log.info(
      { ...ids, previousStatus, sessionStatus: input.outcome },
      'A dispute ruling was revised',
    );
    return { disputeId, sessionStatus: input.outcome, previousStatus, notUndone };
  };

  /** The correction under its locks, the key already claimed. */
  const correct = async (
    tx: Transaction,
    adminId: string,
    input: SessionsReviewReviseInput,
  ): Promise<SessionsReviewReviseOutput> => {
    const { sessionId } = input;
    const seen = await store.sessionToRevise(tx, sessionId);
    if (seen === null) {
      throw refusal(log, CORRECTION_REFUSED, { adminId, sessionId }, 'NOT_FOUND', 'not_found');
    }
    const { enrollmentId } = seen;
    const ids = { adminId, sessionId, enrollmentId };
    await enrollments.lockEnrollments(tx, [enrollmentId]);
    await store.lockSessions(tx, [sessionId]);
    const session = await store.sessionToRevise(tx, sessionId);
    if (session === null) throw refusal(log, CORRECTION_REFUSED, ids, 'NOT_FOUND', 'not_found');
    const disputes = await store.disputesOfSession(tx, sessionId);
    const window = await windowAt(tx);
    const refused = correctionRefusal(
      {
        status: session.status,
        scheduledEndAt: session.scheduledEndAt,
        hasRemedy: session.hasRemedy,
        everDisputed: disputes.length > 0,
      },
      window,
    );
    if (refused !== null) {
      const cause = 'cause' in refused ? refused.cause : undefined;
      const ruled = disputes.findLast(({ status }) => status === 'resolved');
      const extra =
        cause === 'ruled' && ruled !== undefined ? [{ path: 'disputeId', code: ruled.id }] : [];
      throw refusal(log, CORRECTION_REFUSED, ids, refused.code, cause, extra);
    }
    const previousStatus = recorded(session.status);
    await store.writeOutcome(tx, {
      sessionId,
      enrollmentId,
      from: session.status,
      outcome: input.outcome,
      adminId,
      at: window.now,
      event: { kind: 'outcome_corrected', outcomeBefore: previousStatus },
    });
    log.info(
      { ...ids, previousStatus, sessionStatus: input.outcome },
      'A session outcome was corrected',
    );
    return { sessionId, sessionStatus: input.outcome, previousStatus };
  };

  return {
    reviseRuling: (tx, adminId, input) =>
      idempotency.runOn(
        tx,
        {
          scope: 'disputes.revise',
          key: input.idempotencyKey,
          actorId: adminId,
          input: withoutKey(input),
        },
        (keyed) => revise(keyed, adminId, input),
      ),

    correctOutcome: (tx, adminId, input) =>
      idempotency.runOn(
        tx,
        {
          scope: 'sessions.review.revise',
          key: input.idempotencyKey,
          actorId: adminId,
          input: withoutKey(input),
        },
        (keyed) => correct(keyed, adminId, input),
      ),

    revisionView: async (tx, dispute) => {
      const session = await store.sessionToRevise(tx, dispute.sessionId);
      const revisions = await store.revisionsOf(tx, dispute.id);
      if (session === null) return { revisable: false, revisions };
      const disputes = await store.disputesOfSession(tx, dispute.sessionId);
      const refused = revisionRefusal(
        {
          dispute,
          disputes,
          status: session.status,
          scheduledEndAt: session.scheduledEndAt,
          hasRemedy: session.hasRemedy,
        },
        await windowAt(tx),
      );
      return { revisable: refused === null, revisions };
    },
  };
}
