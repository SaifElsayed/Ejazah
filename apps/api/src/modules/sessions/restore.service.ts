// T061 of specs/004-sessions/tasks.md (FR-454, FR-455, FR-470, FR-480, FR-495; SRS FR-CANCEL-8;
// research R-322, «The restore», and R-320's two rows of 2026-11-05; ADR 0023 D4;
// contracts/admin-surface.md, `sessions.restore`; contracts/kernel.md, the restore row): an
// administrator restores an enrollment an administrator's decision closed, on the administrator
// call's transaction. The one file that calls `EnrollmentSide.restore` (the note under T061, PR
// #128's Minor). The audit entry (`enrollment.restored`, with the reason) is the router's; so are the
// limit (`rate_limit_enrollment_restore`, before the transaction) and the deadlock's retry (the
// kind's declaration: the whole transaction, the key's claim with it, rerun once; a second
// deadlock `RESTORE_REFUSED` `time_taken`).
//
// KEYED through the kernel's `IdempotencyService.runOn` on the kind's transaction (the note under
// T061, F1; as `disputes.revise` and `cases.openManual`), scope `sessions.restore`, the
// administrator as actor, the input without its key as what was asked: a repeat answers the first
// result and writes nothing (`replayed`), the same key with another input is the kernel's `CONFLICT`.
//
// THE LOCKS (kernel.md's restore row; `003:T005`'s rules). The enrollment is read once with no lock
// for its parties and slot (they never change). Then both accounts in one call (the sessions it
// inserts reference both), the teacher's `lockKey('teacher-slots')`, the enrollment's slot
// (`availability_slots`, as a hold and `slotInUse` take it), the enrollment, its sessions (one call)
// and their remedies (one call), each read again under its lock (rule 1); `disputes` last, the
// closing's case closed through `closeCase`, whose enrollment lock is the one held. The reservations
// and the open holds are read under these: every path that places a hold or a reservation locks the
// accounts first. Every row written references only rows held. T073 adds no lock (kernel.md's
// restore row): the enrollment's cases (moderation's entry) and its `cancelled_by_admin` rows are
// read under the enrollment's and the sessions' locks, which every case closing and every
// cancellation take first; its orders (`EnrollmentPayments.refundedOf`) are read with no lock (N3),
// every order move taking the enrollment's lock before the order's (`payments/order-events.service.ts`),
// so none moves to `refunded` before this transaction commits.
//
// WHAT IS REFUSED (R-322's steps, in order), each `RESTORE_REFUSED` with `details.cause`, writing
// nothing: first (006:T010 of specs/006-programme, G-1, R-513) a programme's enrollment (a
// `programmes` row in its terms) `programme_enrollment`, whatever closed it, a stopped programme
// being reopened by `programmes.reopen` instead; (1) the closing, by T070's one closing rule (`restore-window.ts`'s `closingOf`; T073, Q4
// (a)) over the enrollment's status, its last cancellation's reason and its latest end case, the
// cases read through moderation's entry — `terminated_no_show` with `absence_termination`,
// `cancelled` `admin` with `student_fault_confirmed` or (T073, DEC-66) a ban's `student_banned`, or
// `cancelled` `teacher_suspended` with (T073) a teacher's ban's or revocation's `teacher_ended`; any
// other `not_restorable` (a deletion, a gender correction (Q10 (a)), a completion, an enrollment not
// closed), a closed case `case_closed`; (2) retired (T073, DEC-69): no restore is refused for its
// time, `window_closed` never produced, the window holding only the slot (T070); then (T073, FR-507,
// Q4 (a)) any order of the enrollment `refunded`, through the `EnrollmentPayments` port, `refunded`;
// (3) both accounts `active` and the teacher's approval standing, as the join reads
// them (FR-432), else `party_restricted`; (5, 6) the slot deactivated `slot_inactive`, then, before the
// weeks, the slot's weekday, local start or zone differing from the enrollment's lowest-numbered
// session that is not a make-up and its `snapshot_slot_timezone`, `slot_changed` (a length change
// alone is not); then each week the restore would fill, the slot taken by another student's hold or
// enrollment `slot_taken`, an occurrence overlapping a session, an open hold or a reservation of
// either party, or (006:T010, PR #156 r1 Follow-up 1) the weekly time of another active programme of
// the student (`EnrollmentSide.programmeTimesOf`, this enrollment left out), `time_taken`, and the
// database's exclusion refusing the insert `time_taken`. A
// nonexistent enrollment answers `NOT_FOUND`, as every administrator read of an id does.
// A make-up the closing's case held for which T028's offer finds no free week answers `CONFLICT`
// `no_free_week` (the note under T061, on B39 Q5 (a)'s precedent): the whole transaction rolled
// back, the case left open, the offer's own warn line `{ sessionId, enrollmentId, reason }` written.
//
// THE COUNT K (step 4): the snapshot's count less the sessions consumed (`done`, `student_no_show`,
// make-ups included) and less every session owed or settling on its own path: a remedy
// `refund_case` (offered again below, or refunded through its own case), a remedy never offered (a
// Teacher-No-Show, Both-No-Show or Cancelled-By-Agreement session with no remedy), and a session not
// yet settled (`disputed`, `under_threshold`, `provider_outage`). A make-up the closing cancelled,
// its original's remedy `booked`, is among the K, so no session is owed twice. T073 (SRS FR-CANCEL-8
// as amended, FR-507; PR #134's Minor 1): less each `cancelled_by_admin` session whose
// `session_events` row names an `admin_cancellation` case (`sessions.cancel`'s, read through
// moderation's entry), already owed through that case; never one the closing, or a suspension before
// a fault, cancelled (their rows name the closing's or the suspension's case), which the K recreate.
//
// THE WRITES, in the same transaction: `EnrollmentSide.restore` (`confirmed`, the reason cleared,
// `confirmed_at` untouched, `slot_released_at` cleared (T073; T070's follow-up 2), one `restored`
// event); the K sessions through T034's generation widened
// with a count and a first number (after the last), from the first weekly occurrence at least
// `first_session_lead_hours` after the restore's instant; each make-up the closing's case held
// offered again through T028's offer (`restoredCase`: a full choice window from now, A and L read
// again, the proposal after the recreated sessions, `case_id` and `decided_at` cleared, one
// `remedy_offered` row); the case closed `dismissed`, note `restored`. The cancelled sessions, the
// complaint and the closing's events stay as they are.
//
// THE LOG (the owner's rule). A refusal one info line `{ adminId, enrollmentId, errorCode, cause }`,
// marked «logged»; each offer its `offeredLine`; the restore one line of ids and counts, on the
// call's transaction (the administrator kind has no after-commit point for a log line). Never the
// reason.
//
// THE LIVE EVENT (T066; FR-427; research R-324, item 6; the note under T066, Q3 (a)). Inside the
// keyed effect, once the case is closed, `enrollment` for both parties, read under the locks, is
// added to the administrator kind's after-commit list bound to this transaction (`publisherOn`):
// sent once it commits, nothing on a replay (no effect runs) or a rollback, and inside the kind's
// declared deadlock retry, which starts each attempt with an empty list, only the committed
// attempt's event.
//
// THE CORE (T073; the note under T073, Q8 (a)): `restoreClosed(tx, adminId, enrollmentId, now)`,
// a member of what `createRestore` builds, its dependencies bound once, which T072's lift calls
// under its own key, audit and limit, its locks already held: the steps, the writes and the log
// above, at the instant handed in, with no key, audit or limit of its own; it answers
// `{ restored: true }` or throws the refusal as `sessions.restore` does (the administrator's id
// written by `closeCase` and logged on every refusal). `sessions.restore` wraps the same core
// unchanged: keyed through `runOn`, the instant the database's clock read under the locks.
//
// THE MARK (T072; the note under T072, Q7 (a); the owner's word on B42a lane D's Q-D1, «موافق»,
// 2026-11-13). The two refusals thrown after `EnrollmentSide.restore` has landed, `no_free_week`
// from T028's offer and `time_taken` from the database's exclusion at the insert, carry the mark
// «refused after a write» (`isRefusedAfterWrite`, held weakly, as the «logged» mark is); every cause
// found before the first write carries none. A lift reads it: an unmarked refusal leaves that one
// enrollment ended, a marked one refuses the whole lift (Prisma gives no savepoint). The answers of
// `sessions.restore` are unchanged.
import type { SessionsRestoreInput, SessionsRestoreOutput } from '@ijazah/contracts/admin';
import { localTimeOf, type TimeZoneId } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import { isExclusionViolation } from '../../platform/db/db-errors.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { readSlot, type SlotRow } from '../catalog/index.js';
import { sessionPartiesOf } from '../identity/index.js';
import {
  type CaseClosing,
  closeCase,
  compensationCasesOf,
  type EnrollmentCase,
} from '../moderation/index.js';
import type { EnrollmentPayments } from './enrollment-payments.port.js';
import type {
  EnrollmentEventEntry,
  EnrollmentSide,
  EnrollmentTerms,
} from './enrollment-side.port.js';
import {
  type EnrollmentToSchedule,
  generateForEnrollment,
  type GenerationPlan,
  type ScheduledSession,
  sessionsFor,
} from './generation.service.js';
import { lockSlots } from './makeup-booking.repository.js';
import {
  lockAccounts,
  lockRemedies,
  lockSessions,
  lockTeacherSlots,
} from './remedy-case.repository.js';
import {
  FIRST_SESSION_LEAD_SETTING,
  type Offered,
  offeredLine,
  type RemedyOffer,
} from './remedy-offer.service.js';
import {
  type ReservationReads,
  type ReservedTime,
  reservedTimesOf,
} from './reservations.service.js';
import {
  type CancellationCase,
  cancellationCasesOf,
  type RestoreSession,
  restoreSessionsOf,
  sessionIdsFrom,
} from './restore.repository.js';
import { closingOf, latestEndCaseOf } from './restore-window.js';
import { partiesSessionsBetween, type SessionTime } from './sessions.repository.js';
import type { PartyStanding } from './sessions.service.js';

