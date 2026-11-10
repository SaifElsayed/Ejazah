// T031 and T032 of specs/004-sessions/tasks.md: the student's choice, the teacher's answer and the
// windows' ends (FR-463 to FR-469, FR-495; research R-311, "The student", "The teacher", "Windows
// ending" and "Booking a make-up"; plan.md decisions 9 and 14 (i); contracts/app-surface.md,
// "`sessions.remedy`"; the notes under T031 (Q5 (a), Q9 (a), Q14 (a)), T032 (Q4 (a), Q11 (a)), T029
// (Q4 (a)) and T028 (Q8 (a), Q11 (a))).
//
// WHO MAY ASK (contracts/README.md, «Callers»; R-GENDER-2). The caller's own id finds the session
// with its party; `choose`, `accept`, `counterOptions` and `counter` are the student's and
// `answerCounter` the teacher's, so a stranger, an id that never existed and the other party answer
// one `NOT_FOUND`, and so does a caller whose counterparty is of the other gender by the server's
// records (R-GENDER-4), checked before any remedy is read, so no refusal tells a forbidden session
// from a nonexistent one.
//
// THE REFUSALS, in order, each one info line of ids and a reason code and nothing written (the
// owner's rule, Q11 (a)): `NOT_FOUND`; a session with no remedy, or one `frozen`, `booked`,
// `refund_case` or `lapsed`, `REMEDY_NOT_OPEN` («a `frozen` remedy answers `REMEDY_NOT_OPEN` to every
// procedure here»); then each procedure's own:
//   - `choose` (`awaiting_choice` only): from `choice_closes_at` `REMEDY_NOT_OPEN` (Q9 (a)); a remedy
//     no longer awaiting a choice `CHOICE_NOT_ALLOWED`; a refund where none is owed (any track but
//     recitation, or a session neither a Teacher-No-Show nor one a cleared suspension cancelled, A1)
//     `CHOICE_NOT_ALLOWED`. A make-up: `awaiting_choice` → `proposed`, no event row (no kind records
//     it). A refund: T030's hand-off, `refund_choice`, on this transaction.
//   - `accept`: from `awaiting_choice`, `proposed` or `counter_proposed`, before or after
//     `choice_closes_at` (Q9 (a): it books the proposal the sweep books). A pending counter is
//     withdrawn: one `counter_withdrawn` row, then T029 books the proposal, whose booking clears the
//     counter's columns and so releases its time (H3). The database's refusal is T029's
//     `MAKEUP_REFUSED`, the remedy left open.
//   - `counterOptions` and `counter`: from `choice_closes_at` `REMEDY_NOT_OPEN`; a pending counter
//     `COUNTER_PENDING` (one at a time); `counter` names one of the options as they are read under
//     its locks, else `SLOT_NOT_OFFERED`. The options are read with no lock (a preview the counter
//     decides again).
//   - `answerCounter` (T032): no counter pending, or one whose answer window has closed by the
//     database's clock (`answerClosesAt`, D1, the remedy's own A), `REMEDY_NOT_OPEN`.
//
// THE OPTIONS (H2, H4; Q5 (a)). Per active slot of the teacher of the session's length (catalog's
// entry), its first occurrence at or after max(now + A + L, `choice_closes_at`), A and L the remedy's
// own snapshots, never the live settings, that overlaps no session, open hold
// (`EnrollmentSide.heldTimesOf`) or reservation (T027, the remedy's own proposal among them, so the
// proposal is never an option) of either party; each resolved on its own date in the slot's own zone
// by `packages/time` (R-TIME-2, `003:T077`). The search ends: what can make a week busy is finite.
//
// WHAT A COUNTER WRITES. The five `counter_*` columns (the slot, its local date and start, the slot's
// zone, `counter_proposed_at` the database's clock), `counter_proposed`, and one `counter_proposed`
// row carrying the slot, date, start and zone. The answer window's close is never stored:
// `answerClosesAt` (D1) computes it when read. The proposal never moves (H1).
//
// THE TEACHER'S ANSWER (T032; decision 9; A3, A1, A7; Q4 (a)). Accept: one `counter_accepted` row and
// T029 books the counter (`sessions.remedy.answerCounter`). A booking the database refuses (an
// exclusion it names, `sessions_teacher_no_overlap` or `sessions_student_no_overlap`) answers T029's
// `MAKEUP_REFUSED` and, in a second transaction under the same locks, releases the counter as a
// decline does: its columns cleared, `proposed`, one `counter_booking_refused` row (never
// `counter_withdrawn`), and one warn line `{ sessionId, enrollmentId, constraint }` and nothing else;
// so the sweep never reads it as unanswered. A reserved time or a second deadlock refuses with the
// counter left pending, the teacher free to answer again before its window closes (Q4 (a)). Decline:
// the counter released, `proposed`, one `counter_declined` row. After either release, once the
// choice window has closed, the proposal is booked in a transaction of its own (T029's `book`); its
// refusal leaves the remedy `proposed` past `choice_closes_at`, which the sweep books or retries
// (H5), and the teacher's decline is answered all the same.
//
// THE WINDOWS' ENDS (T032; `advance-remedies`, `remedy-offer.sweep.ts`; H3, H5; A3; Q4 (a), Q11 (a)),
// each remedy on its own transaction, decided again under its locks at the database's clock:
//   - `endAnswerWindow`: a `counter_proposed` remedy whose `answerClosesAt` has come is handed to a
//     `counter_unanswered` case (T030), the choice window open or closed; one info line after the
//     commit (`logRemedyHandedOff`).
//   - `bookAtChoiceEnd`: a `proposed` or `awaiting_choice` remedy past `choice_closes_at` (none
//     pending, by its status) has its proposal booked (H5) through `runRetryingDeadlockOnce` as
//     `advance-remedies` (Q4 (a)), one info line `{ remedyId, sessionId, enrollmentId, action }`
//     after the commit. Under the booking's locks it reads the open holds of both parties
//     (`heldTimesOf`) over the proposal, an overlap a refusal; T029 reads the reservations again and
//     the database its exclusions. Each refusal is one warn line `{ remedyId, sessionId, constraint }`
//     and nothing more: the constraint the database named, or `hold` or `reservation`. A second
//     deadlock is no refusal: the next run tries again. Retried while the proposal starts at least L
//     after the run's instant (`bookingRetriedUntil`, the remedy's own L); once it would start within
//     L, handed to a `makeup_refused` case (T030, `kind` left `makeup`), one info line and one
//     report to error tracking, the only one for that remedy.
//
// THE LOCKS (contracts/kernel.md; `003:T005`'s rules; Phase 3's general rule). `choose`, `counter`,
// a decline and the answer window's end take the rows «remedy offer … a counter-proposal, its
// decline» / «`sessions.remedy.choose` … a counter left unanswered»: `users` (both, one call, id
// order), the teacher's `lockKey('teacher-slots')`, the enrollment, the session, the session's
// remedy, and a hand-off's `disputes` after them (T030). `accept`, a counter's acceptance, its release
// and the choice window's end take «make-up booking»'s: the same with the slots after the key and
// before the enrollment (the enrollment's own, and for a counter the counter's, read under the
// accounts and the key, in one call, id order, L2), so T029's `bookOn`, which takes them again, waits
// on nothing it does not hold. Every decision is read again under the locks, the database's clock
// after them (Q8 (a)). A counter's `counter_slot_id` key-shares the teacher's slot while the session
// is held, which kernel.md shows safe (L2 of the sixth analysis).
import {
  type CounterOption,
  type RemedyView,
  type SessionsRemedyAcceptInput,
  type SessionsRemedyAcceptOutput,
  type SessionsRemedyAnswerCounterInput,
  type SessionsRemedyAnswerCounterOutput,
  type SessionsRemedyChooseInput,
  type SessionsRemedyChooseOutput,
  type SessionsRemedyCounterInput,
  type SessionsRemedyCounterOptionsInput,
  type SessionsRemedyCounterOptionsOutput,
  type SessionsRemedyCounterOutput,
  sessionsRemedyCounterOutput,
} from '@ijazah/contracts';
import {
  addDays,
  addHours,
  addMinutes,
  calendarDateOf,
  dateColumnOf,
  type DayOfWeek,
  type LocalDate,
  localDateIn,
  type Occurrence,
  resolveLocalDateTime,
  resolveOccurrences,
  timeColumnOf,
} from '@ijazah/time';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError, type ErrorCode } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import { reportError } from '../../platform/errors/reporting.js';
import type {
  IdempotencyService,
  JsonValue,
} from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import { readSlot, type SlotRow, teacherSlotsOf } from '../catalog/index.js';
import { sessionPartiesOf } from '../identity/index.js';
import type { EnrollmentSide, EnrollmentTerms } from './enrollment-side.port.js';
import { lockSlots } from './makeup-booking.repository.js';
import {
  createMakeupBooking,
  type MakeupBooking,
  type MakeupOperation,
  type MakeupRefusal,
  makeupRefusalOf,
} from './makeup-booking.service.js';
import { lockSessions, lockTeacherSlots } from './remedy-case.repository.js';
import { createRemedyCase, logRemedyHandedOff, type RemedyCase } from './remedy-case.service.js';
import { answerClosesAt, bookingRetriedUntil } from './remedy-deadlines.js';
import {
  lockRemedyOfSession,
  type RemedyRowStatus,
  type RemedyViewRow,
  remedyViewRowOf,
} from './remedy-offer.repository.js';
import { remedyViewOf } from './remedy-offer.view.js';
import {
  chooseMakeup,
  type CounterWrite,
  releaseCounter,
  type RemedyRow,
  remedyRowById,
  remedyRowOf,
  type RemedyWithParties,
  writeCounter,
} from './remedy.repository.js';
import {
  type ReservationReads,
  type ReservedTime,
  reservedTimesOf,
} from './reservations.service.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';
import {
  lockSessionParties,
  partiesSessionsBetween,
  type PartySessionRow,
  type SessionTime,
  sessionOfParty,
} from './sessions.repository.js';

