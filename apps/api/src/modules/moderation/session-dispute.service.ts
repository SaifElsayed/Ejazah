// T026 of specs/004-sessions/tasks.md (FR-473, FR-474, FR-495; research R-308; contracts/kernel.md,
// the «dispute raised» row): moderation's side of a participant's dispute of a session. Sessions
// decides whether the session may be disputed (`modules/sessions/dispute-raise.service.ts`) and asks
// this module, the owner of `disputes` (R-API-6), to open the row; sessions marks its own session
// `disputed` and writes its `session_events` row on the same transaction.
//
// LOCKS. The caller holds, in T005's one order, the raiser's `users` row, the session's enrollment
// and the session before it calls, since the row references all three (kernel.md: «the dispute
// references the raiser, locked first»). This takes none. At most one dispute of a session is open:
// the database holds it (rule 46, `disputes_one_open_per_session_key`), the caller's read under the
// session's lock being the first line; a second open one is answered null, never a second row.
//
// A dispute carries no amount (R-MONEY-6): an administrator resolves it (T034), outside this file.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { insertSessionDispute, type NewSessionDispute } from './session-dispute.repository.js';

/**
 * Opens the session's dispute, `open`, raised by the participant with their reason, on the caller's
 * transaction after its locks (above); its id, or null when one is already open, the transaction
 * then aborted, for the caller to refuse `DISPUTE_OPEN` and roll back.
 */
export function openSessionDispute(
  tx: Transaction,
  dispute: NewSessionDispute,
): Promise<string | null> {
  return insertSessionDispute(tx, dispute);
}