/** What the restore locks, reads and writes besides the enrollment side; faked in a spec. */
export interface RestoreStore {
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  lockSlot(tx: Transaction, slotId: string): Promise<void>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockRemedies(tx: Transaction, ids: readonly string[]): Promise<void>;
  sessionsOf(tx: Transaction, enrollmentId: string): Promise<readonly RestoreSession[]>;
  /**
   * Moderation's: the enrollment's compensation cases, newest first (`compensationCasesOf`): the
   * closing's case for step 1 (T073, Q4 (a)) and the `admin_cancellation` cases for step 4.
   */
  casesOf(tx: Transaction, enrollmentId: string): Promise<readonly EnrollmentCase[]>;
  /** T073: the cases the enrollment's `cancelled_by_admin` rows name, by session (step 4). */
  cancellationCasesOf(tx: Transaction, enrollmentId: string): Promise<readonly CancellationCase[]>;
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, PartyStanding>>;
  /** Catalog's: the slot, read under its lock. */
  slotOf(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  sessionsBetween(
    tx: Transaction,
    parties: { readonly studentUserId: string; readonly teacherUserId: string },
    window: { readonly from: Date; readonly to: Date },
  ): Promise<readonly SessionTime[]>;
  reservedTimesOf(
    tx: Transaction,
    userIds: readonly string[],
    window: { readonly from: Date; readonly to: Date },
    reads: ReservationReads,
  ): Promise<readonly ReservedTime[]>;
  /** T034's generation, widened with a plan (T061). */
  generate(
    tx: Transaction,
    enrollment: EnrollmentToSchedule,
    at: Date,
    leadHours: number,
    plan: GenerationPlan,
  ): Promise<readonly ScheduledSession[]>;
  sessionIdsFrom(
    tx: Transaction,
    enrollmentId: string,
    from: number,
  ): Promise<ReadonlyMap<number, string>>;
  /** Moderation's `closeCase`: the closing instant, or null when the case is not open. */
  closeCase(tx: Transaction, caseId: string, closing: CaseClosing): Promise<Date | null>;
}

/** The store over sessions' tables, the kernel's locks and the owners' entries (R-API-6). */
export const restoreStore: RestoreStore = {
  lockAccounts,
  lockTeacherSlots,
  lockSlot: (tx, slotId) => lockSlots(tx, [slotId]),
  lockSessions,
  lockRemedies,
  sessionsOf: restoreSessionsOf,
  casesOf: compensationCasesOf,
  cancellationCasesOf,
  partiesOf: sessionPartiesOf,
  slotOf: readSlot,
  sessionsBetween: partiesSessionsBetween,
  reservedTimesOf: (tx, userIds, window, reads) => reservedTimesOf(tx, userIds, window, reads),
  generate: generateForEnrollment,
  sessionIdsFrom,
  closeCase,
};

export interface RestoreDependencies {
  readonly enrollments: Pick<
    EnrollmentSide,
    | 'enrollmentFor'
    | 'lockEnrollments'
    | 'eventsOf'
    | 'restore'
    | 'slotWeekTaken'
    | 'heldTimesOf'
    | 'programmeTimesOf'
  >;
  /** The kernel's idempotency, keyed on the call's transaction (`runOn`). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  /** T028's offer, widened for a remedy the closing's case held (`restoredCase`). */
  readonly offers: Pick<RemedyOffer, 'offerLocked'>;
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info' | 'warn'>;
  /** The database's clock on the call's transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: RestoreStore;
  /**
   * T073 (FR-507; Q4 (a), Q6 (a), N3): whether an order of the enrollment was refunded, payments'
   * `refundedOf`, handed in by the admin module (`AdminServiceDependencies.enrollmentPayments`).
   */
  readonly payments: EnrollmentPayments;
}

/** T073 (Q8 (a)): what the core answers when it restored the enrollment. */
export interface RestoredClosing {
  readonly restored: true;
}

export interface Restore {
  /** `sessions.restore` on the administrator call's transaction (this file's head). */
  restore(
    tx: Transaction,
    adminId: string,
    input: SessionsRestoreInput,
  ): Promise<{ readonly answer: SessionsRestoreOutput; readonly replayed: boolean }>;
  /**
   * T073 (Q8 (a)): the core, on the caller's transaction at `now`, with no key, audit or limit of
   * its own (this file's head, «THE CORE»); throws the refusal as `restore` does.
   */
  restoreClosed(
    tx: Transaction,
    adminId: string,
    enrollmentId: string,
    now: Date,
  ): Promise<RestoredClosing>;
}

/**
 * R-322's causes, steps 1 to 6 and (T073) the ninth, `refunded`. `window_closed` (step 2) is never
 * produced since T073 (DEC-69); the contract keeps it, `@deprecated` (R-API-9).
 */
type RestoreCause =
  | 'not_restorable'
  | 'refunded'
  | 'case_closed'
  | 'party_restricted'
  | 'slot_inactive'
  | 'slot_changed'
  | 'slot_taken'
  | 'time_taken'
  // 005:T014 of B47 (FR-617; research R-409): step 3, the two declared genders differ.
  | 'gender_mismatch'
  // 006:T010 (G-1; R-513): a programme's enrollment, never restored (`programmes.reopen` is its path).
  | 'programme_enrollment';

interface RefusalIds {
  readonly adminId: string;
  readonly enrollmentId: string;
}

/** The refusal's error, marked «logged» after its one line of ids and its cause. */
function refused(log: Pick<Logger, 'info'>, ids: RefusalIds, cause: RestoreCause): DomainError {
  log.info({ ...ids, errorCode: 'RESTORE_REFUSED', cause }, 'An enrollment restore was refused');
  return markRefusalLogged(
    new DomainError('RESTORE_REFUSED', undefined, { details: [{ path: 'cause', code: cause }] }),
  );
}

/**
 * The note under T061 (B40, the review session on B39 Q5 (a)'s precedent, rule d): a remedy the
 * closing's case held finds no free week, an additive `CONFLICT` cause, not a ninth restore cause.
 */
function noFreeWeek(
  log: Pick<Logger, 'info'>,
  ids: RefusalIds & { readonly sessionId: string },
): DomainError {
  log.info(
    { ...ids, errorCode: 'CONFLICT', cause: 'no_free_week' },
    'An enrollment restore was refused',
  );
  return markRefusalLogged(
    new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: 'no_free_week' }] }),
  );
}

