// T023 of specs/004-sessions/tasks.md (FR-460; contracts/kernel.md, the row «an administrator's
// `sessions.cancel`»): the one read of an administrator's cancellation on sessions' own table. The
// lock, the cancelling update and the event are `remaining-sessions.repository.ts`' and
// `session-events.repository.ts`', the ones every cancellation uses; the rule is
// `session-cancel.service.ts`'.
import type { SessionStatus } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';

/** A session as the cancellation decides on it: its enrollment and its status. */
export interface SessionToCancel {
  readonly id: string;
  readonly enrollmentId: string;
  readonly status: SessionStatus;
}

/**
 * The session, with no lock; null when there is none, a soft-deleted one left out by the client's
 * extension (T148). Read first to learn the enrollment to lock, then again under the locks.
 */
export function sessionToCancel(
  tx: Pick<Transaction, 'session'>,
  sessionId: string,
): Promise<SessionToCancel | null> {
  return tx.session.findUnique({
    where: { id: sessionId },
    select: { id: true, enrollmentId: true, status: true },
  });
}
