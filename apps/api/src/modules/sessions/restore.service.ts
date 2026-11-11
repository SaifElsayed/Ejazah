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
// accounts first. Every row written references only rows held.
//
// WHAT IS REFUSED (R-322's steps, in order), each `RESTORE_REFUSED` with `details.cause`, writing
// nothing: (1) the closing — `terminated_no_show` whose latest end case is an open
// `absence_termination`, or `cancelled` with `admin` (its last cancellation's reason) whose latest end
// case is an open `student_fault_confirmed`; any other `not_restorable` (a ban's `student_banned`
// case, a deletion, a teacher's end, a completion, an enrollment not closed), a closed case
// `case_closed`; (2) the window, the case's `created_at` plus `enrollment_restore_window_days`
// (`restore-window.ts`, the monitor's `restorableUntil`) against the database's clock,
// `window_closed`; (3) both accounts `active` and the teacher's approval standing, as the join reads
// them (FR-432), else `party_restricted`; (5, 6) the slot deactivated `slot_inactive`, then, before the
// weeks, the slot's weekday, local start or zone differing from the enrollment's lowest-numbered
// session that is not a make-up and its `snapshot_slot_timezone`, `slot_changed` (a length change
// alone is not); then each week the restore would fill, the slot taken by another student's hold or
// enrollment `slot_taken`, an occurrence overlapping a session, an open hold or a reservation of
// either party `time_taken`, and the database's exclusion refusing the insert `time_taken`. A
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
// its original's remedy `booked`, is among the K, so no session is owed twice.
//
// THE WRITES, in the same transaction: `EnrollmentSide.restore` (`confirmed`, the reason cleared,
// `confirmed_at` untouched, one `restored` event); the K sessions through T034's generation widened
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
  type CaseRecord,
  caseRecordOf,
  closeCase,
  latestCaseOf,
} from '../moderation/index.js';
import { END_REASONS } from './case-queue.service.js';
import type {
  EnrollmentEventEntry,
  EnrollmentSide,
  EnrollmentStatus,
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
import { type RestoreSession, restoreSessionsOf, sessionIdsFrom } from './restore.repository.js';
import { ENROLLMENT_RESTORE_WINDOW_SETTING, restorableUntil } from './restore-window.js';
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
  /** Moderation's: the enrollment's latest case of an end's reason (`END_REASONS`); null for none. */
  endCaseOf(tx: Transaction, enrollmentId: string): Promise<string | null>;
  caseRecordOf(tx: Transaction, caseId: string): Promise<CaseRecord | null>;
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
  endCaseOf: (tx, enrollmentId) => latestCaseOf(tx, enrollmentId, [...END_REASONS]),
  caseRecordOf,
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
    'enrollmentFor' | 'lockEnrollments' | 'eventsOf' | 'restore' | 'slotWeekTaken' | 'heldTimesOf'
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
}

export interface Restore {
  /** `sessions.restore` on the administrator call's transaction (this file's head). */
  restore(
    tx: Transaction,
    adminId: string,
    input: SessionsRestoreInput,
  ): Promise<{ readonly answer: SessionsRestoreOutput; readonly replayed: boolean }>;
}

/** The eight causes (R-322, steps 1 to 6). */
type RestoreCause =
  | 'not_restorable'
  | 'window_closed'
  | 'case_closed'
  | 'party_restricted'
  | 'slot_inactive'
  | 'slot_changed'
  | 'slot_taken'
  | 'time_taken';

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
const positiveWhole = z.int().positive();
const wholeHours = z.int().nonnegative();

const CONSUMED: ReadonlySet<string> = new Set(['done', 'student_no_show']);
const UNSETTLED: ReadonlySet<string> = new Set(['disputed', 'under_threshold', 'provider_outage']);
const OWING: ReadonlySet<string> = new Set([
  'teacher_no_show',
  'both_no_show',
  'cancelled_by_agreement',
]);

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/** The case whose closing a restore reverses, by the enrollment's status and last cancellation. */
function closingReasonOf(
  status: EnrollmentStatus,
  events: readonly EnrollmentEventEntry[],
): 'absence_termination' | 'student_fault_confirmed' | undefined {
  if (status === 'terminated_no_show') return 'absence_termination';
  if (status !== 'cancelled') return undefined;
  const last = events.filter(({ kind }) => kind === 'cancelled').at(-1);
  return last?.cancellationReason === 'admin' ? 'student_fault_confirmed' : undefined;
}

/** K: the sessions still owed and not settling on their own path (this file's head). */
function sessionsStillOwed(sessionCount: number, sessions: readonly RestoreSession[]): number {
  const taken = sessions.filter(
    ({ status, remedy }) =>
      CONSUMED.has(status) ||
      UNSETTLED.has(status) ||
      remedy?.status === 'refund_case' ||
      (OWING.has(status) && remedy === null),
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
    const [own, held, reserved] = await Promise.all([
      store.sessionsBetween(tx, parties, window),
      enrollments.heldTimesOf(tx, people, window),
      store.reservedTimesOf(tx, people, window, enrollments),
    ]);
    const taken = [...own, ...held, ...reserved];
    for (const week of planned) {
      const time = {
        startsAt: new Date(week.scheduledStartAt),
        endsAt: new Date(week.scheduledEndAt),
      };
      if (overlapsAny(time, taken)) throw refused(log, ids, 'time_taken');
    }
  };

  const restoreLocked = async (
    tx: Transaction,
    adminId: string,
    enrollmentId: string,
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
    const [sessions, events] = await Promise.all([
      store.sessionsOf(tx, enrollmentId),
      enrollments.eventsOf(tx, enrollmentId),
    ]);
    // Step 1: the closing and its case.
    const closing = closingReasonOf(terms.status, events);
    if (closing === undefined) throw refused(log, ids, 'not_restorable');
    const caseId = await store.endCaseOf(tx, enrollmentId);
    const closingCase = caseId === null ? null : await store.caseRecordOf(tx, caseId);
    if (closingCase === null || closingCase.reason !== closing) {
      throw refused(log, ids, 'not_restorable');
    }
    if (closingCase.status !== 'open') throw refused(log, ids, 'case_closed');
    // Step 2: the window, against the database's clock.
    const [now, windowDays, leadHours] = await Promise.all([
      clock(tx),
      settings.read(ENROLLMENT_RESTORE_WINDOW_SETTING, positiveWhole),
      settings.read(FIRST_SESSION_LEAD_SETTING, wholeHours),
    ]);
    if (now.getTime() >= restorableUntil(closingCase.createdAt, windowDays).getTime()) {
      throw refused(log, ids, 'window_closed');
    }
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
      count: sessionsStillOwed(terms.sessionCount, sessions),
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
      if (isOverlapRefusal(error)) throw refused(log, ids, 'time_taken');
      throw error;
    }
    const held = sessions
      .filter(
        ({ remedy }) =>
          remedy?.status === 'refund_case' && remedy.kind === 'makeup' && remedy.caseId === caseId,
      )
      .sort((one, other) => ((one.remedy?.id ?? '') < (other.remedy?.id ?? '') ? -1 : 1));
    const offered: Offered[] = [];
    for (const { id } of held) {
      const offer = await offers.offerLocked(tx, id, { restoredCase: closingCase.caseId });
      // The note under T061 (B39 Q5 (a)'s precedent): the offer wrote its warn line; nothing is kept.
      if (offer === null) throw noFreeWeek(log, { ...ids, sessionId: id });
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
        (keyed) => restoreLocked(keyed, adminId, enrollmentId),
      );
      return { answer: outcome, replayed };
    },
  };
}