/** T072: the refusals thrown after `EnrollmentSide.restore` landed (this file's head, «THE MARK»). */
const refusedAfterWrite = new WeakSet<object>();

/** T072: marks `error` «refused after a write» and answers it. */
function afterWrite<TError extends object>(error: TError): TError {
  refusedAfterWrite.add(error);
  return error;
}

/**
 * T072 (the note under T072, Q7 (a)): whether the restore refused `error` after its first write
 * (`no_free_week`, or the database's exclusion at the insert), which a lift turns into its whole
 * refusal `restore_failed`; false for every cause found before it.
 */
export function isRefusedAfterWrite(error: unknown): boolean {
  return typeof error === 'object' && error !== null && refusedAfterWrite.has(error);
}

function notFound(log: Pick<Logger, 'info'>, ids: RefusalIds): DomainError {
  log.info(
    { ...ids, errorCode: 'NOT_FOUND', cause: 'not_found' },
    'An enrollment restore was refused',
  );
  return markRefusalLogged(new DomainError('NOT_FOUND'));
}

const SCOPE = 'sessions.restore';
/** The seconds a `time` column's local time carries, which the contract's `HH:MM` leaves out. */
const SECONDS = ':00';
const wholeHours = z.int().nonnegative();

const CONSUMED: ReadonlySet<string> = new Set(['done', 'student_no_show']);
const UNSETTLED: ReadonlySet<string> = new Set(['disputed', 'under_threshold', 'provider_outage']);
const OWING: ReadonlySet<string> = new Set([
  'teacher_no_show',
  'both_no_show',
  'cancelled_by_agreement',
  // 003:T112 (the owner's Q-B (a)): a postponed session, as an agreed cancellation.
  'postponed',
]);

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/** T073: the reason of the case `sessions.cancel` opens or joins (moderation's `COMPENSATION_REASONS`). */
const ADMIN_CANCELLATION = 'admin_cancellation';

