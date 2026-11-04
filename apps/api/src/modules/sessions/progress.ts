// T049 (FR-392, R-DB-4): an enrollment's progress, derived from its sessions on every read and stored
// nowhere. ERD `enrollments`: the sessions remaining are the snapshot's count less the sessions
// consumed, and consumed are `done` and `student_no_show` (SRS §3.8.3, FR-NOSHOW-1): a teacher's
// absence, both absent, a cancellation, a review or a dispute consumes nothing until it is settled
// so (FR-NOSHOW-2, FR-NOSHOW-6, FR-DISPUTE-4). The sessions module owns what a status means; booking
// hands in the snapshot's count. Pure: no clock is read, the caller passes `now`.
import type { SessionStatus } from '@ijazah/contracts';

import type { EnrollmentSessionRow } from './sessions.repository.js';

/** The statuses that consume a session from the package (SRS §3.8.3). */
const CONSUMED: ReadonlySet<SessionStatus> = new Set(['done', 'student_no_show']);

/** Where an enrollment stands: `next` and `last` absent while it has no such session. */
export interface SessionProgress {
  /** The earliest scheduled session not yet over, the one in progress included. */
  readonly next?: EnrollmentSessionRow;
  /** The final session by sequence number. */
  readonly last?: EnrollmentSessionRow;
  /** The scheduled sessions not yet over. */
  readonly upcoming: number;
  /** The sessions consumed. */
  readonly completed: number;
  /** The snapshot's count less those consumed, never below none. */
  readonly remaining: number;
}

/** The progress of one enrollment's `sessions` at `now`, for a package of `sessionCount`. */
export function sessionProgress(
  sessions: readonly EnrollmentSessionRow[],
  { sessionCount, now }: { readonly sessionCount: number; readonly now: Date },
): SessionProgress {
  const ahead = sessions
    .filter(({ status, endsAt }) => status === 'scheduled' && endsAt.getTime() > now.getTime())
    .toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const completed = sessions.filter(({ status }) => CONSUMED.has(status)).length;
  const last = sessions.reduce<EnrollmentSessionRow | undefined>(
    (latest, one) =>
      latest === undefined || one.sequenceNumber > latest.sequenceNumber ? one : latest,
    undefined,
  );
  const [next] = ahead;
  return {
    ...(next === undefined ? {} : { next }),
    ...(last === undefined ? {} : { last }),
    upcoming: ahead.length,
    completed,
    remaining: Math.max(0, sessionCount - completed),
  };
}