/** What the procedures and the windows read, lock and write, on the caller's transaction; faked in a spec. */
export interface RemedyStore {
  /** The session when `userId` is one of its two parties, else null; no lock. */
  sessionOfParty(
    tx: Transaction,
    sessionId: string,
    userId: string,
  ): Promise<PartySessionRow | null>;
  /** The live accounts' genders from identity's records; a deleted one is absent. */
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly gender: 'male' | 'female' }>>;
  /** The session's remedy; no lock. */
  remedyOf(tx: Transaction, sessionId: string): Promise<RemedyRow | null>;
  /** The remedy by its id, with its session's parties; no lock (T032's windows). */
  remedyById(tx: Transaction, remedyId: string): Promise<RemedyWithParties | null>;
  /** Both accounts, `FOR UPDATE`, in one call. */
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  /** The teacher's `lockKey('teacher-slots')`. */
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  /** The slots, `FOR UPDATE`, in one call in id order. */
  lockSlots(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** The session's remedy row, `FOR UPDATE`. */
  lockRemedyOfSession(tx: Transaction, sessionId: string): Promise<void>;
  /** A slot through catalog's entry (R-API-6). */
  slotOf(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  /** Every slot of the teacher, active or not, through catalog's entry. */
  teacherSlotsOf(tx: Transaction, teacherUserId: string): Promise<readonly SlotRow[]>;
  /** The parties' sessions holding time in the window. */
  sessionsBetween(
    tx: Transaction,
    parties: { readonly studentUserId: string; readonly teacherUserId: string },
    window: { readonly from: Date; readonly to: Date },
  ): Promise<readonly SessionTime[]>;
  /** T027's reserved times of the people over the window. */
  reservedTimesOf(
    tx: Transaction,
    userIds: readonly string[],
    window: { readonly from: Date; readonly to: Date },
    reads: ReservationReads,
  ): Promise<readonly ReservedTime[]>;
  /** The conditional writes; each answers whether it moved the row. */
  chooseMakeup(tx: Transaction, remedyId: string): Promise<boolean>;
  writeCounter(tx: Transaction, remedyId: string, counter: CounterWrite): Promise<boolean>;
  releaseCounter(tx: Transaction, remedyId: string): Promise<boolean>;
  /** T004's writer of `session_events` rows. */
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
  /** The remedy as `sessions.get` shows it, with its make-up. */
  viewRowOf(tx: Transaction, sessionId: string): Promise<RemedyViewRow | null>;
}

/** The store over sessions' tables, the kernel's locks and catalog's and identity's entries. */
export const remedyStore: RemedyStore = {
  sessionOfParty,
  partiesOf: sessionPartiesOf,
  remedyOf: remedyRowOf,
  remedyById: remedyRowById,
  lockAccounts: lockSessionParties,
  lockTeacherSlots,
  lockSlots,
  lockSessions,
  lockRemedyOfSession,
  slotOf: readSlot,
  teacherSlotsOf,
  sessionsBetween: partiesSessionsBetween,
  reservedTimesOf: (tx, userIds, window, reads) => reservedTimesOf(tx, userIds, window, reads),
  chooseMakeup,
  writeCounter,
  releaseCounter,
  recordEvents: recordSessionEvents,
  viewRowOf: remedyViewRowOf,
};

/** The person asking, from the server-held session. */
export interface RemedyCaller {
  readonly userId: string;
}

/** `sessions.remedy`: the student's four (T031) and the teacher's answer (T032). */
export interface RemedyServices {
  choose(
    caller: RemedyCaller,
    input: SessionsRemedyChooseInput,
    log: Logger,
  ): Promise<SessionsRemedyChooseOutput>;
  accept(
    caller: RemedyCaller,
    input: SessionsRemedyAcceptInput,
    log: Logger,
  ): Promise<SessionsRemedyAcceptOutput>;
  counterOptions(
    caller: RemedyCaller,
    input: SessionsRemedyCounterOptionsInput,
    log: Logger,
  ): Promise<SessionsRemedyCounterOptionsOutput>;
  counter(
    caller: RemedyCaller,
    input: SessionsRemedyCounterInput,
    log: Logger,
  ): Promise<SessionsRemedyCounterOutput>;
  answerCounter(
    caller: RemedyCaller,
    input: SessionsRemedyAnswerCounterInput,
    log: Logger,
  ): Promise<SessionsRemedyAnswerCounterOutput>;
}

/** The booking's three entries a path uses (T029). */
export type RemedyBooking = Pick<MakeupBooking, 'bookOn' | 'run' | 'book'>;

export interface RemedyDependencies {
  readonly transactions: Transactions;
  /** The kernel's idempotency, which keys `sessions.remedy.counter` (Q14 (a)). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentFor' | 'lockEnrollments' | 'heldTimesOf'>;
  /** The database's clock on a transaction (Q8 (a)). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: RemedyStore;
  /** T029's booking over a call's log; `createMakeupBooking` unless a spec fakes it. */
  readonly bookingOf?: (log: Logger) => RemedyBooking;
  /** T030's hand-off over a call's log; `createRemedyCase` unless a spec fakes it. */
  readonly casesOf?: (log: Logger) => Pick<RemedyCase, 'handOff'>;
  /** What refused a booking (T029's `makeupRefusalOf`), unless a spec reads its own fakes. */
  readonly makeupRefusalOf?: (error: unknown) => MakeupRefusal | null;
}

/** Why a procedure was refused, as its one log line names it. */
type RefusalReason =
  | 'not_a_party'
  | 'not_the_student'
  | 'not_the_teacher'
  | 'gender_differs'
  | 'no_remedy'
  | 'not_open'
  | 'choice_closed'
  | 'not_awaiting_choice'
  | 'refund_not_owed'
  | 'counter_pending'
  | 'not_offered'
  | 'no_counter'
  | 'answer_closed';

interface RefusalIds {
  readonly sessionId: string;
  readonly userId: string;
  readonly remedyId?: string;
}

/**
 * Logs the refusal with ids and its reason only, and answers the error to throw, marked «logged»
 * so `onError` writes no second line (PR #130's review, round 1, Minor 4).
 */
function refusal(
  log: Logger,
  ids: RefusalIds,
  errorCode: ErrorCode,
  reason: RefusalReason,
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A remedy procedure was refused');
  return markRefusalLogged(new DomainError(errorCode));
}

const COUNTER_SCOPE = 'sessions.remedy.counter';
const ACCEPT: MakeupOperation = 'sessions.remedy.accept';
const ANSWER: MakeupOperation = 'sessions.remedy.answerCounter';
const SWEEP: MakeupOperation = 'advance-remedies';

/** The open states (data-model.md §3) but `frozen`, which accepts nothing. */
const ACTIVE: readonly RemedyRowStatus[] = ['awaiting_choice', 'proposed', 'counter_proposed'];
/** The states whose proposal H5 books once the choice window has closed (none pending). */
const BOOKED_AT_CHOICE_END: readonly RemedyRowStatus[] = ['proposed', 'awaiting_choice'];

/** The seconds a `time` column's local time carries, which the contract's `HH:MM` leaves out. */
const SECONDS = ':00';

/** The local date after `date`: a step on the wall calendar (R-TIME-2). */
function dateAfter(date: LocalDate): LocalDate {
  return calendarDateOf(new Date(addDays(dateColumnOf(date), 1)));
}

/** Whether `[startsAt, endsAt)` overlaps one of `times`; each range holds its start, not its end. */
function overlapsAny(
  time: { readonly startsAt: Date; readonly endsAt: Date },
  times: readonly { readonly startsAt: Date; readonly endsAt: Date }[],
): boolean {
  return times.some(({ startsAt, endsAt }) => time.startsAt < endsAt && startsAt < time.endsAt);
}

/** One slot's candidate occurrence. */
interface Candidate {
  readonly slot: SlotRow;
  readonly occurrence: Occurrence;
}

/** The slot's first occurrence on or after `from`, in its own zone (R-TIME-2). */
function occurrenceFrom(slot: SlotRow, from: LocalDate): Occurrence {
  const [occurrence] = resolveOccurrences(
    {
      // `availability_slots.day_of_week` is 0 to 6 by its check (ERD §15 rule 37).
      dayOfWeek: slot.dayOfWeek as DayOfWeek,
      startTimeLocal: slot.startTimeLocal,
      durationMinutes: slot.durationMinutes,
      timezone: slot.timezone,
    },
    { fromLocalDate: from, count: 1 },
  );
  if (occurrence === undefined) throw new Error('resolveOccurrences answered no occurrence');
  return occurrence;
}

/** The slot's first occurrence starting at or after `bound`. */
function firstAtOrAfter(slot: SlotRow, bound: Date): Occurrence {
  let occurrence = occurrenceFrom(slot, localDateIn(bound, slot.timezone));
  while (new Date(occurrence.startsAt).getTime() < bound.getTime()) {
    occurrence = occurrenceFrom(slot, dateAfter(occurrence.requestedLocalDate));
  }
  return occurrence;
}

const timeOf = (occurrence: Occurrence) => ({
  startsAt: new Date(occurrence.startsAt),
  endsAt: new Date(occurrence.endsAt),
});

/** An option as the contract shows it. */
function optionOf({ slot, occurrence }: Candidate): CounterOption {
  return {
    slotId: slot.id,
    localDate: occurrence.requestedLocalDate,
    startTimeLocal: occurrence.requestedStartTimeLocal.slice(0, -SECONDS.length),
    timezone: slot.timezone,
    startsAt: occurrence.startsAt,
  };
}

/** Whether a refund may be chosen on this session's remedy (A1; T036). */
function refundOwed(session: PartySessionRow, terms: EnrollmentTerms): boolean {
  return (
    terms.track === 'recitation' &&
    (session.status === 'teacher_no_show' || session.status === 'cancelled_by_admin')
  );
}

/** Which slots a path locks after the key (this file's head, THE LOCKS). */
type SlotLocks = 'none' | 'own' | 'own_and_counter';

/** A session's id, enrollment and parties, as the locks need them. */
interface Lockable {
  readonly sessionId: string;
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
}

/** The locks of a remedy's paths, in kernel.md's one order (this file's head, THE LOCKS). */
function lockerOver(
  store: RemedyStore,
  enrollments: Pick<EnrollmentSide, 'enrollmentFor' | 'lockEnrollments'>,
) {
  return async (tx: Transaction, seen: Lockable, slots: SlotLocks): Promise<void> => {
    await store.lockAccounts(tx, [seen.studentUserId, seen.teacherUserId].sort());
    await store.lockTeacherSlots(tx, seen.teacherUserId);
    if (slots !== 'none') {
      const terms = await enrollments.enrollmentFor(tx, seen.enrollmentId);
      // `sessions.enrollment_id` is a foreign key to the enrollment (ERD `sessions`).
      if (terms === null) throw new Error('sessions: a session without its enrollment');
      const ids = [terms.slotId];
      if (slots === 'own_and_counter') {
        // Read under the accounts and the key: no counter is written or withdrawn meanwhile.
        const counter = (await store.remedyOf(tx, seen.sessionId))?.counter;
        if (counter !== undefined && counter !== null) ids.push(counter.slotId);
      }
      await store.lockSlots(tx, [...new Set(ids)].sort());
    }
    await enrollments.lockEnrollments(tx, [seen.enrollmentId]);
    await store.lockSessions(tx, [seen.sessionId]);
    await store.lockRemedyOfSession(tx, seen.sessionId);
  };
}

/** The proposal's time: its date at the enrollment's slot's local start, in the enrollment's zone. */
function proposalTime(
  proposedDate: Date,
  slot: SlotRow,
  terms: EnrollmentTerms,
): { readonly startsAt: Date; readonly endsAt: Date } {
  const startsAt = new Date(
    resolveLocalDateTime({
      localDate: calendarDateOf(proposedDate),
      localTime: slot.startTimeLocal,
      timezone: terms.timezone,
    }).startsAt,
  );
  return { startsAt, endsAt: new Date(addMinutes(startsAt, terms.durationMinutes)) };
}

/** Whether `error` is a refusal another path's state explains, already logged by T029. */
function leftForTheSweep(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    (error.code === 'MAKEUP_REFUSED' || error.code === 'REMEDY_NOT_OPEN')
  );
}