/** The enrollment's last cancellation's reason, from its events (oldest first); null for none. */
function lastCancellationReasonOf(events: readonly EnrollmentEventEntry[]): string | null {
  return events.filter(({ kind }) => kind === 'cancelled').at(-1)?.cancellationReason ?? null;
}

/**
 * T073 (step 4): the sessions `sessions.cancel` cancelled, whose `cancelled_by_admin` row names one
 * of the enrollment's `admin_cancellation` cases; never one whose row names the closing's case or a
 * suspension's.
 */
function cancelledWithOwnCase(
  cases: readonly EnrollmentCase[],
  cancellations: readonly CancellationCase[],
): ReadonlySet<string> {
  const own = new Set(
    cases.filter(({ reason }) => reason === ADMIN_CANCELLATION).map(({ caseId }) => caseId),
  );
  return new Set(
    cancellations.filter(({ caseId }) => own.has(caseId)).map(({ sessionId }) => sessionId),
  );
}

/** K: the sessions still owed and not settling on their own path (this file's head). */
function sessionsStillOwed(
  sessionCount: number,
  sessions: readonly RestoreSession[],
  ownCase: ReadonlySet<string>,
): number {
  const taken = sessions.filter(
    ({ id, status, remedy }) =>
      CONSUMED.has(status) ||
      UNSETTLED.has(status) ||
      remedy?.status === 'refund_case' ||
      (OWING.has(status) && remedy === null) ||
      // T073: owed through its own `admin_cancellation` case (SRS FR-CANCEL-8, FR-507).
      (status === 'cancelled_by_admin' && ownCase.has(id)),
  ).length;
  return Math.max(0, sessionCount - taken);
}

