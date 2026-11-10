// T025 of specs/004-sessions/tasks.md (FR-459; SRS FR-CANCEL-5; contracts/admin-surface.md,
// `users.get`; plan.md decision 8): the cancellation requests a user made, counted over
// `cancellation_requests`, sessions' own table (R-API-6), on the caller's transaction.
//
// Counted from the rows, never stored (R-DB-4): every request whose `requested_by_user_id` is the
// user, whatever its status and whatever became of its session, and of them those made at or after
// `recentSince`. Nothing joins `users`, so a deleted user's requests are counted as before.
//
// No lock and no write: nothing is decided on the counts. No index is added (R-DB-9): both counts
// read `cancellation_requests_requested_by_user_id_idx`, bounded by one user's requests.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'cancellationRequest'>;

/** The requests a user made, in total and since an instant. */
export interface CancellationRequestCounts {
  readonly total: number;
  readonly recent: number;
}

/** The user's requests, all of them and those made at or after `recentSince` (`created_at`). */
export async function cancellationRequestCountsOf(
  tx: Client,
  userId: string,
  recentSince: Date,
): Promise<CancellationRequestCounts> {
  const total = await tx.cancellationRequest.count({ where: { requestedByUserId: userId } });
  const recent = await tx.cancellationRequest.count({
    where: { requestedByUserId: userId, createdAt: { gte: recentSince } },
  });
  return { total, recent };
}