export function createRemedyServices({
  transactions,
  idempotency,
  enrollments,
  clock = clockTimestamp,
  store = remedyStore,
  bookingOf = (log) => createMakeupBooking({ transactions, enrollments, log, clock }),
  casesOf = (log) => createRemedyCase({ log, clock }),
  makeupRefusalOf: refusalOf = makeupRefusalOf,
}: RemedyDependencies): RemedyServices {
  const lockRemedy = lockerOver(store, enrollments);

  /** The session of `userId` as its `role`, else `NOT_FOUND` (this file's head). */
  async function partysSession(
    tx: Transaction,
    sessionId: string,
    userId: string,
    role: 'student' | 'teacher',
    log: Logger,
  ): Promise<PartySessionRow> {
    const ids = { sessionId, userId };
    const session = await store.sessionOfParty(tx, sessionId, userId);
    if (session === null) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
    const [own, other] =
      role === 'student'
        ? [session.studentUserId, session.teacherUserId]
        : [session.teacherUserId, session.studentUserId];
    if (own !== userId) {
      throw refusal(
        log,
        ids,
        'NOT_FOUND',
        role === 'student' ? 'not_the_student' : 'not_the_teacher',
      );
    }
    const parties = await store.partiesOf(tx, [own, other].sort());
    const ownParty = parties.get(own);
    const otherParty = parties.get(other);
    if (ownParty === undefined) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
    if (otherParty !== undefined && otherParty.gender !== ownParty.gender) {
      throw refusal(log, ids, 'NOT_FOUND', 'gender_differs');
    }
    return session;
  }

  async function termsOf(tx: Transaction, session: PartySessionRow): Promise<EnrollmentTerms> {
    const terms = await enrollments.enrollmentFor(tx, session.enrollmentId);
    // `sessions.enrollment_id` is a foreign key to the enrollment (ERD `sessions`).
    if (terms === null) throw new Error('sessions: a session without its enrollment');
    return terms;
  }

  /**
   * The party's session under the locks `slots` names (this file's head), read again under them,
   * its remedy, its enrollment's terms and the database's clock read after them.
   */
  async function decided(
    tx: Transaction,
    sessionId: string,
    userId: string,
    role: 'student' | 'teacher',
    log: Logger,
    slots: SlotLocks,
  ) {
    const seen = await partysSession(tx, sessionId, userId, role, log);
    await lockRemedy(tx, { ...seen, sessionId: seen.id }, slots);
    const session = await partysSession(tx, sessionId, userId, role, log);
    const terms = await termsOf(tx, session);
    const remedy = await store.remedyOf(tx, session.id);
    return { session, terms, remedy, now: await clock(tx) };
  }

  /**
   * The remedy's id, read with no lock for the booking's deadlock lines (L5) once the caller is
   * checked, so no refusal here tells a forbidden session from a nonexistent one.
   */
  async function remedyIdOf(
    sessionId: string,
    userId: string,
    role: 'student' | 'teacher',
    log: Logger,
  ): Promise<string> {
    const remedyId = await transactions.run(async (tx) => {
      const seen = await partysSession(tx, sessionId, userId, role, log);
      return (await store.remedyOf(tx, seen.id))?.id;
    });
    if (remedyId === undefined) {
      throw refusal(log, { sessionId, userId }, 'REMEDY_NOT_OPEN', 'no_remedy');
    }
    return remedyId;
  }

  /** The remedy, if it accepts anything; else `REMEDY_NOT_OPEN` (this file's head). */
  function activeRemedy(remedy: RemedyRow | null, ids: RefusalIds, log: Logger): RemedyRow {
    if (remedy === null) throw refusal(log, ids, 'REMEDY_NOT_OPEN', 'no_remedy');
    if (!ACTIVE.includes(remedy.status)) {
      throw refusal(log, { ...ids, remedyId: remedy.id }, 'REMEDY_NOT_OPEN', 'not_open');
    }
    return remedy;
  }

  /** The remedy, if a counter may be read or written now (`counterOptions`, `counter`). */
  function counterable(
    remedy: RemedyRow | null,
    now: Date,
    ids: RefusalIds,
    log: Logger,
  ): RemedyRow {
    const active = activeRemedy(remedy, ids, log);
    const named = { ...ids, remedyId: active.id };
    if (now.getTime() >= active.choiceClosesAt.getTime()) {
      throw refusal(log, named, 'REMEDY_NOT_OPEN', 'choice_closed');
    }
    if (active.status === 'counter_proposed') {
      throw refusal(log, named, 'COUNTER_PENDING', 'counter_pending');
    }
    return active;
  }

  /** The remedy, if its counter may be answered now (D1); else `REMEDY_NOT_OPEN`. */
  function answerable(
    remedy: RemedyRow | null,
    now: Date,
    ids: RefusalIds,
    log: Logger,
  ): RemedyRow {
    const active = activeRemedy(remedy, ids, log);
    const named = { ...ids, remedyId: active.id };
    const { counter } = active;
    if (active.status !== 'counter_proposed' || counter === null) {
      throw refusal(log, named, 'REMEDY_NOT_OPEN', 'no_counter');
    }
    const closes = answerClosesAt({
      counterProposedAt: counter.proposedAt,
      snapshotAnswerWindowHours: active.snapshotAnswerWindowHours,
    });
    if (now.getTime() >= closes.getTime()) {
      throw refusal(log, named, 'REMEDY_NOT_OPEN', 'answer_closed');
    }
    return active;
  }

  /** The options (this file's head, THE OPTIONS), soonest first, then by slot. */
  async function optionsOf(
    tx: Transaction,
    session: PartySessionRow,
    terms: EnrollmentTerms,
    remedy: RemedyRow,
    now: Date,
  ): Promise<readonly Candidate[]> {
    const fromNow = new Date(
      addHours(now, remedy.snapshotAnswerWindowHours + remedy.snapshotFirstSessionLeadHours),
    );
    const bound =
      fromNow.getTime() > remedy.choiceClosesAt.getTime() ? fromNow : remedy.choiceClosesAt;
    const slots = (await store.teacherSlotsOf(tx, session.teacherUserId)).filter(
      ({ isActive, durationMinutes }) => isActive && durationMinutes === terms.durationMinutes,
    );
    const parties = { studentUserId: session.studentUserId, teacherUserId: session.teacherUserId };
    const people = [session.studentUserId, session.teacherUserId];
    const found: Candidate[] = [];
    let pending: Candidate[] = slots.map((slot) => ({
      slot,
      occurrence: firstAtOrAfter(slot, bound),
    }));
    while (pending.length > 0) {
      const times = pending.map(({ occurrence }) => timeOf(occurrence));
      const window = {
        from: new Date(Math.min(...times.map(({ startsAt }) => startsAt.getTime()))),
        to: new Date(Math.max(...times.map(({ endsAt }) => endsAt.getTime()))),
      };
      const [own, held, reserved] = await Promise.all([
        store.sessionsBetween(tx, parties, window),
        enrollments.heldTimesOf(tx, people, window),
        store.reservedTimesOf(tx, people, window, enrollments),
      ]);
      const busy = [...own, ...held, ...reserved];
      const next: Candidate[] = [];
      for (const candidate of pending) {
        if (!overlapsAny(timeOf(candidate.occurrence), busy)) {
          found.push(candidate);
          continue;
        }
        next.push({
          slot: candidate.slot,
          occurrence: occurrenceFrom(
            candidate.slot,
            dateAfter(candidate.occurrence.requestedLocalDate),
          ),
        });
      }
      pending = next;
    }
    return found.toSorted(
      (one, other) =>
        new Date(one.occurrence.startsAt).getTime() -
          new Date(other.occurrence.startsAt).getTime() || (one.slot.id < other.slot.id ? -1 : 1),
    );
  }

  /** The remedy as its procedures answer it, read on the transaction after its writes. */
  async function viewOf(
    tx: Transaction,
    session: PartySessionRow,
    terms: EnrollmentTerms,
  ): Promise<RemedyView> {
    const [row, slot] = await Promise.all([
      store.viewRowOf(tx, session.id),
      store.slotOf(tx, terms.slotId),
    ]);
    // `enrollments.slot_id` is a foreign key to the slot (ERD `enrollments`).
    if (slot === null) throw new Error('sessions: an enrollment without its slot');
    const view =
      row === null
        ? undefined
        : remedyViewOf(row, { startTimeLocal: slot.startTimeLocal, timezone: terms.timezone });
    // Read after this call's own write, so it is there and not lapsed.
    if (view === undefined) throw new Error('sessions: a remedy just written is not there to show');
    return view;
  }

  /**
   * Releases the pending counter as a decline does, under `slots`' locks: `proposed`, its columns
   * cleared, one `kind` row. A decline is first checked answerable (its refusals); a refused
   * acceptance's release answers null when no counter is pending any more (another path moved it).
   */
  async function released(
    tx: Transaction,
    sessionId: string,
    userId: string,
    log: Logger,
    slots: SlotLocks,
    kind: 'counter_declined' | 'counter_booking_refused',
  ) {
    const { session, remedy, now } = await decided(tx, sessionId, userId, 'teacher', log, slots);
    if (kind === 'counter_declined') answerable(remedy, now, { sessionId, userId }, log);
    if (remedy?.status !== 'counter_proposed') return null;
    if (!(await store.releaseCounter(tx, remedy.id))) {
      throw new Error('sessions: a locked remedy left counter_proposed before its release');
    }
    await store.recordEvents(tx, [
      { enrollmentId: session.enrollmentId, sessionId: session.id, kind, occurredAt: now },
    ]);
    return {
      remedyId: remedy.id,
      enrollmentId: session.enrollmentId,
      choiceClosed: now.getTime() >= remedy.choiceClosesAt.getTime(),
    };
  }

  /**
   * Once the choice window has closed, the proposal booked in its own transaction (decision 9); a
   * refusal, logged by T029, leaves the remedy `proposed` for the sweep (H5).
   */
  async function bookProposalAfterAnswer(booking: RemedyBooking, remedyId: string) {
    try {
      await booking.book({ remedyId, booking: 'proposal', operation: ANSWER });
    } catch (error: unknown) {
      if (!leftForTheSweep(error)) throw error;
    }
  }

  /** The remedy as it now reads, for the teacher's answer. */
  const viewAfter = (sessionId: string, userId: string, log: Logger) =>
    transactions.run(async (tx) => {
      const session = await partysSession(tx, sessionId, userId, 'teacher', log);
      return viewOf(tx, session, await termsOf(tx, session));
    });

  async function answerCounter(
    { userId }: RemedyCaller,
    { sessionId, accept }: SessionsRemedyAnswerCounterInput,
    log: Logger,
  ): Promise<RemedyView> {
    const booking = bookingOf(log);
    const remedyId = await remedyIdOf(sessionId, userId, 'teacher', log);
    if (!accept) {
      const declined = await transactions.run((tx) =>
        released(tx, sessionId, userId, log, 'none', 'counter_declined'),
      );
      if (declined?.choiceClosed === true) await bookProposalAfterAnswer(booking, remedyId);
      return viewAfter(sessionId, userId, log);
    }
    try {
      return await booking.run({ remedyId, operation: ANSWER }, async (tx) => {
        const { session, terms, remedy, now } = await decided(
          tx,
          sessionId,
          userId,
          'teacher',
          log,
          'own_and_counter',
        );
        const active = answerable(remedy, now, { sessionId, userId }, log);
        await store.recordEvents(tx, [
          {
            enrollmentId: session.enrollmentId,
            sessionId: session.id,
            kind: 'counter_accepted',
            occurredAt: now,
          },
        ]);
        await booking.bookOn(tx, { remedyId: active.id, booking: 'counter', operation: ANSWER });
        return viewOf(tx, session, terms);
      });
    } catch (error: unknown) {
      const refused = refusalOf(error);
      if (refused?.cause !== 'overlap') throw error;
      const release = await transactions.run((tx) =>
        released(tx, sessionId, userId, log, 'own_and_counter', 'counter_booking_refused'),
      );
      if (release !== null) {
        log.warn(
          { sessionId, enrollmentId: release.enrollmentId, constraint: refused.constraint },
          "A counter-proposal's booking was refused by the database",
        );
        if (release.choiceClosed) await bookProposalAfterAnswer(booking, remedyId);
      }
      throw error;
    }
  }

  return {
    choose: ({ userId }, { sessionId, choice }, log) =>
      transactions.run(async (tx) => {
        const { session, terms, remedy, now } = await decided(
          tx,
          sessionId,
          userId,
          'student',
          log,
          'none',
        );
        const ids = { sessionId, userId };
        const active = activeRemedy(remedy, ids, log);
        const named = { ...ids, remedyId: active.id };
        if (now.getTime() >= active.choiceClosesAt.getTime()) {
          throw refusal(log, named, 'REMEDY_NOT_OPEN', 'choice_closed');
        }
        if (active.status !== 'awaiting_choice') {
          throw refusal(log, named, 'CHOICE_NOT_ALLOWED', 'not_awaiting_choice');
        }
        if (choice === 'refund') {
          if (!refundOwed(session, terms)) {
            throw refusal(log, named, 'CHOICE_NOT_ALLOWED', 'refund_not_owed');
          }
          await casesOf(log).handOff(tx, { remedyId: active.id, reason: 'refund_choice' });
        } else if (!(await store.chooseMakeup(tx, active.id))) {
          // Read under the remedy's lock as `awaiting_choice`, so the conditional update matches.
          throw new Error('sessions: a locked remedy left awaiting_choice before its choice');
        }
        return viewOf(tx, session, terms);
      }),

    accept: async ({ userId }, { sessionId }, log) => {
      const booking = bookingOf(log);
      const remedyId = await remedyIdOf(sessionId, userId, 'student', log);
      return booking.run({ remedyId, operation: ACCEPT }, async (tx) => {
        const { session, terms, remedy, now } = await decided(
          tx,
          sessionId,
          userId,
          'student',
          log,
          'own',
        );
        const active = activeRemedy(remedy, { sessionId, userId }, log);
        if (active.status === 'counter_proposed') {
          await store.recordEvents(tx, [
            {
              enrollmentId: session.enrollmentId,
              sessionId: session.id,
              kind: 'counter_withdrawn',
              occurredAt: now,
            },
          ]);
        }
        const made = await booking.bookOn(tx, {
          remedyId: active.id,
          booking: 'proposal',
          operation: ACCEPT,
        });
        return { ...(await viewOf(tx, session, terms)), makeupSessionId: made.makeupSessionId };
      });
    },

    counterOptions: ({ userId }, { sessionId }, log) =>
      transactions.run(async (tx) => {
        const session = await partysSession(tx, sessionId, userId, 'student', log);
        const terms = await termsOf(tx, session);
        const remedy = await store.remedyOf(tx, session.id);
        const now = await clock(tx);
        const active = counterable(remedy, now, { sessionId, userId }, log);
        const options = await optionsOf(tx, session, terms, active, now);
        return { options: options.map(optionOf) };
      }),

    // The outcome is stored as it is answered and replayed from the store, so it is parsed by the
    // contract's schema on its way out, the first answer and a replay alike.
    counter: async ({ userId }, { idempotencyKey, ...asked }, log) =>
      sessionsRemedyCounterOutput.parse(
        await idempotency.run(
          { scope: COUNTER_SCOPE, key: idempotencyKey, actorId: userId, input: asked },
          async (tx) => {
            const { session, terms, remedy, now } = await decided(
              tx,
              asked.sessionId,
              userId,
              'student',
              log,
              'none',
            );
            const ids = { sessionId: asked.sessionId, userId };
            const active = counterable(remedy, now, ids, log);
            const options = await optionsOf(tx, session, terms, active, now);
            const chosen = options.find(
              ({ slot, occurrence }) =>
                slot.id === asked.slotId && occurrence.requestedLocalDate === asked.localDate,
            );
            if (chosen === undefined) {
              throw refusal(
                log,
                { ...ids, remedyId: active.id },
                'SLOT_NOT_OFFERED',
                'not_offered',
              );
            }
            const counter: CounterWrite = {
              slotId: chosen.slot.id,
              date: dateColumnOf(chosen.occurrence.requestedLocalDate),
              startTimeLocal: timeColumnOf(chosen.occurrence.requestedStartTimeLocal),
              timezone: chosen.slot.timezone,
              proposedAt: now,
            };
            if (!(await store.writeCounter(tx, active.id, counter))) {
              // Read under the remedy's lock as `awaiting_choice` or `proposed`.
              throw new Error('sessions: a locked remedy left its state before its counter');
            }
            await store.recordEvents(tx, [
              {
                enrollmentId: session.enrollmentId,
                sessionId: session.id,
                kind: 'counter_proposed',
                counterSlotId: counter.slotId,
                counterDate: counter.date,
                counterStartTimeLocal: counter.startTimeLocal,
                counterTimezone: counter.timezone,
                occurredAt: now,
              },
            ]);
            return storedOf(await viewOf(tx, session, terms));
          },
        ),
      ),

    answerCounter,
  };
}

