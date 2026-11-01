// T006: the re-resolution job's deferral of the two session exclusions (ERD §15 rule 19, ADR 0009
// D3, research R-210; specs/003-booking/contracts/kernel.md). When the time zone data changes, every
// scheduled session's instants are recomputed in one transaction; a uniform shift of back-to-back
// sessions overlaps itself until its last row moves, so the check waits for the commit, where only a
// true overlap is refused. Both constraints are DEFERRABLE INITIALLY IMMEDIATE (migration
// `20261007000400_booking_overlap`), so every other write is checked as it happens, and the deferral
// ends with the transaction. It is raw SQL, so it lives in the kernel (R-API-6); only that job calls
// it, on the transaction it already holds.
import type { Transaction } from './prisma.repository.js';

/** Defers `sessions_teacher_no_overlap` and `sessions_student_no_overlap` to the commit of `tx`. */
export async function withDeferredSessionConstraints(
  tx: Pick<Transaction, '$executeRaw'>,
): Promise<void> {
  await tx.$executeRaw`SET CONSTRAINTS sessions_teacher_no_overlap, sessions_student_no_overlap DEFERRED`;
}
