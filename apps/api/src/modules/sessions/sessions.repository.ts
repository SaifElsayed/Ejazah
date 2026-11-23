// T026 (R-205, FR-394, FR-BOOK-10): the sessions module's reads that booking asks through this
// module's entry, so booking never reads the `sessions` table (R-API-6). The reads run on the
// caller's transaction and take no lock. A soft-deleted session is left out by the client's extension
// (T148). T034: generation's one write, an enrollment's sessions in one statement, on the
// confirmation's transaction, whose caller holds the locks (`generation.service.ts`). T032: the
// times of a student's sessions in a window, for the booking sheet; read-only, no lock. T033 widens
// it to the student's and the teacher's, for the one overlap check the hold and the sheet share
// (FR-351, FR-BOOK-5). T049: the lists' reads, each session with its status: the sessions of some
// enrollments, and the sessions of a teacher's day (FR-390, FR-391); read-only, no lock. T011 of
// specs/004-sessions: a session as its party reads it, by its id and the party together, and the
// join's one lock, the session's two accounts in one `lockRows` call (kernel.md's `sessions.join`
// row). 005:T017: the reminder sweep's page of scheduled sessions by end time; read-only, no lock.
import type { SessionStatus } from '@ijazah/contracts';
import { calendarDateOf, type LocalDate, type LocalTime, localTimeOf } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

/**
 * Of `enrollmentIds`, each enrollment's latest `scheduled_date_local`, its final session's requested
 * local date (ADR 0009 D1), in one grouped statement over `(enrollment_id, sequence_number)`'s
 * index. An enrollment with no session is absent.
 */