/** The view as the idempotency key stores it: its fields with a value, no `undefined` (JSON). */
function storedOf({ proposal, counter, makeupSessionId, ...view }: RemedyView): JsonValue {
  return {
    ...view,
    ...(proposal === undefined ? {} : { proposal }),
    ...(counter === undefined ? {} : { counter }),
    ...(makeupSessionId === undefined ? {} : { makeupSessionId }),
  };
}

// ---------------------------------------------------------------------------------------------
// T032: the windows' ends, one remedy at a time, for `advance-remedies` (this file's head).
// ---------------------------------------------------------------------------------------------

/** What the choice window's end did to one remedy. */
export type ChoiceEndOutcome = 'booked' | 'refused' | 'deadlocked' | 'handed_off' | 'not_due';

export interface RemedyWindows {
  /** A counter whose answer window has closed handed to a `counter_unanswered` case. */
  endAnswerWindow(remedyId: string): Promise<'handed_off' | 'not_due'>;
  /** A proposal past `choice_closes_at` booked, retried, or handed to a `makeup_refused` case. */
  bookAtChoiceEnd(remedyId: string): Promise<ChoiceEndOutcome>;
}

/** What the windows write: info lines for their automatic actions, warn lines for refused retries. */
export type WindowsLog = Pick<Logger, 'info' | 'warn'>;

