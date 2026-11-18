// T030 of specs/004-sessions/tasks.md (FR-463, FR-465, FR-467; SC-410; ADR 0018 D4; R-MONEY-6;
// research R-311): the one hand-off of a remedy to a compensation case, on the caller's transaction.
// A student's refund choice (`sessions.remedy.choose`, T031), a counter-proposal left unanswered and
// a make-up the database refused on every attempt (`advance-remedies`, T032) all hand over here, and
// T036 and T064 hand over as this does. Since T111 of specs/003-booking (DEC-84), no refund is chosen
// and an unanswered counter books the proposal: `makeup_refused` is the windows' only hand-off.
//
// WHAT EACH REASON HANDS OVER (data-model.md §3, the remedy table). `refund_choice`: an
// `awaiting_choice` remedy. `counter_unanswered`: a `counter_proposed` one. `makeup_refused`: a
// `proposed` one, or an `awaiting_choice` one past its choice window. `admin_opened_for_student`
// (an administrator's manual case, `cases.openManual`, T064; the note under T064, F6): any of the
// four open ones, `frozen` included, its `kind` left as it is. A remedy in any other state, and a
// `frozen` one for the first three reasons (a suspended student's, which nothing advances), is
// refused `REMEDY_NOT_OPEN`.
// The times a reason depends on (the answer window's close, the choice window's, the lead before
// the proposal's start) are the caller's to decide, under the locks below, which it takes before
// it reads them; those this takes again are the ones it already holds.
//
// WHAT IS WRITTEN. The enrollment's compensation case of the reason, opened or joined through
// moderation's `openCompensationCase` (one open case per enrollment and reason, so two refunds on
// one enrollment join one); the remedy `refund_case` with its `case_id` and `decided_at`, a pending
// counter-proposal's five `counter_*` columns cleared, which releases its reserved time (H3);
// `kind` `refund` for the two refunds and left `makeup` for `makeup_refused` (the owner's decision
// of 2026-11-10 on B38's conflict check, Q6 (a); data-model.md §2.3); one `session_events` row
// `remedy_handed_to_case`. No amount anywhere, and no share of a price computed (FR-467, R-MONEY-6):
// an administrator decides the case outside this path (FR-DISPUTE-6).
//
// THE LOCKS (contracts/kernel.md, the row «`sessions.remedy.choose` … and a counter left unanswered
// handed to a `counter_unanswered` case by the sweep»; T005's rules; Phase 3's general rule). The
// remedy is read with no lock only to learn its session, its enrollment and the session's two
// accounts (sessions' own copies, ADR 0010). Then `users` (both, one call, id order), the teacher's
// `lockKey('teacher-slots')`, the enrollment, the session and the remedy, each `FOR UPDATE`, and the
// remedy read again under them (rule 1), so the decision is never made on the first read. The case
// comes after the remedy, as the one order puts `disputes` after `session_remedies`, and its own
// enrollment lock is the one already held. The event's insert references the enrollment and the
// session, both held, and no account.
//
// THE CLOCK (the owner's decision of 2026-11-10, Q8 (a)). `decided_at` and the event's instant are
// the database's clock (`clockTimestamp`), read under the locks.
//
// THE LOG (the owner's rule; Q11 (a)). A refusal writes one info line of ids and a reason code,
// through this file's one `refusal`, marked «logged». The hand-off itself writes none: the two
// automatic ones (`counter_unanswered`, `makeup_refused`) are one info line each,
// `logRemedyHandedOff`, which the sweep writes after its transaction has committed, as completion's
// line is, so a rolled-back hand-off leaves no line. A student's refund choice is not an automatic
// action, so it has none.
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError, type ErrorCode } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import { type CompensationCase, openCompensationCase } from '../moderation/index.js';
import type { RemedyStatus } from './completion.repository.js';
import {
  handOver,
  type HandOverWrite,
  lockAccounts,
  lockEnrollments,
  lockRemedies,
  lockSessions,
  lockTeacherSlots,
  type RemedyToHandOff,
  remedyToHandOff,
} from './remedy-case.repository.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';

/** Why a remedy is handed to a case: the four of `COMPENSATION_REASONS` this hand-off opens. */
export const REMEDY_CASE_REASONS = [
  'refund_choice',
  'counter_unanswered',
  'makeup_refused',
  // T064: the student's manual case (R-326).
  'admin_opened_for_student',
] as const;

export type RemedyCaseReason = (typeof REMEDY_CASE_REASONS)[number];

/** The two hand-offs the system makes on its own (Q11 (a)), each with one line after its commit. */
export type AutomaticRemedyCaseReason = Exclude<
  RemedyCaseReason,
  'refund_choice' | 'admin_opened_for_student'
>;

/** The states each reason hands over (this file's head). */
const HANDED_FROM: Readonly<Record<RemedyCaseReason, readonly RemedyStatus[]>> = {
  refund_choice: ['awaiting_choice'],
  counter_unanswered: ['counter_proposed'],
  makeup_refused: ['proposed', 'awaiting_choice'],
  admin_opened_for_student: ['awaiting_choice', 'proposed', 'counter_proposed', 'frozen'],
};

/**
 * The reasons that make the remedy a refund; `makeup_refused` leaves its `kind` (Q6 (a)). Neither is
 * handed over any more (T111), and both are kept for the cases already open.
 */
const MAKES_A_REFUND: ReadonlySet<RemedyCaseReason> = new Set([
  'refund_choice',
  'counter_unanswered',
]);

