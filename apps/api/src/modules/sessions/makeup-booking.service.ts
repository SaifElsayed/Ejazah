// T029 of specs/004-sessions/tasks.md (FR-423, FR-468, FR-469; research R-311, "Booking a make-up";
// ADR 0018 D3; the note under `003:T026`, nit 5; the notes under T029): the one booking of a remedy's
// make-up, its system's proposal or its pending counter-proposal. `sessions.remedy.accept` (T031),
// `sessions.remedy.answerCounter` (T032) and `advance-remedies`' bookings (T032) all book here.
//
// WHAT IS BOOKED. The proposal: `proposed_date` at the enrollment's slot's local start (the slot
// cannot move while the remedy is open, Q1 (a)), in the enrollment's snapshot zone, for its session
// length. The counter: its own date, start and zone (`counter_timezone`, the slot's own, `003:T077`).
// Each resolved on its own date by `packages/time` (R-TIME-1, R-TIME-2). One `scheduled` session is
// inserted with `sequence_number` the last + 1 and `makeup_for_session_id`, the local date, start and
// zone as the fact and the instants as the cache (ADR 0009); the remedy `booked` with `decided_at`, a
// pending counter's five columns cleared; one `makeup_booked` row. The enrollment's end and its slot's
// release follow the new final session by themselves (`lastSessionDateOf`, FR-BOOK-10, FR-MAKEUP-5).
// The proposal is booked from `awaiting_choice`, `proposed` or `counter_proposed`, the counter from
// `counter_proposed` only; any other state (`frozen` included) is refused `REMEDY_NOT_OPEN`. The
// caller decides what precedes the booking (a choice, a withdrawn counter's row, a decline) on the
// same transaction and the same locks, which it may take first.
//
// THE REFUSALS (FR-468; R-320). Under the locks, the reserved times of both parties
// (`reservedTimesOf`, T027) are read again over the make-up's time: another remedy's refuses it
// before any write, the remedy's own being dropped (Q7 (a)). The database's exclusions refuse an
// overlap with any other session of either party (`isExclusionViolation`); the transaction is then
// rolled back by the throw. Both answer `MAKEUP_REFUSED`, the remedy left open, and carry what refused
// it (`makeupRefusalOf`): the constraint the database named, which T032's `counter_booking_refused`
// line names (A7), or the reservation.
//
// THE DEADLOCK (L5; research R-321). `reresolve-session-instants`' deferred overlap check can
// deadlock against this insert at its commit. `run` opens the booking's transaction through T002's
// `runRetryingDeadlockOnce` with the calling operation and `{ remedyId }`: one retry in a new
// transaction, and a second deadlock answers `MAKEUP_REFUSED` (cause `deadlock`), the remedy open,
// nothing written; T002 writes the deadlock lines and the refusal's. A deadlock is no refusal to the
// sweep (T032's note): it reads the cause and tries again next run.
//
// THE LOCKS (contracts/kernel.md, the row «make-up booking»; T005's rules; Phase 3's general rule).
// The remedy is read with no lock for its session's two accounts (sessions' own copies, ADR 0010);
// then `users` (both, one call, id order) and the teacher's `lockKey('teacher-slots')`. Every path
// that writes a counter-proposal takes those two first (kernel.md's offer row), so the remedy read
// again under them names the counter's slot for good. Then `availability_slots`, the enrollment's
// own and, for a counter, the counter's, in one call in id order, one when they are the same (L2):
// the enrollment's own in both cases, since the booking moves the enrollment's final session, which
// its slot's use reads (`003:T026`, nit 5). Then the enrollment, the session and the remedy, and the
// remedy read again under them (rule 1) for the decision. The insert references both accounts, the
// enrollment and the session made up, each held.
//
// THE CLOCK (Q8). `decided_at` and the event's instant are the database's clock, read under the locks.
//
// THE LOG (the owner's rule; Q11 (a)). A refusal writes one info line of ids and a reason code through
// this file's `refusal`, marked «logged», except a `MAKEUP_REFUSED` on the sweep's booking, whose one
// warn line `{ remedyId, sessionId, constraint }` is the sweep's (T032's note). A booking writes none:
// the sweep's H5 booking's line is the sweep's, after its commit.
import {
  addMinutes,
  calendarDateOf,
  dateColumnOf,
  type LocalDate,
  type LocalTime,
  localTimeOf,
  resolveLocalDateTime,
  timeColumnOf,
} from '@ijazah/time';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import { type ExclusionConstraint, isExclusionViolation } from '../../platform/db/db-errors.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  runRetryingDeadlockOnce,
  type Transactions,
} from '../../platform/db/transaction.repository.js';
import { DomainError, type ErrorCode } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import { readSlot, type SlotRow } from '../catalog/index.js';
import type { RemedyStatus } from './completion.repository.js';
import type { EnrollmentSide, EnrollmentTerms } from './enrollment-side.port.js';
import {
  insertMakeup,
  lastSequenceOf,
  lockSlots,
  markBooked,
  type NewMakeupRow,
  type RemedyToBook,
  remedyToBook,
} from './makeup-booking.repository.js';
import {
  lockAccounts,
  lockRemedies,
  lockSessions,
  lockTeacherSlots,
} from './remedy-case.repository.js';
import {
  type ReservationReads,
  type ReservedTime,
  reservedTimesOf,
} from './reservations.service.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';

