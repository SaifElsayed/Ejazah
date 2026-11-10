// T031 of specs/004-sessions/tasks.md: the student's choice (FR-463, FR-465, FR-466, FR-495; research
// R-311, "The student"; plan.md decisions 9 and 14 (i); contracts/app-surface.md, "`sessions.remedy`";
// the notes under T031, Q5 (a), Q9 (a), Q14 (a); Q8 (a) and Q11 (a) under T028).
//
// WHO MAY ASK (contracts/README.md, «Callers»; R-GENDER-2). The caller's own id finds the session
// with its party; `choose`, `accept`, `counterOptions` and `counter` are the student's, so a stranger,
// an id that never existed and the session's teacher answer one `NOT_FOUND`, and so does a student
// whose teacher is of the other gender by the server's records (R-GENDER-4), checked before any
// remedy is read, so no refusal tells a forbidden session from a nonexistent one.
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
// THE LOCKS (contracts/kernel.md; `003:T005`'s rules; Phase 3's general rule). `choose` and `counter`
// take the row «remedy offer … a counter-proposal» / «`sessions.remedy.choose`»: `users` (both, one
// call, id order), the teacher's `lockKey('teacher-slots')`, the enrollment, the session, the
// session's remedy, and a refund's `disputes` after them (T030). `accept` takes «make-up booking»'s:
// the same with the enrollment's slot after the key, before the enrollment, so T029's `bookOn`, which
// takes them again, waits on nothing it does not hold. Every decision is read again under the locks,
// the database's clock after them (Q8 (a)). A counter's `counter_slot_id` key-shares the teacher's
// slot while the session is held, which kernel.md shows safe (L2 of the sixth analysis).
import {
  type CounterOption,
  type RemedyView,
  type SessionsRemedyAcceptInput,
  type SessionsRemedyAcceptOutput,
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
  calendarDateOf,
  dateColumnOf,
  type DayOfWeek,
  type LocalDate,
  localDateIn,
  type Occurrence,
  resolveOccurrences,
  timeColumnOf,
} from '@ijazah/time';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError, type ErrorCode } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
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
} from './makeup-booking.service.js';
import { lockSessions, lockTeacherSlots } from './remedy-case.repository.js';
import { createRemedyCase, type RemedyCase } from './remedy-case.service.js';
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
  remedyRowOf,
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

/** What the procedures read, lock and write, each on the caller's transaction; faked in a spec. */
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

/** The student's procedures of `sessions.remedy` (T031). */
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
}

/** The booking's three entries a procedure uses (T029). */
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
}

/** Why a procedure was refused, as its one log line names it. */
type RefusalReason =
  | 'not_a_party'
  | 'not_the_student'
  | 'gender_differs'
  | 'no_remedy'
  | 'not_open'
  | 'choice_closed'
  | 'not_awaiting_choice'
  | 'refund_not_owed'
  | 'counter_pending'
  | 'not_offered';

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

/** The open states (data-model.md §3) but `frozen`, which accepts nothing. */
const ACTIVE: readonly RemedyRowStatus[] = ['awaiting_choice', 'proposed', 'counter_proposed'];

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

export function createRemedyServices({
  transactions,
  idempotency,
  enrollments,
  clock = clockTimestamp,
  store = remedyStore,
  bookingOf = (log) => createMakeupBooking({ transactions, enrollments, log, clock }),
  casesOf = (log) => createRemedyCase({ log, clock }),
}: RemedyDependencies): RemedyServices {
  /** The session of the student `userId`, else `NOT_FOUND` (this file's head). */
  async function studentsSession(
    tx: Transaction,
    sessionId: string,
    userId: string,
    log: Logger,
  ): Promise<PartySessionRow> {
    const ids = { sessionId, userId };
    const session = await store.sessionOfParty(tx, sessionId, userId);
    if (session === null) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
    if (session.studentUserId !== userId) throw refusal(log, ids, 'NOT_FOUND', 'not_the_student');
    const parties = await store.partiesOf(
      tx,
      [session.studentUserId, session.teacherUserId].sort(),
    );
    const own = parties.get(userId);
    const other = parties.get(session.teacherUserId);
    if (own === undefined) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
    if (other !== undefined && other.gender !== own.gender) {
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
   * The student's session under the kernel's locks (this file's head), read again under them, its
   * remedy, its enrollment's terms and the database's clock read after them. `withSlot` adds the
   * enrollment's slot after the key, as a make-up's booking takes it.
   */
  async function decidedAsStudent(
    tx: Transaction,
    sessionId: string,
    userId: string,
    log: Logger,
    withSlot: boolean,
  ) {
    const seen = await studentsSession(tx, sessionId, userId, log);
    await store.lockAccounts(tx, [seen.studentUserId, seen.teacherUserId].sort());
    await store.lockTeacherSlots(tx, seen.teacherUserId);
    const terms = await termsOf(tx, seen);
    if (withSlot) await store.lockSlots(tx, [terms.slotId]);
    await enrollments.lockEnrollments(tx, [seen.enrollmentId]);
    await store.lockSessions(tx, [seen.id]);
    await store.lockRemedyOfSession(tx, seen.id);
    const session = await studentsSession(tx, sessionId, userId, log);
    const remedy = await store.remedyOf(tx, session.id);
    return { session, terms, remedy, now: await clock(tx) };
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
    // Read under the remedy's lock after this call's own write, so it is there and not lapsed.
    if (view === undefined) throw new Error('sessions: a remedy just written is not there to show');
    return view;
  }

  return {
    choose: ({ userId }, { sessionId, choice }, log) =>
      transactions.run(async (tx) => {
        const { session, terms, remedy, now } = await decidedAsStudent(
          tx,
          sessionId,
          userId,
          log,
          false,
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
      // The remedy's id for the booking's deadlock lines (L5), read with no lock; the caller
      // checked first, so no refusal here tells a forbidden session from a nonexistent one.
      const remedyId = await transactions.run(async (tx) => {
        const seen = await studentsSession(tx, sessionId, userId, log);
        return (await store.remedyOf(tx, seen.id))?.id;
      });
      if (remedyId === undefined) {
        throw refusal(log, { sessionId, userId }, 'REMEDY_NOT_OPEN', 'no_remedy');
      }
      return booking.run({ remedyId, operation: ACCEPT }, async (tx) => {
        const { session, terms, remedy, now } = await decidedAsStudent(
          tx,
          sessionId,
          userId,
          log,
          true,
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
        const session = await studentsSession(tx, sessionId, userId, log);
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
            const { session, terms, remedy, now } = await decidedAsStudent(
              tx,
              asked.sessionId,
              userId,
              log,
              false,
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
