// T028 of specs/004-sessions/tasks.md (FR-424, FR-462, FR-463, FR-464, FR-495; research R-311,
// "Offering", "The proposal" and "Frozen"; plan.md decisions 5 and 9; the notes under T028, Q3, Q8,
// Q10, Q11): a remedy's offer and its proposal, the one function an accepted cancellation (T021),
// the sweep (`advance-remedies`) and a cleared suspension's case (T036) call.
//
// WHAT IS OWED (FR-462). A session `teacher_no_show` or `both_no_show` whose dispute window
// (`scheduled_end_at` + `dispute_window_hours`) has closed by the database's clock and that is not
// `disputed` (its status read under the locks), so no resolution or revision inside the window offers
// anything (G1, A2); a `cancelled_by_agreement` session at once (decision 5), and a `postponed` one
// (003:T112, FR-POSTPONE-2); a `cancelled_by_admin`
// session only when T036 says a cleared suspension cancelled it. Only on a `confirmed` enrollment
// (an ended one's sessions are covered by its case, C1), and never while the student's account is
// suspended (C3), nor (T071, N2) while the teacher's is, the enrollment paused (FR-504): the sweep
// offers it on its first run after the reinstatement, either party's. One remedy per
// session (`session_remedies_session_id_key`); a `frozen` one is offered again as a new offer (its
// row rewritten), every other existing one leaves the session as it is.
//
// A RESTORE (T061; research R-322, «The restore»; B40's conflict check, F8). `restoredCase` names the
// closing's case: a remedy it held (`refund_case`, kind `makeup`, `case_id` that case) is owed again
// and offered as a frozen one is at reinstatement, through the same row's re-offer, which clears its
// `case_id` and `decided_at`; a make-up only, as every offer (below). Any other remedy is offered
// nothing then.
//
// THE OFFER. `offered_at` is the database's clock (Q8); `choice_closes_at` = `offered_at` +
// `makeup_choice_window_days`; A (`makeup_counter_answer_hours`) and L (`first_session_lead_hours`)
// snapshot on the row, so a later settings change moves no bound of it. Always `proposed`: a missed
// session is remedied by a make-up only, on both tracks, a Teacher-No-Show's, a cleared suspension's
// and a restored one's alike (T111 of specs/003-booking; SRS DEC-84, FR-MAKEUP-2 and FR-ADMIN-5 as
// amended; ADR 0025 D5). `awaiting_choice` is written no more; rows offered so before keep it, and
// their make-up stays open to them. One `remedy_offered` row.
//
// THE PROPOSAL (H1, F5; Q10: "after its last session" is the last generated). The enrollment's
// weekly slot at its local start in the enrollment's zone (the monitor's reading; Q1 keeps the slot
// from moving while the remedy is open), on the first week after the latest of its sessions and its
// other remedies' proposals whose occurrence starts no earlier than C + A + L, is not taken by
// another enrollment (`EnrollmentSide.slotWeekTaken`) and overlaps no session, reservation (T027) or
// open hold (`EnrollmentSide.heldTimesOf`) of either party. Each week is resolved on its own date by
// `packages/time` (R-TIME-2). Fixed at the offer, never moved. The search reads week by week and
// stops at the first free one, or once the snapshot's count of weeks the slot is taken has been
// passed: no offer now, one warn line `{ sessionId, enrollmentId, reason: 'no_free_week' }`, the next
// run tries again (the decision under T028, a guard against bugs only, amended 2026-11-11: weeks
// other sessions, reservations or holds block are finite and stepped over without counting).
//
// THE LOCKS (contracts/kernel.md, the offer row; `003:T005`'s rules). `offer` takes `users` (both,
// one call), the teacher's `lockKey('teacher-slots')`, `enrollments`, `sessions`, then the session's
// `session_remedies`, and reads the session, its remedy, the enrollment and the student's standing
// (T071: and the teacher's, under the teacher's `users` lock) again under them. `offerLocked` expects its caller to hold them (an accepted cancellation holds
// «cancellation accepted»'s row, the same order). The insert references the session, held.
//
// THE LOG (Q11). An offer is an automatic action: its caller writes one info line
// `{ remedyId, sessionId, enrollmentId, action }` after its commit (`offeredLine`). A session that
// owes nothing yet (inside its window, a suspended student) is a postponement and writes none.
import {
  addDays,
  addHours,
  addMinutes,
  calendarDateOf,
  dateColumnOf,
  type DayOfWeek,
  type LocalDate,
  localDateIn,
  resolveOccurrences,
} from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockKey, lockRows } from '../../platform/db/row-lock.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { readSlot, type SlotRow } from '../catalog/index.js';
import { readStanding } from '../identity/index.js';
import { DISPUTE_WINDOW_SETTING, disputeWindowHours } from './completion.service.js';
import type { EnrollmentSide, EnrollmentTerms } from './enrollment-side.port.js';
import {
  type ExistingRemedy,
  insertRemedy,
  lastReachedDateOf,
  lockRemedyOfSession,
  type OfferedRow,
  type OfferSession,
  offerSessionOf,
  reofferFrozen,
  remedyOfSession,
} from './remedy-offer.repository.js';
import {
  type ReservationReads,
  type ReservedTime,
  reservedTimesOf,
} from './reservations.service.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';
import { partiesSessionsBetween, type SessionTime } from './sessions.repository.js';