/** Whether the slot still stands where the enrollment's own generated sessions were asked. */
function slotUnchanged(slot: SlotRow, terms: EnrollmentTerms, sessions: readonly RestoreSession[]) {
  const first = sessions.find(({ makeupForSessionId }) => makeupForSessionId === null);
  if (first === undefined) return slot.timezone === terms.timezone;
  return (
    // `scheduled_date_local` is the day's midnight in UTC; its weekday is the requested one (ERD §5).
    first.scheduledDateLocal.getUTCDay() === slot.dayOfWeek &&
    localTimeOf(first.scheduledStartTimeLocal) === slot.startTimeLocal &&
    first.timezone === slot.timezone &&
    terms.timezone === slot.timezone
  );
}

/** Whether `[startsAt, endsAt)` overlaps one of `times`; each range holds its start, not its end. */
function overlapsAny(
  time: { readonly startsAt: Date; readonly endsAt: Date },
  times: readonly { readonly startsAt: Date; readonly endsAt: Date }[],
): boolean {
  return times.some(({ startsAt, endsAt }) => time.startsAt < endsAt && startsAt < time.endsAt);
}

const isOverlapRefusal = (error: unknown): boolean =>
  isExclusionViolation(error, 'sessions_teacher_no_overlap') ||
  isExclusionViolation(error, 'sessions_student_no_overlap');

