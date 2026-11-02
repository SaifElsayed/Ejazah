// T035 (FR-362, FR-375, FR-DISPUTE-5; the owner's decisions of 2026-11-01, PR #109's review round
// 2): the system opens a compensation case on an enrollment, for a reason of a closed list, written
// to `disputes.reason` (no new column). One open case per enrollment and reason: a call while that
// case is open opens no second one and joins it (a second duplicate payment adds to the open
// `duplicate_payment` case, whose enrollment's paid orders the monitor lists, T052); a call after it
// was resolved or dismissed opens a new one; each reason is a case of its own. The case carries no
// amount (R-MONEY-6): an administrator decides it, outside this function (FR-DISPUTE-6).
//
// LOCKS (T005's rules). Nothing in the database keeps one open case per enrollment and reason, so
// the function locks the enrollment's row first and only then reads the open case (rule 1, lock then
// read): a second call for the same enrollment waits until the first commits, then reads its case
// and joins it. The insert references the enrollment, already locked, and no `users` row: the
// system raises the case, so `raised_by_user_id` stays NULL (ERD §10), and a session dispute's
// `session_id` stays NULL. In T005's order the enrollment comes after the accounts, the teacher's
// profile, the slot and the hold, so a caller may already hold any of those, and the enrollment's
// own row (the lock is then the one it holds). A caller must not hold a `payments` row's lock, nor
// another enrollment's with a greater id, when it calls (rule 2, one order, id order in a table).
// A path that closes a case (Phase 3's resolution) takes the enrollment's lock before it writes, or
// a call could join a case the same moment it is closed.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { insertCase, lockCasesOf, openCaseOf } from './compensation-case.repository.js';

/** Why the system opened a case: the closed list `disputes.reason` takes for a compensation case. */
export const COMPENSATION_REASONS = [
  // FR-362: the database refused a late paid event's confirmation (FR-PAYG-19).
  'slot_unavailable',
  // FR-362: a party's account was restricted (R-219), or failed the parties' check before a late
  // confirmation (`isBookablePair`).
  'party_restricted',
  // FR-375: a second paid order on an enrollment already confirmed.
  'duplicate_payment',
] as const;

export type CompensationReason = (typeof COMPENSATION_REASONS)[number];

/** The enrollment's open case of that reason, and whether this call opened it. */
export interface CompensationCase {
  readonly caseId: string;
  readonly opened: boolean;
}

/**
 * Opens the enrollment's compensation case of `reason`, or joins the one already open, on the
 * caller's transaction. Locks the enrollment's row first (see LOCKS above).
 */
export async function openCompensationCase(
  tx: Transaction,
  enrollmentId: string,
  reason: CompensationReason,
): Promise<CompensationCase> {
  await lockCasesOf(tx, enrollmentId);
  const open = await openCaseOf(tx, enrollmentId, reason);
  if (open !== null) return { caseId: open, opened: false };
  return { caseId: await insertCase(tx, enrollmentId, reason), opened: true };
}