export async function lastSessionDateOf(
  tx: Pick<Transaction, 'session'>,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, LocalDate>> {
  const dates = new Map<string, LocalDate>();
  if (enrollmentIds.length === 0) return dates;
  const groups = await tx.session.groupBy({
    by: ['enrollmentId'],
    where: { enrollmentId: { in: [...enrollmentIds] } },
    _max: { scheduledDateLocal: true },
  });
  for (const { enrollmentId, _max } of groups) {
    if (_max.scheduledDateLocal !== null) {
      dates.set(enrollmentId, calendarDateOf(_max.scheduledDateLocal));
    }
  }
  return dates;
}

/** A session's time, as the parties' own sessions are read for the booking sheet and the hold. */
export interface SessionTime {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * The statuses that free a session's time, as the overlap constraints read them (ERD §15 rule 19);
 * 003:T112 (DEC-90, Q-2 (a)): `postponed` among them, as `20261119095115_session_postponements` frees it.
 */
export const TIME_FREEING_STATUSES = [
  'cancelled_by_agreement',
  'cancelled_by_admin',
  'postponed',
] as const;

/**
 * The times of the student's and the teacher's sessions that hold time in `[from, to)` (T032, T033,
 * R-205, FR-350, FR-351, FR-BOOK-5), as one list: every status but the two cancellations, a
 * soft-deleted one left out by the client's extension, so a booking leaves out what
 * `sessions_student_no_overlap` and `sessions_teacher_no_overlap` would refuse. Over the
 * `student_user_id` and `teacher_user_id` indexes; bounded by the window, since those constraints
 * keep each party's sessions from overlapping one another.
 */
export async function partiesSessionsBetween(
  tx: Pick<Transaction, 'session'>,
  parties: { readonly studentUserId: string; readonly teacherUserId: string },
  window: { readonly from: Date; readonly to: Date },
): Promise<readonly SessionTime[]> {
  const rows = await tx.session.findMany({
    where: {
      OR: [{ studentUserId: parties.studentUserId }, { teacherUserId: parties.teacherUserId }],
      status: { notIn: [...TIME_FREEING_STATUSES] },
      scheduledStartAt: { lt: window.to },
      scheduledEndAt: { gt: window.from },
    },
    orderBy: { scheduledStartAt: 'asc' },
    select: { scheduledStartAt: true, scheduledEndAt: true },
  });
  return rows.map(({ scheduledStartAt, scheduledEndAt }) => ({
    startsAt: scheduledStartAt,
    endsAt: scheduledEndAt,
  }));
}

/** One `sessions` row as generation writes it (T034, ADR 0009 D1–D2). */
export interface NewSessionRow {
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly sequenceNumber: number;
  readonly scheduledDateLocal: Date;
  readonly scheduledStartTimeLocal: Date;
  readonly timezone: string;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date;
  readonly status: 'scheduled';
  /** 006:T006 (R-507): the programme's month of an offer session; absent on every other. */
  readonly programmeMonth?: number;
}

/**
 * Inserts `rows` in one statement on the caller's transaction (T034, FR-369): a row the database
 * refuses (ERD §15 rule 19's exclusions) refuses the statement, so none of them is written, and the
 * refusal is thrown as it is for the caller to name (`isExclusionViolation`, T006).
 */
export async function insertSessions(
  tx: Pick<Transaction, 'session'>,
  rows: readonly NewSessionRow[],
): Promise<void> {
  await tx.session.createMany({ data: [...rows] });
}

/**
 * One session of an enrollment, as `checkout.status` shows it (T037, FR-386, FR-393, R-TIME-6),
 * with its status for the lists (T049, FR-390, FR-391).
 */
export interface EnrollmentSessionRow {
  /** The session's id (004:T020: the lists answer it as `sessionId`). */
  readonly id: string;
  readonly sequenceNumber: number;
  readonly localDate: LocalDate;
  readonly startTimeLocal: LocalTime;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: SessionStatus;
  /** The outcome frozen beside a `disputed` status once written (T014, R-308); absent otherwise. */
  readonly outcomeUnderDispute?: SessionStatus;
  /** 006:T012 (R-507, R-512): an offer session's programme month; absent on every other. */
  readonly programmeMonth?: number;
}

interface SelectedSession {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly scheduledDateLocal: Date;
  readonly scheduledStartTimeLocal: Date;
  readonly timezone: string;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date;
  readonly status: SessionStatus;
  readonly outcomeUnderDispute: SessionStatus | null;
  /** 006:T012: read by `sessionsOfEnrollments` only (payments' case amounts). */
  readonly programmeMonth?: number | null;
}

function sessionRowOf(row: SelectedSession): EnrollmentSessionRow {
  return {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    localDate: calendarDateOf(row.scheduledDateLocal),
    startTimeLocal: localTimeOf(row.scheduledStartTimeLocal),
    timezone: row.timezone,
    startsAt: row.scheduledStartAt,
    endsAt: row.scheduledEndAt,
    status: row.status,
    ...(row.outcomeUnderDispute === null ? {} : { outcomeUnderDispute: row.outcomeUnderDispute }),
    ...(row.programmeMonth === undefined || row.programmeMonth === null
      ? {}
      : { programmeMonth: row.programmeMonth }),
  };
}

/**
 * The enrollment's sessions by sequence number (T037), a soft-deleted one left out by the client's
 * extension. Over the `(enrollment_id, sequence_number)` index; bounded by the package's count
 * (at most 52, FR-311).
 */
export async function enrollmentSessionsOf(
  tx: Pick<Transaction, 'session'>,
  enrollmentId: string,
): Promise<readonly EnrollmentSessionRow[]> {
  const rows = await tx.session.findMany({
    where: { enrollmentId },
    orderBy: { sequenceNumber: 'asc' },
    select: {
      id: true,
      enrollmentId: true,
      sequenceNumber: true,
      scheduledDateLocal: true,
      scheduledStartTimeLocal: true,
      timezone: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      status: true,
      outcomeUnderDispute: true,
    },
  });
  return rows.map(sessionRowOf);
}

/**
 * Each of `enrollmentIds`' sessions by sequence number, in one statement (T049, FR-390, FR-391); an
 * enrollment with no session is absent. Read-only, no lock: nothing is decided on it. Over the
 * `(enrollment_id, sequence_number)` index, bounded by the ids the caller holds and each package's
 * count.
 */
export async function sessionsOfEnrollments(
  tx: Pick<Transaction, 'session'>,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, readonly EnrollmentSessionRow[]>> {
  const byEnrollment = new Map<string, EnrollmentSessionRow[]>();
  if (enrollmentIds.length === 0) return byEnrollment;
  const rows = await tx.session.findMany({
    where: { enrollmentId: { in: [...enrollmentIds] } },
    orderBy: [{ enrollmentId: 'asc' }, { sequenceNumber: 'asc' }],
    select: {
      id: true,
      enrollmentId: true,
      sequenceNumber: true,
      scheduledDateLocal: true,
      scheduledStartTimeLocal: true,
      timezone: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      status: true,
      outcomeUnderDispute: true,
      programmeMonth: true,
    },
  });
  for (const row of rows) {
    const sessions = byEnrollment.get(row.enrollmentId) ?? [];
    sessions.push(sessionRowOf(row));
    byEnrollment.set(row.enrollmentId, sessions);
  }
  return byEnrollment;
}

/**
 * 003:T105 (Q-B1-4 (a), the owner's answer of 2026-11-18): of `enrollmentIds`' sessions, each make-up's
 * id to the id of the session it makes up (ADR 0018 D3, `makeup_for_session_id`), so payments values a
 * delivered make-up as its original. One statement over `(enrollment_id, sequence_number)`, bounded by
 * the enrollments asked; read-only, no lock. A session that makes up none is absent.
 */
export async function makeupOriginsAmong(
  tx: Pick<Transaction, 'session'>,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (enrollmentIds.length === 0) return new Map();
  const rows = await tx.session.findMany({
    where: { enrollmentId: { in: [...enrollmentIds] }, makeupForSessionId: { not: null } },
    orderBy: [{ enrollmentId: 'asc' }, { sequenceNumber: 'asc' }],
    select: { id: true, makeupForSessionId: true },
  });
  return new Map(
    rows.flatMap(({ id, makeupForSessionId }) =>
      makeupForSessionId === null ? [] : [[id, makeupForSessionId] as const],
    ),
  );
}

/** A session of a teacher's day, with the enrollment it belongs to (T049). */
export interface DaySession extends EnrollmentSessionRow {
  readonly enrollmentId: string;
}

/**
 * The teacher's sessions starting in `[from, to)`, by start (T049, FR-391: «اليوم»), every status,
 * a soft-deleted one left out by the client's extension. Read-only, no lock: nothing is decided on
 * it. Over the `teacher_user_id` index, bounded by the window, since `sessions_teacher_no_overlap`
 * keeps the teacher's sessions from overlapping one another.
 */
export async function teacherSessionsBetween(
  tx: Pick<Transaction, 'session'>,
  teacherUserId: string,
  window: { readonly from: Date; readonly to: Date },
): Promise<readonly DaySession[]> {
  const rows = await tx.session.findMany({
    where: { teacherUserId, scheduledStartAt: { gte: window.from, lt: window.to } },
    orderBy: [{ scheduledStartAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      enrollmentId: true,
      sequenceNumber: true,
      scheduledDateLocal: true,
      scheduledStartTimeLocal: true,
      timezone: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      status: true,
      outcomeUnderDispute: true,
    },
  });
  return rows.map((row) => ({ enrollmentId: row.enrollmentId, ...sessionRowOf(row) }));
}

/**
 * A session as its party reads it (T011, FR-434): the session's own columns, the sequence number of
 * the session a make-up is for, and its two parties, so the caller can name the counterparty.
 */
export interface PartySessionRow {
  readonly id: string;
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly sequenceNumber: number;
  /** The sequence number of the session this one makes up for; null for an ordinary session. */
  readonly makeupForSequenceNumber: number | null;
  readonly localDate: LocalDate;
  /** `HH:MM:SS`, as the `time` column holds it. */
  readonly startTimeLocal: LocalTime;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: SessionStatus;
}

/**
 * The session `sessionId` when `userId` is its student or its teacher, else null: another person's
 * session and a nonexistent one answer alike (T011, R-GENDER-2), a soft-deleted one left out by the
 * client's extension. By the primary key, the party in the same statement. Takes no lock: the join
 * locks both accounts and reads it again under them (contracts/kernel.md, the `sessions.join` row).
 */
export async function sessionOfParty(
  tx: Pick<Transaction, 'session'>,
  sessionId: string,
  userId: string,
): Promise<PartySessionRow | null> {
  const found = await tx.session.findFirst({
    where: { id: sessionId, OR: [{ studentUserId: userId }, { teacherUserId: userId }] },
    select: {
      id: true,
      enrollmentId: true,
      studentUserId: true,
      teacherUserId: true,
      sequenceNumber: true,
      scheduledDateLocal: true,
      scheduledStartTimeLocal: true,
      timezone: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      status: true,
      makeupForSessionId: true,
    },
  });
  if (found === null) return null;
  // The session made up for, read on its own so the client's extension leaves out a soft-deleted
  // one (R-DB-3); by the primary key.
  const madeUpFor =
    found.makeupForSessionId === null
      ? null
      : await tx.session.findFirst({
          where: { id: found.makeupForSessionId },
          select: { sequenceNumber: true },
        });
  return {
    id: found.id,
    enrollmentId: found.enrollmentId,
    studentUserId: found.studentUserId,
    teacherUserId: found.teacherUserId,
    sequenceNumber: found.sequenceNumber,
    makeupForSequenceNumber: madeUpFor?.sequenceNumber ?? null,
    localDate: calendarDateOf(found.scheduledDateLocal),
    startTimeLocal: localTimeOf(found.scheduledStartTimeLocal),
    timezone: found.timezone,
    startsAt: found.scheduledStartAt,
    endsAt: found.scheduledEndAt,
    status: found.status,
  };
}

/**
 * Locks a session's two accounts, `FOR UPDATE`, in id order, in one statement (T011; the
 * `sessions.join` row of contracts/kernel.md): the accounts' place of the one order, and nothing
 * else, since the join locks no session and writes nothing. A `sessions` row references both
 * accounts by a foreign key, so sessions takes them through `lockRows` only, reading no column of
 * `users` (`platform/db/row-lock.ts`, the owner's decision of 2026-11-02).
 */
export async function lockSessionParties(
  tx: Transaction,
  userIds: readonly string[],
): Promise<void> {
  await lockRows(tx, 'users', userIds);
}

/** 005:T017: a scheduled session as the reminder sweep reads it (R-407). */
export interface SessionToRemind {
  readonly id: string;
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly startsAt: Date;
}

/**
 * 005:T017 (R-407): a page of the `scheduled` sessions whose `scheduled_end_at` lies in
 * `(after, upTo]`, in id order after `cursor`, at most `limit`; no lock. Served by ERD §14's partial
 * index `sessions_scheduled_end_at_scheduled_idx` (`WHERE status = 'scheduled'`), so no index is added
 * (R-DB-9); the caller filters on the start instant. A soft-deleted session is left out by the
 * client's extension (T148). The instants are the committed ones, so a start recomputed by
 * `reresolve-session-instants` is read as it now stands.
 */
export async function scheduledEndingWithin(
  tx: Pick<Transaction, 'session'>,
  window: { readonly after: Date; readonly upTo: Date },
  cursor: string | undefined,
  limit: number,
): Promise<readonly SessionToRemind[]> {
  const rows = await tx.session.findMany({
    where: {
      status: 'scheduled',
      scheduledEndAt: { gt: window.after, lte: window.upTo },
      ...(cursor === undefined ? {} : { id: { gt: cursor } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      enrollmentId: true,
      teacherUserId: true,
      studentUserId: true,
      scheduledStartAt: true,
    },
  });
  return rows.map(({ scheduledStartAt, ...session }) => ({
    ...session,
    startsAt: scheduledStartAt,
  }));
}