/** What a booking books: the system's proposal or the pending counter-proposal. */
export type MakeupBookingKind = 'proposal' | 'counter';

/** The calling operation, as T002's deadlock lines name it (L5; Q4 (a)). */
export type MakeupOperation =
  'sessions.remedy.accept' | 'sessions.remedy.answerCounter' | 'advance-remedies';

export interface MakeupBookingInput {
  readonly remedyId: string;
  readonly booking: MakeupBookingKind;
  readonly operation: MakeupOperation;
}

/** What a booking did. */
export interface MakeupBooked {
  readonly remedyId: string;
  /** The session made up. */
  readonly sessionId: string;
  readonly enrollmentId: string;
  readonly makeupSessionId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** What refused a booking `MAKEUP_REFUSED`, for its caller (T031, T032). */
export type MakeupRefusal =
  | { readonly cause: 'overlap'; readonly constraint: ExclusionConstraint }
  | { readonly cause: 'reserved' }
  | { readonly cause: 'deadlock' };

/** The `cause` a `MAKEUP_REFUSED` carries; never sent to a client (the error filter sends the code). */
class MakeupRefusedCause {
  constructor(readonly refusal: MakeupRefusal) {}
}

/** What refused `error`'s booking, or null when `error` is not a make-up's refusal. */
export function makeupRefusalOf(error: unknown): MakeupRefusal | null {
  return error instanceof DomainError &&
    error.code === 'MAKEUP_REFUSED' &&
    error.cause instanceof MakeupRefusedCause
    ? error.cause.refusal
    : null;
}

/** The states each booking books from (this file's head). */
const BOOKED_FROM: Readonly<Record<MakeupBookingKind, readonly RemedyStatus[]>> = {
  proposal: ['awaiting_choice', 'proposed', 'counter_proposed'],
  counter: ['counter_proposed'],
};

const EXCLUSIONS: readonly ExclusionConstraint[] = [
  'sessions_teacher_no_overlap',
  'sessions_student_no_overlap',
];

/** What the booking reads, locks and writes, each on the caller's transaction; faked in a spec. */
export interface MakeupBookingStore {
  /** The remedy and its session's parties; no lock. */
  remedyToBook(tx: Transaction, remedyId: string): Promise<RemedyToBook | null>;
  /** Both accounts, `FOR UPDATE`, in one call. */
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  /** The teacher's `lockKey('teacher-slots')`. */
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  /** The slots, `FOR UPDATE`, in one call in id order. */
  lockSlots(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockRemedies(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** The enrollment's slot, through catalog's entry (R-API-6). */
  slotOf(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  /** T027's reserved times of the parties over the window. */
  reservedTimesOf(
    tx: Transaction,
    userIds: readonly string[],
    window: { readonly from: Date; readonly to: Date },
    reads: ReservationReads,
  ): Promise<readonly ReservedTime[]>;
  lastSequenceOf(tx: Transaction, enrollmentId: string): Promise<number>;
  insertMakeup(tx: Transaction, row: NewMakeupRow): Promise<string>;
  /** The conditional booking; whether it moved the row. */
  markBooked(
    tx: Transaction,
    remedyId: string,
    from: readonly RemedyStatus[],
    at: Date,
  ): Promise<boolean>;
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

/** The store over sessions' tables, the kernel's locks and catalog's entry. */
export const makeupBookingStore: MakeupBookingStore = {
  remedyToBook,
  lockAccounts,
  lockTeacherSlots,
  lockSlots,
  lockSessions,
  lockRemedies,
  slotOf: readSlot,
  reservedTimesOf: (tx, userIds, window, reads) => reservedTimesOf(tx, userIds, window, reads),
  lastSequenceOf,
  insertMakeup,
  markBooked,
  recordEvents: recordSessionEvents,
};

export interface MakeupBooking {
  /** Books on the caller's transaction, under the locks it takes (this file's head). */
  bookOn(tx: Transaction, input: MakeupBookingInput): Promise<MakeupBooked>;
  /**
   * Runs `work`, the booking's transaction, through `runRetryingDeadlockOnce` with `operation` and
   * `{ remedyId }`; a second deadlock answers `MAKEUP_REFUSED` (cause `deadlock`).
   */
  run<T>(
    trace: Pick<MakeupBookingInput, 'remedyId' | 'operation'>,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T>;
  /** `bookOn` in its own transaction, through `run`. */
  book(input: MakeupBookingInput): Promise<MakeupBooked>;
}

/** Why a booking was refused, as its one log line names it. */
type RefusalReason = 'not_found' | 'not_open' | 'reserved' | 'overlap';

interface RefusalIds {
  readonly remedyId: string;
  readonly sessionId?: string;
  readonly enrollmentId?: string;
  readonly operation: MakeupOperation;
}

/** The make-up's local date, start and zone, and the instants they resolve to. */
interface MakeupTime {
  readonly localDate: LocalDate;
  readonly localTime: LocalTime;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

function timeOf(
  localDate: LocalDate,
  localTime: LocalTime,
  timezone: string,
  minutes: number,
): MakeupTime {
  const startsAt = new Date(resolveLocalDateTime({ localDate, localTime, timezone }).startsAt);
  return {
    localDate,
    localTime,
    timezone,
    startsAt,
    endsAt: new Date(addMinutes(startsAt, minutes)),
  };
}

export function createMakeupBooking({
  transactions,
  enrollments,
  log,
  clock = clockTimestamp,
  store = makeupBookingStore,
}: {
  readonly transactions: Transactions;
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentFor' | 'lockEnrollments'>;
  /** The refusals' lines (info) and T002's deadlock lines (warn). */
  readonly log: Pick<Logger, 'info' | 'warn'>;
  /** The database's clock on the call's transaction (Q8). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: MakeupBookingStore;
}): MakeupBooking {
  /**
   * Logs the refusal with ids and its reason only (none for the sweep's `MAKEUP_REFUSED`, this
   * file's head), and answers the error to throw, marked «logged».
   */
  function refusal(
    ids: RefusalIds,
    errorCode: ErrorCode,
    reason: RefusalReason,
    made?: MakeupRefusal,
  ): DomainError {
    const constraint = made?.cause === 'overlap' ? { constraint: made.constraint } : {};
    if (!(errorCode === 'MAKEUP_REFUSED' && ids.operation === 'advance-remedies')) {
      log.info({ ...ids, errorCode, reason, ...constraint }, 'A make-up booking was refused');
    }
    return markRefusalLogged(
      new DomainError(
        errorCode,
        undefined,
        made === undefined ? {} : { cause: new MakeupRefusedCause(made) },
      ),
    );
  }

  /** The make-up's time: the proposal at the enrollment's slot, or the counter as written. */
  async function timeToBook(
    tx: Transaction,
    remedy: RemedyToBook,
    booking: MakeupBookingKind,
    terms: EnrollmentTerms,
  ): Promise<MakeupTime | null> {
    if (booking === 'counter') {
      const { counter } = remedy;
      if (counter === null) return null;
      return timeOf(
        calendarDateOf(counter.date),
        localTimeOf(counter.startTimeLocal),
        counter.timezone,
        terms.durationMinutes,
      );
    }
    if (remedy.proposedDate === null) return null;
    const slot = await store.slotOf(tx, terms.slotId);
    // The enrollment's slot is a row an enrollment references; it is never deleted.
    if (slot === null) throw new Error("sessions: an enrollment's slot is not there to read");
    return timeOf(
      calendarDateOf(remedy.proposedDate),
      slot.startTimeLocal,
      terms.timezone,
      terms.durationMinutes,
    );
  }

  const bookOn = async (
    tx: Transaction,
    { remedyId, booking, operation }: MakeupBookingInput,
  ): Promise<MakeupBooked> => {
    const seen = await store.remedyToBook(tx, remedyId);
    if (seen === null) throw refusal({ remedyId, operation }, 'NOT_FOUND', 'not_found');
    const { sessionId, enrollmentId, studentUserId, teacherUserId } = seen;
    const ids = { remedyId, sessionId, enrollmentId, operation };
    const parties = [studentUserId, teacherUserId].sort();
    await store.lockAccounts(tx, parties);
    await store.lockTeacherSlots(tx, teacherUserId);
    const counterSeen = (await store.remedyToBook(tx, remedyId))?.counter ?? null;
    const terms = await enrollments.enrollmentFor(tx, enrollmentId);
    // A session's enrollment is never deleted (T148 soft-deletes; its terms stay readable).
    if (terms === null) throw new Error("sessions: a remedy's enrollment is not there to read");
    const slots = [terms.slotId];
    if (booking === 'counter' && counterSeen !== null) slots.push(counterSeen.slotId);
    await store.lockSlots(tx, [...new Set(slots)].sort());
    await enrollments.lockEnrollments(tx, [enrollmentId]);
    await store.lockSessions(tx, [sessionId]);
    await store.lockRemedies(tx, [remedyId]);

    const remedy = await store.remedyToBook(tx, remedyId);
    const from = BOOKED_FROM[booking];
    const time =
      remedy === null || !from.includes(remedy.status)
        ? null
        : await timeToBook(tx, remedy, booking, terms);
    if (remedy === null || time === null) throw refusal(ids, 'REMEDY_NOT_OPEN', 'not_open');
    if (booking === 'counter' && remedy.counter?.slotId !== counterSeen?.slotId) {
      // Every writer of a counter takes the accounts and the key first, held since `counterSeen`.
      throw new Error("sessions: a counter-proposal changed under the teacher's slots key");
    }

    const reserved = await store.reservedTimesOf(
      tx,
      parties,
      { from: time.startsAt, to: time.endsAt },
      enrollments,
    );
    if (reserved.some((taken) => taken.remedyId !== remedyId)) {
      throw refusal(ids, 'MAKEUP_REFUSED', 'reserved', { cause: 'reserved' });
    }

    const at = await clock(tx);
    const sequenceNumber = (await store.lastSequenceOf(tx, enrollmentId)) + 1;
    let makeupSessionId: string;
    try {
      makeupSessionId = await store.insertMakeup(tx, {
        enrollmentId,
        teacherUserId,
        studentUserId,
        sequenceNumber,
        makeupForSessionId: sessionId,
        scheduledDateLocal: dateColumnOf(time.localDate),
        scheduledStartTimeLocal: timeColumnOf(time.localTime),
        timezone: time.timezone,
        scheduledStartAt: time.startsAt,
        scheduledEndAt: time.endsAt,
      });
    } catch (error: unknown) {
      const constraint = EXCLUSIONS.find((name) => isExclusionViolation(error, name));
      if (constraint === undefined) throw error;
      throw refusal(ids, 'MAKEUP_REFUSED', 'overlap', { cause: 'overlap', constraint });
    }
    // Read under the remedy's lock in a state `from` holds, so the conditional update matches.
    if (!(await store.markBooked(tx, remedyId, from, at))) {
      throw new Error('sessions: a locked remedy left its state before its booking');
    }
    await store.recordEvents(tx, [
      { enrollmentId, sessionId, kind: 'makeup_booked', occurredAt: at },
    ]);
    return {
      remedyId,
      sessionId,
      enrollmentId,
      makeupSessionId,
      startsAt: time.startsAt,
      endsAt: time.endsAt,
    };
  };

  const run = <T>(
    { remedyId, operation }: Pick<MakeupBookingInput, 'remedyId' | 'operation'>,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    runRetryingDeadlockOnce(
      transactions,
      work,
      () =>
        markRefusalLogged(
          new DomainError('MAKEUP_REFUSED', undefined, {
            cause: new MakeupRefusedCause({ cause: 'deadlock' }),
          }),
        ),
      { log, operation, ids: { remedyId } },
    );

  return {
    bookOn,
    run,
    book: (input) => run(input, (tx) => bookOn(tx, input)),
  };
}
