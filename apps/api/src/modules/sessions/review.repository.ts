// T033 of specs/004-sessions/tasks.md (FR-446, FR-450, FR-477; R-SESS-6; research R-323 GAP-2;
// contracts/admin-surface.md, `sessions.review.*`): the review queue's reads of sessions' own tables.
// The rule is `review.service.ts`'; the outcome's write is `admin-outcome.service.ts`'.
//
// No lock here. The queue and the telemetry decide nothing; the resolution reads its session again
// under the enrollment's and the session's locks, which its service takes (kernel.md's row
// «evaluation, a review or dispute resolution»).
import type { SessionStatus } from '@ijazah/contracts';
import {
  calendarDateOf,
  type Interval,
  type LocalDate,
  type LocalTime,
  localTimeOf,
} from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';

/** The two statuses the review queue holds (R-SESS-6). */
export const REVIEW_STATUSES = ['under_threshold', 'provider_outage'] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** One session of the queue, as the list shows it. */
export interface QueuedSession {
  readonly id: string;
  readonly enrollmentId: string;
  readonly status: ReviewStatus;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly simultaneousSeconds: number;
  readonly studentUserId: string;
  readonly teacherUserId: string;
}

/**
 * The queue's sessions after `after` in id order (time-ordered, the oldest first), at most `limit`;
 * no lock. A scan of `sessions` by status, which no index covers (R-DB-9: none added before a
 * measured slow query); a soft-deleted session left out by the client's extension.
 */
export async function queuedSessions(
  tx: Pick<Transaction, 'session'>,
  after: string | undefined,
  limit: number,
): Promise<readonly QueuedSession[]> {
  const rows = await tx.session.findMany({
    where: {
      status: { in: [...REVIEW_STATUSES] },
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      enrollmentId: true,
      status: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      simultaneousConnectedSeconds: true,
      studentUserId: true,
      teacherUserId: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    enrollmentId: row.enrollmentId,
    status: row.status as ReviewStatus,
    startsAt: row.scheduledStartAt,
    endsAt: row.scheduledEndAt,
    simultaneousSeconds: row.simultaneousConnectedSeconds,
    studentUserId: row.studentUserId,
    teacherUserId: row.teacherUserId,
  }));
}

/** A session as its telemetry shows it: its schedule, status, parties and recorded figure. */
export interface TelemetrySession {
  readonly id: string;
  readonly enrollmentId: string;
  readonly localDate: LocalDate;
  readonly startTimeLocal: LocalTime;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: SessionStatus;
  /** The outcome frozen beside a `disputed` status (R-308); null otherwise or before the evaluation. */
  readonly outcomeUnderDispute: SessionStatus | null;
  readonly simultaneousSeconds: number;
  readonly studentUserId: string;
  readonly teacherUserId: string;
}

/** The session, with no lock; null when there is none (a soft-deleted one left out, T148). */
export async function telemetrySession(
  tx: Pick<Transaction, 'session'>,
  sessionId: string,
): Promise<TelemetrySession | null> {
  const row = await tx.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      enrollmentId: true,
      scheduledDateLocal: true,
      scheduledStartTimeLocal: true,
      timezone: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      status: true,
      outcomeUnderDispute: true,
      simultaneousConnectedSeconds: true,
      studentUserId: true,
      teacherUserId: true,
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    localDate: calendarDateOf(row.scheduledDateLocal),
    startTimeLocal: localTimeOf(row.scheduledStartTimeLocal),
    timezone: row.timezone,
    startsAt: row.scheduledStartAt,
    endsAt: row.scheduledEndAt,
    status: row.status,
    outcomeUnderDispute: row.outcomeUnderDispute,
    simultaneousSeconds: row.simultaneousConnectedSeconds,
    studentUserId: row.studentUserId,
    teacherUserId: row.teacherUserId,
  };
}

/** A recorded outage window, with its id. */
export interface RecordedOutage extends Interval {
  readonly id: string;
}

/** The `provider_outages` windows overlapping `window`, in id order; no lock. */
export function outagesOver(
  tx: Pick<Transaction, 'providerOutage'>,
  window: Interval,
): Promise<readonly RecordedOutage[]> {
  return tx.providerOutage.findMany({
    where: { startsAt: { lt: window.endsAt }, endsAt: { gt: window.startsAt } },
    orderBy: { id: 'asc' },
    select: { id: true, startsAt: true, endsAt: true },
  });
}

/** A session as a resolution decides on it, read under the caller's locks. */
export interface SessionToResolve {
  readonly id: string;
  readonly enrollmentId: string;
  readonly status: SessionStatus;
  /** The outcome frozen beside a `disputed` status (R-308); null otherwise or before the evaluation. */
  readonly outcomeUnderDispute: SessionStatus | null;
  /** The session's own copies of its two accounts (ADR 0010), never changed. */
  readonly studentUserId: string;
  readonly teacherUserId: string;
}

/** The session, with no lock (the caller's locks make the second read the decision's). */
export function sessionToResolve(
  tx: Pick<Transaction, 'session'>,
  sessionId: string,
): Promise<SessionToResolve | null> {
  return tx.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      enrollmentId: true,
      status: true,
      outcomeUnderDispute: true,
      studentUserId: true,
      teacherUserId: true,
    },
  });
}
