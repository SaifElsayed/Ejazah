// T014 of specs/004-sessions/tasks.md (R-SESS-2, R-SESS-3; research R-306, R-308, R-313): the
// evaluation's queries over `sessions` and `session_participant_events`, each on the caller's
// transaction. The rules (which sessions, the locks, the order, the outcome) are
// `evaluation.service.ts`'. A soft-deleted session is left out of every read and write by the
// client's extension (T148).
//
// The settlement is a conditional update on the state the service read under its locks: a session
// still unevaluated and still in the status it was read in, so one another run or path moved
// meanwhile is left as it is.
import type { SessionStatus } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { AttendanceEvent, AttendanceOutcome } from './attendance.rules.js';
import { TIME_FREEING_STATUSES } from './sessions.repository.js';

type Client = Pick<Transaction, 'session' | 'sessionParticipantEvent'>;

/** The statuses the evaluation settles from: never evaluated, or disputed before it (R-308). */
const EVALUATED_FROM = ['scheduled', 'disputed'] as const;

/** A session as the settlement decides on it. */
export interface SessionToSettle {
  readonly id: string;
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date;
  readonly status: SessionStatus;
  readonly evaluatedAt: Date | null;
}

/** What one settlement writes: from the status it was read in, the outcome and its figures. */
export interface Settlement {
  readonly id: string;
  readonly from: (typeof EVALUATED_FROM)[number];
  readonly outcome: AttendanceOutcome;
  readonly simultaneousSeconds: number;
  readonly evaluatedAt: Date;
}

/**
 * The sessions due by `dueBy`: `evaluated_at` NULL, `scheduled` or `disputed`, the scheduled end at
 * or before `dueBy` (the database's clock less the delay), in id order after `after`, at most
 * `limit`; no lock. The `scheduled` ones are served by the partial index
 * `sessions_scheduled_end_at_scheduled_idx` (ERD §14); the disputed ones are few.
 */
export async function dueForEvaluation(
  tx: Client,
  dueBy: Date,
  after: string | undefined,
  limit: number,
): Promise<readonly { readonly id: string; readonly enrollmentId: string }[]> {
  return tx.session.findMany({
    where: {
      evaluatedAt: null,
      status: { in: [...EVALUATED_FROM] },
      scheduledEndAt: { lte: dueBy },
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, enrollmentId: true },
  });
}

/** The session `id` as the settlement decides on it; the caller holds its lock. */
export async function sessionToSettle(tx: Client, id: string): Promise<SessionToSettle | null> {
  return tx.session.findUnique({
    where: { id },
    select: {
      id: true,
      enrollmentId: true,
      teacherUserId: true,
      studentUserId: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      status: true,
      evaluatedAt: true,
    },
  });
}

/**
 * The session's recorded attendance events as T013 reads them: `event_type` as `kind`, a
 * participant's with its `user_id` and `connection_ref` (never NULL on them, ERD §15 rule 41), in
 * the provider's order. Over the `session_id` index; bounded by what the webhook recorded for the
 * session's two participants.
 */
export async function attendanceEventsOf(
  tx: Client,
  sessionId: string,
): Promise<readonly AttendanceEvent[]> {
  const rows = await tx.sessionParticipantEvent.findMany({
    where: { sessionId },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { eventType: true, userId: true, connectionRef: true, occurredAt: true },
  });
  const events: AttendanceEvent[] = [];
  for (const { eventType, userId, connectionRef, occurredAt } of rows) {
    if (eventType === 'room_ended') {
      events.push({ kind: 'room_ended', occurredAt });
    } else if (userId !== null && connectionRef !== null) {
      events.push({ kind: eventType, userId, connectionRef, occurredAt });
    }
  }
  return events;
}

/**
 * Writes the settlement where the session is still unevaluated and in the status it was read in:
 * `status` the outcome, or for a disputed one `outcome_under_dispute` (R-308), with
 * `simultaneous_connected_seconds` and `evaluated_at`; whether it moved the row.
 */
export async function settle(tx: Client, settlement: Settlement): Promise<boolean> {
  const { id, from, outcome, simultaneousSeconds, evaluatedAt } = settlement;
  const figures = { simultaneousConnectedSeconds: simultaneousSeconds, evaluatedAt };
  const { count } = await tx.session.updateMany({
    where: { id, status: from, evaluatedAt: null },
    data:
      from === 'disputed'
        ? { outcomeUnderDispute: outcome, ...figures }
        : { status: outcome, ...figures },
  });
  return count === 1;
}

/**
 * The cancelled sessions (`cancelled_by_agreement`, `cancelled_by_admin`) whose join period holds
 * `at`, a start at or before `joinOpensBy` (`at` plus the early-join lead) and an end after `at`,
 * with no `room_ended` row in `session_participant_events` (the note under T014, K6), in id order;
 * no lock. Bounded by the window, a session's length plus the lead wide; no index serves it
 * (R-DB-9 adds none), and the sweep reads it once a minute.
 */
export async function cancelledInJoinPeriod(
  tx: Client,
  at: Date,
  joinOpensBy: Date,
): Promise<readonly string[]> {
  const rows = await tx.session.findMany({
    where: {
      status: { in: [...TIME_FREEING_STATUSES] },
      scheduledStartAt: { lte: joinOpensBy },
      scheduledEndAt: { gt: at },
      participantEvents: { none: { eventType: 'room_ended' } },
    },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}