/** The days the student has to choose (SRS §3.14, FR-463). */
export const MAKEUP_CHOICE_WINDOW_SETTING = 'makeup_choice_window_days';
/** The hours the teacher has to answer a counter-proposal: A (SRS §3.14, FR-465). */
export const MAKEUP_COUNTER_ANSWER_SETTING = 'makeup_counter_answer_hours';
/** The hours before a first session, and before a make-up: L (SRS §3.14, FR-368). */
export const FIRST_SESSION_LEAD_SETTING = 'first_session_lead_hours';

const positiveWhole = z.int().positive();
const wholeHours = z.int().nonnegative();

/** What an offer reads and writes besides the enrollment side; faked or narrowed in a spec. */
export interface RemedyOfferStore {
  offerSessionOf(tx: Transaction, sessionId: string): Promise<OfferSession | null>;
  remedyOfSession(tx: Transaction, sessionId: string): Promise<ExistingRemedy | null>;
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockRemedyOfSession(tx: Transaction, sessionId: string): Promise<void>;
  studentSuspended(tx: Transaction, userId: string): Promise<boolean>;
  /** T071 (N2): whether the teacher's account is suspended, the enrollment paused (FR-504). */
  teacherSuspended(tx: Transaction, userId: string): Promise<boolean>;
  slotOf(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  lastReachedDateOf(
    tx: Transaction,
    enrollmentId: string,
    exceptSessionId: string,
  ): Promise<Date | null>;
  sessionsBetween(
    tx: Transaction,
    parties: { readonly studentUserId: string; readonly teacherUserId: string },
    window: { readonly from: Date; readonly to: Date },
  ): Promise<readonly SessionTime[]>;
  /** T027's reservations of the people, over the window (no lock). */
  reservedTimesOf(
    tx: Transaction,
    userIds: readonly string[],
    window: { readonly from: Date; readonly to: Date },
    reads: ReservationReads,
  ): Promise<readonly ReservedTime[]>;
  insertRemedy(tx: Transaction, sessionId: string, row: OfferedRow): Promise<string>;
  /** A `frozen` remedy, or with `fromCase` one the closing's case held (T061), offered again. */
  reofferFrozen(
    tx: Transaction,
    remedyId: string,
    row: OfferedRow,
    fromCase?: string,
  ): Promise<boolean>;
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

export const remedyOfferStore: RemedyOfferStore = {
  offerSessionOf,
  remedyOfSession,
  lockAccounts: (tx, ids) => lockRows(tx, 'users', ids),
  lockTeacherSlots: (tx, teacherUserId) => lockKey(tx, 'teacher-slots', teacherUserId),
  lockSessions: (tx, ids) => lockRows(tx, 'sessions', ids),
  lockRemedyOfSession,
  studentSuspended: async (tx, userId) =>
    (await readStanding(tx, userId))?.accountStatus === 'suspended',
  teacherSuspended: async (tx, userId) =>
    (await readStanding(tx, userId))?.accountStatus === 'suspended',
  slotOf: readSlot,
  lastReachedDateOf,
  sessionsBetween: partiesSessionsBetween,
  reservedTimesOf: (tx, userIds, window, reads) => reservedTimesOf(tx, userIds, window, reads),
  insertRemedy,
  reofferFrozen,
  recordEvents: recordSessionEvents,
};

/** What an offer wrote, for its caller's one line after the commit. */
export interface Offered {
  readonly remedyId: string;
  readonly sessionId: string;
  readonly enrollmentId: string;
  readonly status: 'awaiting_choice' | 'proposed';
  /** The proposal's local date in the enrollment's zone. */
  readonly proposedDate: LocalDate;
  /** A `frozen` remedy offered again (R-311, "Frozen"). */
  readonly reoffered: boolean;
}

/** T036's cleared suspension: its cancelled session is owed a make-up (T111: never a refund). */
export interface OfferOptions {
  readonly clearedSuspension?: boolean;
  /** T061: the closing's case a restore closes; the remedy it held is offered again. */
  readonly restoredCase?: string;
}

export interface RemedyOffer {
  /** Takes the offer row's locks, then offers; null when nothing is owed now. */
  offer(tx: Transaction, sessionId: string, options?: OfferOptions): Promise<Offered | null>;
  /** Offers on the caller's transaction, the caller holding the offer row's locks. */
  offerLocked(tx: Transaction, sessionId: string, options?: OfferOptions): Promise<Offered | null>;
}

/** The one info line an offer's caller writes once its transaction has committed (Q11). */
export function offeredLine(log: Pick<Logger, 'info'>, offered: Offered): void {
  log.info(
    {
      remedyId: offered.remedyId,
      sessionId: offered.sessionId,
      enrollmentId: offered.enrollmentId,
      action: offered.reoffered ? 'reoffered' : 'offered',
    },
    'Remedy offered',
  );
}

/** Whether `[startsAt, endsAt)` overlaps one of `times`; each range holds its start, not its end. */
function overlapsAny(
  time: { readonly startsAt: Date; readonly endsAt: Date },
  times: readonly { readonly startsAt: Date; readonly endsAt: Date }[],
): boolean {
  return times.some(({ startsAt, endsAt }) => time.startsAt < endsAt && startsAt < time.endsAt);
}

export interface RemedyOfferDependencies {
  readonly enrollments: Pick<
    EnrollmentSide,
    'enrollmentFor' | 'lockEnrollments' | 'slotWeekTaken' | 'heldTimesOf'
  >;
  readonly settings: SettingsReader;
  /** The database's clock on a transaction (`clockTimestamp`), Q8. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: RemedyOfferStore;
  /**
   * The warn line of a search that found no free week (the decision under T028); the sweep's logger.
   * A caller with none (an acceptance's offer) leaves the session to the sweep, which writes it.
   */
  readonly log?: Pick<Logger, 'warn'>;
}

export function createRemedyOffer({
  enrollments,
  settings,
  clock = clockTimestamp,
  store = remedyOfferStore,
  log,
}: RemedyOfferDependencies): RemedyOffer {
  /** Whether `session` owes a remedy now, its window and status read under the locks. */
  async function owes(session: OfferSession, now: Date, options: OfferOptions): Promise<boolean> {
    // T061: the remedy the closing's case held was owed when it was handed; the restore reopens it.
    if (options.restoredCase !== undefined) return true;
    if (session.status === 'cancelled_by_agreement') return true;
    // 003:T112 (SRS FR-POSTPONE-2, DEC-90): a postponed session at once, as an agreed cancellation.
    if (session.status === 'postponed') return true;
    if (session.status === 'cancelled_by_admin') return options.clearedSuspension === true;
    if (session.status !== 'teacher_no_show' && session.status !== 'both_no_show') return false;
    const hours = await settings.read(DISPUTE_WINDOW_SETTING, disputeWindowHours);
    return new Date(addHours(session.scheduledEndAt, hours)).getTime() <= now.getTime();
  }

  /**
   * The first free week of the enrollment's slot from the latest of its time, at or after `bound`;
   * null once the snapshot's count of weeks the slot is taken has been passed (the decision under
   * T028, amended 2026-11-11: a guard against bugs only, the slot being kept until the package is
   * completed; weeks other sessions, reservations or holds block are stepped over, uncounted).
   */
  async function proposalOf(
    tx: Transaction,
    session: OfferSession,
    terms: EnrollmentTerms,
    bound: Date,
  ): Promise<LocalDate | null> {
    const slot = await store.slotOf(tx, terms.slotId);
    // `enrollments.slot_id` is a foreign key to the slot (ERD `enrollments`).
    if (slot === null) throw new Error('remedy offer: an enrollment without its slot');
    const weekly = {
      // `availability_slots.day_of_week` is 0 to 6 by its check (ERD §15 rule 37).
      dayOfWeek: slot.dayOfWeek as DayOfWeek,
      startTimeLocal: slot.startTimeLocal,
      durationMinutes: terms.durationMinutes,
      timezone: terms.timezone,
    };
    const reached = await store.lastReachedDateOf(tx, session.enrollmentId, session.id);
    const boundDate = localDateIn(bound, terms.timezone);
    const after = reached === null ? null : calendarDateOf(reached);
    // The search starts on the later of the bound's date and the day after the last reached date.
    let from = after !== null && after >= boundDate ? after : boundDate;
    const parties = { studentUserId: session.studentUserId, teacherUserId: session.teacherUserId };
    const people = [session.studentUserId, session.teacherUserId];
    for (let weeks = 0; weeks < terms.sessionCount;) {
      const [occurrence] = resolveOccurrences(weekly, { fromLocalDate: from, count: 1 });
      if (occurrence === undefined) throw new Error('resolveOccurrences answered no occurrence');
      const date = occurrence.requestedLocalDate;
      from = dateAfter(date);
      if (after !== null && date <= after) continue;
      const time = {
        startsAt: new Date(occurrence.startsAt),
        endsAt: new Date(addMinutes(new Date(occurrence.startsAt), terms.durationMinutes)),
      };
      if (time.startsAt.getTime() < bound.getTime()) continue;
      const window = { from: time.startsAt, to: time.endsAt };
      const [taken, own, reserved, held] = await Promise.all([
        enrollments.slotWeekTaken(tx, terms.slotId, date, session.enrollmentId),
        store.sessionsBetween(tx, parties, window),
        store.reservedTimesOf(tx, people, window, enrollments),
        enrollments.heldTimesOf(tx, people, window),
      ]);
      // Only a week the slot is taken counts toward the bound: sessions, reservations and holds are
      // finite, a slot taken on every date is not (the owner's amendment of 2026-11-11 under T028).
      if (taken) {
        weeks += 1;
        continue;
      }
      if (overlapsAny(time, own) || overlapsAny(time, reserved) || overlapsAny(time, held)) {
        continue;
      }
      return date;
    }
    return null;
  }

  async function offerLocked(
    tx: Transaction,
    sessionId: string,
    options: OfferOptions = {},
  ): Promise<Offered | null> {
    const session = await store.offerSessionOf(tx, sessionId);
    if (session === null) return null;
    const existing = await store.remedyOfSession(tx, sessionId);
    if (!offerable(existing, options)) return null;
    const terms = await enrollments.enrollmentFor(tx, session.enrollmentId);
    if (terms?.status !== 'confirmed') return null;
    if (await store.studentSuspended(tx, session.studentUserId)) return null;
    // T071 (N2): a paused enrollment's offer, a frozen remedy's included, waits for the teacher's
    // reinstatement, which offers what the suspension cancelled; the sweep tries again each run.
    if (await store.teacherSuspended(tx, session.teacherUserId)) return null;
    const now = await clock(tx);
    if (!(await owes(session, now, options))) return null;
    const [days, answerHours, leadHours] = await Promise.all([
      settings.read(MAKEUP_CHOICE_WINDOW_SETTING, positiveWhole),
      settings.read(MAKEUP_COUNTER_ANSWER_SETTING, positiveWhole),
      settings.read(FIRST_SESSION_LEAD_SETTING, wholeHours),
    ]);
    const choiceClosesAt = new Date(addDays(now, days));
    const bound = new Date(addHours(choiceClosesAt, answerHours + leadHours));
    const proposedDate = await proposalOf(tx, session, terms, bound);
    if (proposedDate === null) {
      // Nothing written: the next run of `advance-remedies` tries again (the decision under T028).
      log?.warn(
        { sessionId: session.id, enrollmentId: session.enrollmentId, reason: 'no_free_week' },
        'A remedy offer found no free week for its proposal',
      );
      return null;
    }
    const row: OfferedRow = {
      status: 'proposed',
      proposedDate: dateColumnOf(proposedDate),
      offeredAt: now,
      choiceClosesAt,
      snapshotAnswerWindowHours: answerHours,
      snapshotFirstSessionLeadHours: leadHours,
    };
    let remedyId: string;
    if (existing === null) {
      remedyId = await store.insertRemedy(tx, session.id, row);
    } else {
      if (!(await store.reofferFrozen(tx, existing.id, row, options.restoredCase))) return null;
      remedyId = existing.id;
    }
    await store.recordEvents(tx, [
      {
        enrollmentId: session.enrollmentId,
        sessionId: session.id,
        kind: 'remedy_offered',
        occurredAt: now,
      },
    ]);
    return {
      remedyId,
      sessionId: session.id,
      enrollmentId: session.enrollmentId,
      status: row.status,
      proposedDate,
      reoffered: existing !== null,
    };
  }

  return {
    offerLocked,
    offer: async (tx, sessionId, options = {}) => {
      const seen = await store.offerSessionOf(tx, sessionId);
      if (seen === null) return null;
      // A read with no lock first: a session of an enrollment no longer confirmed owes nothing
      // here (its case covers it, C1), so the sweep takes no lock for it; decided again below.
      if ((await enrollments.enrollmentFor(tx, seen.enrollmentId))?.status !== 'confirmed') {
        return null;
      }
      await store.lockAccounts(tx, [seen.studentUserId, seen.teacherUserId].sort());
      await store.lockTeacherSlots(tx, seen.teacherUserId);
      await enrollments.lockEnrollments(tx, [seen.enrollmentId]);
      await store.lockSessions(tx, [seen.id]);
      await store.lockRemedyOfSession(tx, seen.id);
      return offerLocked(tx, sessionId, options);
    },
  };
}

/**
 * Whether the session's remedy, if any, may be offered now: none or `frozen` (R-311), or with
 * `restoredCase` (T061) only a make-up that case holds (`refund_case`, kind `makeup`).
 */
function offerable(
  existing: {
    readonly status: string;
    readonly kind: string;
    readonly caseId: string | null;
  } | null,
  { restoredCase }: OfferOptions,
): boolean {
  if (restoredCase !== undefined) {
    return (
      existing !== null &&
      existing.status === 'refund_case' &&
      existing.kind === 'makeup' &&
      existing.caseId === restoredCase
    );
  }
  return existing === null || existing.status === 'frozen';
}

/** The local date after `date`: a step on the wall calendar (R-TIME-2). */
function dateAfter(date: LocalDate): LocalDate {
  return calendarDateOf(new Date(addDays(dateColumnOf(date), 1)));
}
