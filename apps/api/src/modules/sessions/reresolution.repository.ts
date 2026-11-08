// T048 (R-210, FR-370, ERD §15 rule 19): the re-resolution run's queries over `sessions`, on the
// job's one transaction (the rules are `reresolution.service.ts`'s). A soft-deleted session is left
// out of every read and write by the client's extension (T148). T014: the locks the run takes (the
// kernel's `lockRows`: the `enrollments` rows its `session_events` rows reference by a foreign key,
// then the `sessions` rows), the read again under them, and T004's writer for its rows.
import { calendarDateOf, localTimeOf } from '@ijazah/time';

import { lockRows } from '../../platform/db/row-lock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type {
  PartiedSession,
  ReresolutionStore,
  SessionInstants,
  SessionSchedule,
} from './reresolution.service.js';
import { recordSessionEvents } from './session-events.repository.js';
import { TIME_FREEING_STATUSES } from './sessions.repository.js';

/** A page of the scheduled sessions in id order after `after`, over the primary key. */
async function scheduledAfter(
  tx: Pick<Transaction, 'session'>,
  after: string | undefined,
  limit: number,
): Promise<readonly SessionSchedule[]> {
  const rows = await tx.session.findMany({
    where: { status: 'scheduled', ...(after === undefined ? {} : { id: { gt: after } }) },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      teacherUserId: true,
      studentUserId: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      enrollmentId: true,
      scheduledDateLocal: true,
      scheduledStartTimeLocal: true,
      timezone: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    scheduledDateLocal: calendarDateOf(row.scheduledDateLocal),
    scheduledStartTimeLocal: localTimeOf(row.scheduledStartTimeLocal),
  }));
}

/**
 * Of `ids`, the sessions still `scheduled`, in id order, over the primary key; read under the run's
 * locks. Bounded by the ids given, a page of the run's.
 */
async function scheduledAmong(
  tx: Pick<Transaction, 'session'>,
  ids: readonly string[],
): Promise<readonly SessionSchedule[]> {
  if (ids.length === 0) return [];
  const rows = await tx.session.findMany({
    where: { id: { in: [...ids] }, status: 'scheduled' },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      teacherUserId: true,
      studentUserId: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      enrollmentId: true,
      scheduledDateLocal: true,
      scheduledStartTimeLocal: true,
      timezone: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    scheduledDateLocal: calendarDateOf(row.scheduledDateLocal),
    scheduledStartTimeLocal: localTimeOf(row.scheduledStartTimeLocal),
  }));
}

/**
 * Each session's instants, written only where the session is still `scheduled` (a conditional
 * update, so one settled meanwhile is left); answers the ids written. One statement per session,
 * since each carries its own instants; the run is rare (a change of the time zone data).
 */
async function setInstants(
  tx: Pick<Transaction, 'session'>,
  sessions: readonly SessionInstants[],
): Promise<readonly string[]> {
  const counts = await Promise.all(
    sessions.map(({ id, scheduledStartAt, scheduledEndAt }) =>
      tx.session.updateMany({
        where: { id, status: 'scheduled' },
        data: { scheduledStartAt, scheduledEndAt },
      }),
    ),
  );
  return sessions.filter((_, index) => counts[index]?.count === 1).map(({ id }) => id);
}

/**
 * The sessions the overlap constraints count (every status but the two cancellations) that overlap
 * one of `sessions` for its teacher or its student, other than that session itself: `start <
 * other.end AND end > other.start`, the half-open ranges of rule 19, over the `teacher_user_id` and
 * `student_user_id` indexes. Bounded by `sessions`' count and what overlaps them.
 */
async function countedOverlapping(
  tx: Pick<Transaction, 'session'>,
  sessions: readonly PartiedSession[],
): Promise<readonly PartiedSession[]> {
  if (sessions.length === 0) return [];
  return tx.session.findMany({
    where: {
      status: { notIn: [...TIME_FREEING_STATUSES] },
      OR: sessions.map((session) => ({
        id: { not: session.id },
        OR: [{ teacherUserId: session.teacherUserId }, { studentUserId: session.studentUserId }],
        scheduledStartAt: { lt: session.scheduledEndAt },
        scheduledEndAt: { gt: session.scheduledStartAt },
      })),
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      teacherUserId: true,
      studentUserId: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
    },
  });
}

/** The run's store over the `sessions` table. */
export const reresolutionStore: ReresolutionStore = {
  scheduledAfter,
  lockEnrollments: (tx, ids) => lockRows(tx, 'enrollments', ids),
  lockSessions: (tx, ids) => lockRows(tx, 'sessions', ids),
  scheduledAmong,
  setInstants,
  countedOverlapping,
  recordEvents: recordSessionEvents,
};