/** What the hand-off reads, locks and writes, each on the caller's transaction; faked in a spec. */
export interface RemedyCaseStore {
  /** The remedy and its session's parties; no lock. */
  remedyToHandOff(tx: Transaction, remedyId: string): Promise<RemedyToHandOff | null>;
  /** Both accounts, `FOR UPDATE`, in one call. */
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  /** The teacher's `lockKey('teacher-slots')`. */
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  lockEnrollments(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockRemedies(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** The enrollment's case of the reason, opened or joined (moderation's). */
  openCase(
    tx: Transaction,
    enrollmentId: string,
    reason: RemedyCaseReason,
  ): Promise<CompensationCase>;
  /** The conditional hand-over; whether it moved the row. */
  handOver(
    tx: Transaction,
    remedyId: string,
    from: readonly RemedyStatus[],
    write: HandOverWrite,
  ): Promise<boolean>;
  /** T004's writer of `session_events` rows. */
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

/** The store over sessions' tables, the kernel's locks and moderation's entry (R-API-6). */
export const remedyCaseStore: RemedyCaseStore = {
  remedyToHandOff,
  lockAccounts,
  lockTeacherSlots,
  lockEnrollments,
  lockSessions,
  lockRemedies,
  openCase: openCompensationCase,
  handOver,
  recordEvents: recordSessionEvents,
};

export interface RemedyCaseInput {
  readonly remedyId: string;
  readonly reason: RemedyCaseReason;
}

/** What a hand-off did. */
export interface RemedyHandedOff {
  readonly remedyId: string;
  readonly sessionId: string;
  readonly enrollmentId: string;
  readonly caseId: string;
  /** Whether this hand-off opened the case, or joined the one already open. */
  readonly caseOpened: boolean;
  readonly reason: RemedyCaseReason;
  /** The remedy's `kind` once handed over. */
  readonly kind: 'makeup' | 'refund';
}

export interface RemedyCase {
  /** Hands the remedy to its enrollment's case of `reason`, on the caller's transaction (this file's head). */
  handOff(tx: Transaction, input: RemedyCaseInput): Promise<RemedyHandedOff>;
}

/** Why a hand-off was refused, as its one log line names it. */
type RefusalReason = 'not_found' | 'not_open';

/**
 * Logs the refusal with ids and its reason only, and answers the error to throw, marked «logged»
 * so `onError` writes no second line (PR #130's review, round 1, Minor 4).
 */
function refusal(
  log: Pick<Logger, 'info'>,
  ids: {
    readonly remedyId: string;
    readonly sessionId?: string;
    readonly enrollmentId?: string;
    readonly caseReason: RemedyCaseReason;
  },
  errorCode: ErrorCode,
  reason: RefusalReason,
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A remedy hand-off was refused');
  return markRefusalLogged(new DomainError(errorCode));
}

export function createRemedyCase({
  log,
  clock = clockTimestamp,
  store = remedyCaseStore,
}: {
  /** For the refusals' lines. */
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the call's transaction (Q8). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: RemedyCaseStore;
}): RemedyCase {
  return {
    handOff: async (tx, { remedyId, reason }) => {
      const seen = await store.remedyToHandOff(tx, remedyId);
      if (seen === null) {
        throw refusal(log, { remedyId, caseReason: reason }, 'NOT_FOUND', 'not_found');
      }
      const { sessionId, enrollmentId, studentUserId, teacherUserId } = seen;
      await store.lockAccounts(tx, [studentUserId, teacherUserId].sort());
      await store.lockTeacherSlots(tx, teacherUserId);
      await store.lockEnrollments(tx, [enrollmentId]);
      await store.lockSessions(tx, [sessionId]);
      await store.lockRemedies(tx, [remedyId]);
      const remedy = await store.remedyToHandOff(tx, remedyId);
      const from = HANDED_FROM[reason];
      if (remedy === null || !from.includes(remedy.status)) {
        throw refusal(
          log,
          { remedyId, sessionId, enrollmentId, caseReason: reason },
          'REMEDY_NOT_OPEN',
          'not_open',
        );
      }
      const at = await clock(tx);
      const { caseId, opened } = await store.openCase(tx, enrollmentId, reason);
      const makesARefund = MAKES_A_REFUND.has(reason);
      const moved = await store.handOver(tx, remedyId, from, {
        caseId,
        decidedAt: at,
        ...(makesARefund ? { kind: 'refund' as const } : {}),
      });
      // Read under the remedy's lock in a state `from` holds, so the conditional update matches.
      if (!moved) throw new Error('sessions: a locked remedy left its state before its hand-off');
      await store.recordEvents(tx, [
        { enrollmentId, sessionId, kind: 'remedy_handed_to_case', occurredAt: at },
      ]);
      return {
        remedyId,
        sessionId,
        enrollmentId,
        caseId,
        caseOpened: opened,
        reason,
        kind: makesARefund ? 'refund' : remedy.kind,
      };
    },
  };
}

/**
 * The automatic hand-off's one info line (Q11 (a)): ids and the action, nothing else. The sweep
 * writes it once its transaction has committed (this file's head, THE LOG).
 */
export function logRemedyHandedOff(
  log: Pick<Logger, 'info'>,
  {
    remedyId,
    sessionId,
    enrollmentId,
    reason,
  }: RemedyHandedOff & {
    readonly reason: AutomaticRemedyCaseReason;
  },
): void {
  log.info({ remedyId, sessionId, enrollmentId, action: reason }, 'A remedy was handed to a case');
}