export interface RemedyWindowsDependencies {
  readonly transactions: Transactions;
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentFor' | 'lockEnrollments' | 'heldTimesOf'>;
  /** The automatic actions' info lines and the refused retries' warn lines (Q11 (a)). */
  readonly log: WindowsLog;
  /** Error tracking, told once per remedy handed to a `makeup_refused` case. */
  readonly report?: (error: Error) => void;
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: RemedyStore;
  readonly bookingOf?: (log: WindowsLog) => RemedyBooking;
  readonly casesOf?: (log: WindowsLog) => Pick<RemedyCase, 'handOff'>;
  readonly makeupRefusalOf?: (error: unknown) => MakeupRefusal | null;
}

/** What one choice-window end decided inside its transaction. */
type ChoiceEnd =
  | { readonly outcome: 'not_due' }
  | { readonly outcome: 'refused'; readonly constraint: 'hold' }
  | { readonly outcome: 'booked'; readonly enrollmentId: string }
  | {
      readonly outcome: 'handed_off';
      readonly handed: Awaited<ReturnType<RemedyCase['handOff']>>;
    };

export function createRemedyWindows({
  transactions,
  enrollments,
  log,
  report = reportError,
  clock = clockTimestamp,
  store = remedyStore,
  bookingOf = (logger) => createMakeupBooking({ transactions, enrollments, log: logger, clock }),
  casesOf = (logger) => createRemedyCase({ log: logger, clock }),
  makeupRefusalOf: refusalOf = makeupRefusalOf,
}: RemedyWindowsDependencies): RemedyWindows {
  const lockRemedy = lockerOver(store, enrollments);
  const booking = bookingOf(log);
  const cases = casesOf(log);

  /** The remedy under the locks `slots` names, read again under them, and the database's clock. */
  async function lockedRemedy(
    tx: Transaction,
    remedyId: string,
    from: readonly RemedyRowStatus[],
    slots: SlotLocks,
  ): Promise<{ readonly remedy: RemedyWithParties; readonly now: Date } | null> {
    const seen = await store.remedyById(tx, remedyId);
    if (seen === null || !from.includes(seen.status)) return null;
    await lockRemedy(tx, seen, slots);
    const remedy = await store.remedyById(tx, remedyId);
    if (remedy === null || !from.includes(remedy.status)) return null;
    return { remedy, now: await clock(tx) };
  }

  return {
    endAnswerWindow: async (remedyId) => {
      const handed = await transactions.run(async (tx) => {
        const locked = await lockedRemedy(tx, remedyId, ['counter_proposed'], 'none');
        const counter = locked?.remedy.counter;
        if (locked === null || counter === undefined || counter === null) return null;
        const closes = answerClosesAt({
          counterProposedAt: counter.proposedAt,
          snapshotAnswerWindowHours: locked.remedy.snapshotAnswerWindowHours,
        });
        if (locked.now.getTime() < closes.getTime()) return null;
        return cases.handOff(tx, { remedyId, reason: 'counter_unanswered' });
      });
      if (handed === null) return 'not_due';
      logRemedyHandedOff(log, { ...handed, reason: 'counter_unanswered' });
      return 'handed_off';
    },

    bookAtChoiceEnd: async (remedyId) => {
      // The session made up, kept for the refusal's warn line (Q11 (a)).
      let sessionId: string | undefined;
      let ended: ChoiceEnd;
      try {
        ended = await booking.run(
          { remedyId, operation: SWEEP },
          async (tx): Promise<ChoiceEnd> => {
            const locked = await lockedRemedy(tx, remedyId, BOOKED_AT_CHOICE_END, 'own');
            if (locked === null) return { outcome: 'not_due' };
            const { remedy, now } = locked;
            sessionId = remedy.sessionId;
            if (now.getTime() < remedy.choiceClosesAt.getTime() || remedy.proposedDate === null) {
              return { outcome: 'not_due' };
            }
            const terms = await enrollments.enrollmentFor(tx, remedy.enrollmentId);
            if (terms === null) throw new Error('sessions: a remedy without its enrollment');
            const slot = await store.slotOf(tx, terms.slotId);
            if (slot === null) throw new Error('sessions: an enrollment without its slot');
            const proposal = proposalTime(remedy.proposedDate, slot, terms);
            const retriedUntil = bookingRetriedUntil(
              {
                status: remedy.status,
                choiceClosesAt: remedy.choiceClosesAt,
                proposalStartsAt: proposal.startsAt,
                snapshotFirstSessionLeadHours: remedy.snapshotFirstSessionLeadHours,
              },
              now,
            );
            if (retriedUntil === undefined || now.getTime() > retriedUntil.getTime()) {
              const handed = await cases.handOff(tx, { remedyId, reason: 'makeup_refused' });
              return { outcome: 'handed_off', handed };
            }
            const held = await enrollments.heldTimesOf(
              tx,
              [remedy.studentUserId, remedy.teacherUserId],
              { from: proposal.startsAt, to: proposal.endsAt },
            );
            if (overlapsAny(proposal, held)) return { outcome: 'refused', constraint: 'hold' };
            await booking.bookOn(tx, { remedyId, booking: 'proposal', operation: SWEEP });
            return { outcome: 'booked', enrollmentId: remedy.enrollmentId };
          },
        );
      } catch (error: unknown) {
        const refused = refusalOf(error);
        if (refused === null) throw error;
        if (refused.cause === 'deadlock') return 'deadlocked';
        log.warn(
          {
            remedyId,
            sessionId,
            constraint: refused.cause === 'overlap' ? refused.constraint : 'reservation',
          },
          'A make-up booking was refused',
        );
        return 'refused';
      }
      switch (ended.outcome) {
        case 'not_due':
          return 'not_due';
        case 'refused':
          log.warn(
            { remedyId, sessionId, constraint: ended.constraint },
            'A make-up booking was refused',
          );
          return 'refused';
        case 'booked':
          log.info(
            { remedyId, sessionId, enrollmentId: ended.enrollmentId, action: 'booked' },
            'A remedy was booked',
          );
          return 'booked';
        case 'handed_off':
          logRemedyHandedOff(log, { ...ended.handed, reason: 'makeup_refused' });
          report(
            new Error(
              `advance-remedies: remedy ${remedyId} was refused until its lead and handed to a case`,
            ),
          );
          return 'handed_off';
      }
    },
  };
}