export function createRestore({
  enrollments,
  idempotency,
  offers,
  settings,
  log,
  clock = clockTimestamp,
  store = restoreStore,
  payments,
}: RestoreDependencies): Restore {
  /** The enrollment's sessions and their remedies, locked in the row's order and read again. */
  const lockSessionsAndRemedies = async (tx: Transaction, enrollmentId: string) => {
    const seen = await store.sessionsOf(tx, enrollmentId);
    await store.lockSessions(tx, sortedUnique(seen.map(({ id }) => id)));
    const remedies = (await store.sessionsOf(tx, enrollmentId)).flatMap(({ remedy }) =>
      remedy === null ? [] : [remedy.id],
    );
    if (remedies.length > 0) await store.lockRemedies(tx, sortedUnique(remedies));
  };

  /** Each week the restore would fill, refused by the slot or a time of either party (step 5). */
  const weeksFree = async (
    tx: Transaction,
    terms: EnrollmentTerms,
    planned: readonly ScheduledSession[],
    ids: RefusalIds,
  ): Promise<void> => {
    for (const week of planned) {
      if (await enrollments.slotWeekTaken(tx, terms.slotId, week.scheduledDateLocal, terms.id)) {
        throw refused(log, ids, 'slot_taken');
      }
    }
    const first = planned[0];
    const last = planned.at(-1);
    if (first === undefined || last === undefined) return;
    const window = { from: new Date(first.scheduledStartAt), to: new Date(last.scheduledEndAt) };
    const people = [terms.studentUserId, terms.teacherUserId];
    const parties = { studentUserId: terms.studentUserId, teacherUserId: terms.teacherUserId };
    const [own, held, reserved, programme] = await Promise.all([
      store.sessionsBetween(tx, parties, window),
      enrollments.heldTimesOf(tx, people, window),
      store.reservedTimesOf(tx, people, window, enrollments),
      // 006:T010 (PR #156 r1 Follow-up 1): the student's other active programmes' weekly times.
      enrollments.programmeTimesOf(tx, [terms.studentUserId], window, terms.id),
    ]);
    const taken = [...own, ...held, ...reserved, ...programme];
    for (const week of planned) {
      const time = {
        startsAt: new Date(week.scheduledStartAt),
        endsAt: new Date(week.scheduledEndAt),
      };
      if (overlapsAny(time, taken)) throw refused(log, ids, 'time_taken');
    }
  };

  /**
   * The core (this file's head): `nowOf` answers the restore's instant, read under the locks; the
   * database's clock for `sessions.restore`, the instant handed in for `restoreClosed` (T073).
   */
  const restoreLocked = async (
    tx: Transaction,
    adminId: string,
    enrollmentId: string,
    nowOf: () => Promise<Date>,
  ): Promise<SessionsRestoreOutput> => {
    const ids = { adminId, enrollmentId };
    const seen = await enrollments.enrollmentFor(tx, enrollmentId);
    if (seen === null) throw notFound(log, ids);
    await store.lockAccounts(tx, sortedUnique([seen.studentUserId, seen.teacherUserId]));
    await store.lockTeacherSlots(tx, seen.teacherUserId);
    await store.lockSlot(tx, seen.slotId);
    await enrollments.lockEnrollments(tx, [enrollmentId]);
    await lockSessionsAndRemedies(tx, enrollmentId);

    const terms = await enrollments.enrollmentFor(tx, enrollmentId);
    if (terms === null) throw notFound(log, ids);
    // 006:T010 (G-1): a programme's enrollment is never restored, before every step and any write.
    if (terms.programme !== undefined) throw refused(log, ids, 'programme_enrollment');
    // Read under the enrollment's and the sessions' locks, which every case closing and every
    // cancellation take first (this file's head, «THE LOCKS»).
    const [sessions, events, cases, cancellations] = await Promise.all([
      store.sessionsOf(tx, enrollmentId),
      enrollments.eventsOf(tx, enrollmentId),
      store.casesOf(tx, enrollmentId),
      store.cancellationCasesOf(tx, enrollmentId),
    ]);
    // Step 1: the closing and its case, by T070's one closing rule (T073, Q4 (a)).
    const closing = closingOf({
      status: terms.status,
      lastCancellationReason: lastCancellationReasonOf(events),
      endCase: latestEndCaseOf(cases),
    });
    if (closing === undefined) throw refused(log, ids, 'not_restorable');
    if (!closing.restorable) throw refused(log, ids, 'case_closed');
    const { closingCase } = closing;
    // Step 2 retired (T073, DEC-69): no restore is refused for its time; the window holds the slot.
    // The ninth cause (T073, FR-507, Q4 (a)): any order of the enrollment refunded at the gateway.
    // Read with no lock (N3): every order move takes this enrollment's lock, held here, first.
    if (await payments.refundedOf(tx, enrollmentId)) throw refused(log, ids, 'refunded');
    const [now, leadHours] = await Promise.all([
      nowOf(),
      settings.read(FIRST_SESSION_LEAD_SETTING, wholeHours),
    ]);
    // Step 3: both accounts active, the teacher's approval standing (FR-432).
    const parties = await store.partiesOf(tx, [terms.studentUserId, terms.teacherUserId]);
    const student = parties.get(terms.studentUserId);
    const teacher = parties.get(terms.teacherUserId);
    if (
      student?.accountStatus !== 'active' ||
      teacher?.accountStatus !== 'active' ||
      !teacher.teacherApproved
    ) {
      throw refused(log, ids, 'party_restricted');
    }
    // 005:T014 of B47 (FR-617; research R-409; DEC-69): step 3 also compares the pairing's two
    // declared genders, read under both accounts' locks, whatever closed the enrollment, so no
    // restore puts a mixed pairing back after either party's correction. No gender is logged.
    if (student.gender !== teacher.gender) throw refused(log, ids, 'gender_mismatch');
    // Steps 5 and 6: the slot, read under its lock.
    const slot = await store.slotOf(tx, terms.slotId);
    // `enrollments.slot_id` is a foreign key to the slot (ERD `enrollments`).
    if (slot === null) throw new Error('restore: an enrollment without its slot');
    if (!slot.isActive) throw refused(log, ids, 'slot_inactive');
    if (!slotUnchanged(slot, terms, sessions)) throw refused(log, ids, 'slot_changed');
    // Step 4: the count, then the weeks.
    const lastNumber = sessions.reduce(
      (max, { sequenceNumber }) => Math.max(max, sequenceNumber),
      0,
    );
    const plan = {
      count: sessionsStillOwed(
        terms.sessionCount,
        sessions,
        cancelledWithOwnCase(cases, cancellations),
      ),
      firstSequenceNumber: lastNumber + 1,
    };
    const toSchedule: EnrollmentToSchedule = {
      id: enrollmentId,
      teacherUserId: terms.teacherUserId,
      studentUserId: terms.studentUserId,
      snapshotSessionCount: terms.sessionCount,
      snapshotDurationMinutes: terms.durationMinutes,
      snapshotSlotTimezone: terms.timezone as TimeZoneId,
      slot: { dayOfWeek: slot.dayOfWeek, startTimeLocal: slot.startTimeLocal },
    };
    const planned = sessionsFor(toSchedule, now, leadHours, plan);
    await weeksFree(tx, terms, planned, ids);

    // The writes.
    if (!(await enrollments.restore(tx, enrollmentId))) throw refused(log, ids, 'not_restorable');
    // The answer's status is the one the database now holds, read back on this transaction, never a
    // literal: R-HONEST-1's gate counts any object setting `confirmed` off the confirmation path as a
    // write (`tests/pipeline/confirmation-path.spec.ts`; the follow-up under T061, B40).
    const restored = await enrollments.enrollmentFor(tx, enrollmentId);
    if (restored?.status !== 'confirmed') {
      throw new Error('restore: the enrollment, restored under its lock, does not read confirmed');
    }
    try {
      await store.generate(tx, toSchedule, now, leadHours, plan);
    } catch (error: unknown) {
      if (isOverlapRefusal(error)) throw afterWrite(refused(log, ids, 'time_taken'));
      throw error;
    }
    const held = sessions
      .filter(
        ({ remedy }) =>
          remedy?.status === 'refund_case' &&
          remedy.kind === 'makeup' &&
          remedy.caseId === closingCase.caseId,
      )
      .sort((one, other) => ((one.remedy?.id ?? '') < (other.remedy?.id ?? '') ? -1 : 1));
    const offered: Offered[] = [];
    for (const { id } of held) {
      const offer = await offers.offerLocked(tx, id, { restoredCase: closingCase.caseId });
      // The note under T061 (B39 Q5 (a)'s precedent): the offer wrote its warn line; nothing is kept.
      if (offer === null) throw afterWrite(noFreeWeek(log, { ...ids, sessionId: id }));
      offered.push(offer);
    }
    const closed = await store.closeCase(tx, closingCase.caseId, {
      status: 'dismissed',
      resolution: null,
      note: 'restored',
      adminId,
    });
    if (closed === null)
      throw new Error('restore: the closing’s case, open under its lock, did not close');
    // T066: the enrollment restored, to both parties once this transaction commits.
    publisherOn(tx)?.afterCommit([terms.studentUserId, terms.teacherUserId], {
      type: 'enrollment',
      enrollmentId,
    });
    const created = await store.sessionIdsFrom(tx, enrollmentId, plan.firstSequenceNumber);

    for (const offer of offered) offeredLine(log, offer);
    log.info(
      {
        adminId,
        enrollmentId,
        caseId: closingCase.caseId,
        sessionsCreated: planned.length,
        remediesOffered: offered.length,
      },
      'An enrollment was restored',
    );
    return {
      enrollmentId,
      status: restored.status,
      sessionsCreated: planned.map((week) => {
        const sessionId = created.get(week.sequenceNumber);
        if (sessionId === undefined)
          throw new Error('restore: a generated session was not read back');
        return {
          sessionId,
          sequenceNumber: week.sequenceNumber,
          localDate: week.scheduledDateLocal,
          startTimeLocal: week.scheduledStartTimeLocal.slice(0, -SECONDS.length),
          timezone: week.timezone,
          startsAt: new Date(week.scheduledStartAt).toISOString(),
        };
      }),
      remediesOffered: offered.length,
      caseId: closingCase.caseId,
    };
  };

  return {
    restore: async (tx, adminId, { enrollmentId, reason, idempotencyKey }) => {
      const { outcome, replayed } = await idempotency.runOn(
        tx,
        { scope: SCOPE, key: idempotencyKey, actorId: adminId, input: { enrollmentId, reason } },
        (keyed) => restoreLocked(keyed, adminId, enrollmentId, () => clock(keyed)),
      );
      return { answer: outcome, replayed };
    },
    // T073 (Q8 (a)): the core, with no key, audit or limit of its own, for T072's lift.
    restoreClosed: async (tx, adminId, enrollmentId, now) => {
      await restoreLocked(tx, adminId, enrollmentId, async () => now);
      return { restored: true };
    },
  };
}
