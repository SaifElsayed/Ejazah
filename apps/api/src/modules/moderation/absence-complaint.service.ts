// T060 of specs/004-sessions/tasks.md (FR-452, FR-495; research R-322, «The complaint»;
// contracts/kernel.md, the row «a student's complaint raised»): moderation's side of a student's
// complaint of the teacher's absence. Sessions decides whether the enrollment may be complained of
// (`modules/sessions/absence-complaint.service.ts`) and asks this module, the owner of `disputes`
// (R-API-6), to open the row; sessions writes its `complaint_raised` event on the same transaction.
// Not a compensation case: a case's reason is a closed list and Phase 2's covering rule reads
// `compensation_case` rows only (`caseInstantsAmong`), which a complaint must not move (ADR 0023 D3).
//
// LOCKS. The caller holds, in T005's one order, the student's `users` row and the enrollment before
// it calls, since the row references both («the complaint references the student, locked first»).
// This takes none. At most one complaint of an enrollment is open: the database holds it (rule 46),
// a second answered null, never a second row. A complaint carries no amount (R-MONEY-6).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { insertAbsenceComplaint } from './absence-complaint.repository.js';

/**
 * Opens the enrollment's complaint, `open`, raised by the student with their reason, on the caller's
 * transaction after its locks (above); its id, or null when one is already open, the transaction
 * then aborted, for the caller to refuse `COMPLAINT_OPEN` and roll back.
 */
export function openAbsenceComplaint(
  tx: Transaction,
  enrollmentId: string,
  studentUserId: string,
  reason: string,
): Promise<string | null> {
  return insertAbsenceComplaint(tx, enrollmentId, studentUserId, reason);
}
