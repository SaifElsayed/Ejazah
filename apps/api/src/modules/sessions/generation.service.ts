// T034 (R-209, FR-368, FR-369, ADR 0009 D1–D2): an enrollment's sessions, generated when the
// confirm job (T039) confirms it on the gateway's paid event.
//
// THE DATES. Consecutive weeks at the slot's weekday and local start, in the zone the enrollment
// snapshot (`snapshot_slot_timezone`). The first is the slot's first occurrence that starts at least
// `first_session_lead_hours` after the confirmation, by `firstOccurrenceAfter`, the rule booking's
// nearest slot and the checkout's quoted date read (FR-386); the rest are that local date plus one
// calendar week each, each resolved on its own by `resolveOccurrences` (R-TIME-1, R-TIME-2). They are
// numbered from one. A row stores what was asked for, the local date, start and zone, as the fact,
// and the instants `packages/time` resolved as the cache (ADR 0009 D2): over Cairo's April gap a
// Friday 00:30 is stored as 00:30 and cached at the instant it lands on, 01:30.
//
// THE REFUSAL. Every row goes in one statement (`insertSessions`), so a session the database refuses
// as overlapping another of the teacher or the student (ERD §15 rule 19) leaves none of them; the
// refusal is thrown as it is, the caller naming it (`isExclusionViolation`, T006) and rolling back.
//
// A PLAN (T061 of specs/004-sessions; FR-424, FR-455; research R-322, step 4): widened additively
// with a count and a first sequence number, so an administrator's restore creates the sessions it
// still owes, numbered after the last, from the first occurrence at least the lead after the
// restore. With none, the snapshot's count numbered from one, as before; a count of none writes
// nothing.
//
// A PROGRAMME'S MONTHS (006:T006 of specs/006-programme; R-507). A plan may name each session's
// month (`months`, one per session), written as `programme_month`; a plan that names none writes
// none, as before (the assessment's session 1 and every other enrollment's).
//
// THE LOCKS (T005's rules, `platform/db/row-lock.ts`). A `sessions` row references both accounts
// and the enrollment, so this function takes the caller's transaction and expects it to hold, in
// this order: both accounts in one `lockRows(tx, 'users', [studentUserId, teacherUserId])` call,
// then the slot, then the enrollment (`lockRows(tx, 'enrollments', [id])`), each taken before the
// caller read what it decided on. It takes no lock itself: taking one here, after the caller's
// writes of the confirmation, would take the accounts after the slot and the enrollment, against
// the one order.
import {
  type DayOfWeek,
  dateColumnOf,
  firstOccurrenceAfter,
  type LocalDate,
  type LocalTime,
  type RecurringSlot,
  resolveOccurrences,
  timeColumnOf,
  type TimeZoneId,
  type UtcInstant,
} from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { insertSessions, type NewSessionRow } from './sessions.repository.js';

/**
 * What generation reads of an enrollment: its accounts and snapshot (the enrollment row's own
 * fields), and its slot's weekday and local start, which the caller reads through catalog's entry
 * under the slot's lock (R-API-6).
 */
export interface EnrollmentToSchedule {
  readonly id: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly snapshotSessionCount: number;
  readonly snapshotDurationMinutes: number;
  readonly snapshotSlotTimezone: TimeZoneId;
  readonly slot: { readonly dayOfWeek: number; readonly startTimeLocal: LocalTime };
}

/** One generated session: the requested local fields, its zone and the cached instants. */
export interface ScheduledSession {
  readonly sequenceNumber: number;
  readonly scheduledDateLocal: LocalDate;
  readonly scheduledStartTimeLocal: LocalTime;
  readonly timezone: TimeZoneId;
  readonly scheduledStartAt: UtcInstant;
  readonly scheduledEndAt: UtcInstant;
}

/** The enrollment's slot as `packages/time` resolves it: the snapshot's length and zone. */
function recurringSlotOf(enrollment: EnrollmentToSchedule): RecurringSlot {
  return {
    // `availability_slots.day_of_week` is 0 to 6 by its check (ERD §15 rule 37); the package asserts it.
    dayOfWeek: enrollment.slot.dayOfWeek as DayOfWeek,
    startTimeLocal: enrollment.slot.startTimeLocal,
    durationMinutes: enrollment.snapshotDurationMinutes,
    timezone: enrollment.snapshotSlotTimezone,
  };
}

/** T061: how many sessions to place, and the number of the first (FR-424). */
export interface GenerationPlan {
  readonly count: number;
  readonly firstSequenceNumber: number;
  /** 006:T006: each session's programme month, in order; absent, none is written. */
  readonly months?: readonly number[];
}

/**
 * The enrollment's sessions by FR-368's rule, confirmed at `confirmedAt` with a lead of `leadHours`;
 * `plan`'s count numbered from its first number when given (T061), else the snapshot's from one.
 */
export function sessionsFor(
  enrollment: EnrollmentToSchedule,
  confirmedAt: Date,
  leadHours: number,
  plan: GenerationPlan = { count: enrollment.snapshotSessionCount, firstSequenceNumber: 1 },
): readonly ScheduledSession[] {
  if (plan.count === 0) return [];
  const slot = recurringSlotOf(enrollment);
  const first = firstOccurrenceAfter(slot, confirmedAt, leadHours);
  return resolveOccurrences(slot, {
    fromLocalDate: first.requestedLocalDate,
    count: plan.count,
  }).map((occurrence, index) => ({
    sequenceNumber: plan.firstSequenceNumber + index,
    scheduledDateLocal: occurrence.requestedLocalDate,
    scheduledStartTimeLocal: occurrence.requestedStartTimeLocal,
    timezone: occurrence.timezone,
    scheduledStartAt: occurrence.startsAt,
    scheduledEndAt: occurrence.endsAt,
  }));
}

/** A generated session as its `sessions` row, the accounts copied from the enrollment (ADR 0010 D2). */
function rowOf(
  enrollment: EnrollmentToSchedule,
  session: ScheduledSession,
  month: number | undefined,
): NewSessionRow {
  return {
    ...(month === undefined ? {} : { programmeMonth: month }),
    enrollmentId: enrollment.id,
    teacherUserId: enrollment.teacherUserId,
    studentUserId: enrollment.studentUserId,
    sequenceNumber: session.sequenceNumber,
    scheduledDateLocal: dateColumnOf(session.scheduledDateLocal),
    scheduledStartTimeLocal: timeColumnOf(session.scheduledStartTimeLocal),
    timezone: session.timezone,
    scheduledStartAt: new Date(session.scheduledStartAt),
    scheduledEndAt: new Date(session.scheduledEndAt),
    status: 'scheduled',
  };
}

/**
 * Writes `enrollment`'s sessions on the caller's transaction, the first at least `leadHours` (the
 * setting `first_session_lead_hours`, read by the caller before its transaction) after
 * `confirmedAt`, and answers them. Expects the caller to hold, in order, both accounts (one
 * `lockRows(tx, 'users', …)` call), the slot and the enrollment (T005). A session the database
 * refuses as overlapping fails the whole call and writes none (FR-369).
 */
export async function generateForEnrollment(
  tx: Transaction,
  enrollment: EnrollmentToSchedule,
  confirmedAt: Date,
  leadHours: number,
  plan?: GenerationPlan,
): Promise<readonly ScheduledSession[]> {
  const sessions = sessionsFor(enrollment, confirmedAt, leadHours, plan);
  if (sessions.length === 0) return sessions;
  await insertSessions(
    tx,
    sessions.map((session, index) => rowOf(enrollment, session, plan?.months?.[index])),
  );
  return sessions;
}
