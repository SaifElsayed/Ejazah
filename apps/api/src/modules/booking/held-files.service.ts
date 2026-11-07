// T004 of specs/004-sessions/tasks.md (FR-487; SRS FR-AUTH-14 as amended; research R-327;
// contracts/kernel.md, "The composition root"; the owner's decision of 2026-11-05): whose files an
// open matter holds. A deleted person's photo and documents are kept while the person is a party of
// an enrollment with an open `disputes` row of any kind (a session dispute, a compensation case, a
// complaint), so an administrator can still see them inside it.
//
// Booking reads its own `enrollments` and asks moderation's entry which of them have an open
// matter, so neither module reads the other's table (R-API-6). Identity's deletion asks it through
// its `FileHold` port and the `erase-deleted-files` job through its `held` option, both bound in
// `main.ts` and `worker.ts`, since identity importing booking would close a cycle. No lock: the
// answer decides only whether files are removed now or by a later run.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { enrollmentsWithOpenMatterAmong } from '../moderation/index.js';
import { enrollmentPartiesAmong } from './held-files.repository.js';

/** Of `userIds`, those a party of an enrollment with an open matter. */
export async function heldFileOwnersAmong(
  tx: Pick<Transaction, 'enrollment' | 'dispute'>,
  userIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const asked = new Set(userIds);
  const enrollments = await enrollmentPartiesAmong(tx, [...asked]);
  if (enrollments.length === 0) return new Set();
  const open = await enrollmentsWithOpenMatterAmong(
    tx,
    enrollments.map(({ id }) => id),
  );
  const held = new Set<string>();
  for (const { id, studentUserId, teacherUserId } of enrollments) {
    if (!open.has(id)) continue;
    for (const party of [studentUserId, teacherUserId]) if (asked.has(party)) held.add(party);
  }
  return held;
}
