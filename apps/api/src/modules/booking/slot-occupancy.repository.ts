// T026 (R-205, FR-318, FR-394): what booking's rows say uses each slot, read for the slot's
// occupancy (`slot-occupancy.service.ts`). Queries only, on the caller's transaction, and no lock:
// a path that decides and writes locks first (T005's rule 1), and discovery only reads. A
// soft-deleted enrollment is left out by the client's extension (T148).
//
// T070 of specs/004-sessions (FR-503; SRS FR-CANCEL-9, DEC-69; the note under T070, Q4 (a), N10):
// a closed enrollment holds its slot through the window of its closing. Read with no lock, as the
// rest: discovery only reads, and `placeHold` reads under the slot's lock, which the release
// (`enrollments.releaseSlot`) and the restore take too; a case that closes meanwhile takes the
// enrollment's lock (`moderation/compensation-case.service.ts`, «CLOSING A CASE»), so a read that
// raced it sees the slot still held: a conservative refusal, never a double booking (B42a's conflict
// check, §3).
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { compensationCasesOf } from '../moderation/index.js';
import { closingOf, latestEndCaseOf, restorableUntil, type WindowDays } from '../sessions/index.js';
import type { SlotUse } from './slot-occupancy.service.js';

/** A slot's use while its rows are read. */
interface Gathered {
  readonly slotId: string;
  taken: boolean;
  readonly completed: { readonly enrollmentId: string; readonly timezone: string }[];
}

/**
 * Of `slotIds`, each slot an active hold (`released_at IS NULL`, data-model §3) or an enrollment
 * `pending_payment`, `confirmed` or `completed` uses, with its completed enrollments (held until
 * R-205's release) and the zone each snapshot its slot in; a slot nothing uses is absent. A
 * `pending_payment` or `confirmed` enrollment takes its slot whatever the date: a package's slot
 * returns only once the package is completed, its make-ups part of it (FR-BOOK-10, FR-394, FR-423
 * as amended on 2026-11-10, the owner's rule; the follow-up under T027). A completed enrollment
 * frees its slot from the week after its final session plus `slot_release_buffer_weeks` (T015 of
 * specs/004-sessions; the note under 003:T026, nit 6). Two statements over `slot_holds.slot_id` and
 * `enrollments.slot_id`'s indexes. One active hold per slot (the partial unique index), and a slot's
 * enrollments are the few it has carried, so both reads are bounded by the slots asked about.
 * `exceptEnrollmentId`, when given, leaves that enrollment's own use out: a make-up or a restore
 * asks whether another enrollment uses its slot (T008 of specs/004-sessions, `slotWeekTaken`; the
 * owner's decision of 2026-11-07 on lane C's questions).
 *
 * T070: a slot no hold or enrollment above takes is taken, on every date, while a closed enrollment
 * on it (`cancelled` with `confirmed_at` set, or `terminated_no_show`; `exceptEnrollmentId`'s own
 * left out) has `slot_released_at` NULL, a closing the one closing rule admits with its case open
 * (sessions' `closingOf`, its latest end case read through moderation's entry), and the hold of that
 * closing still running: the case's opening plus its kind's window (`restorableUntil`, the windows
 * read through `windowDays`), against the database's clock. A third statement over the same index,
 * bounded by the slots asked about, then one read of cases per such enrollment, in id order, until
 * its slot is found held; none when no closed enrollment is on a free slot.
 */
export async function slotUses(
  tx: Transaction,
  slotIds: readonly string[],
  windowDays: WindowDays,
  exceptEnrollmentId?: string,
): Promise<ReadonlyMap<string, SlotUse>> {
  const uses = new Map<string, Gathered>();
  if (slotIds.length === 0) return uses;
  const useOf = (slotId: string): Gathered => {
    const held = uses.get(slotId) ?? { slotId, taken: false, completed: [] };
    uses.set(slotId, held);
    return held;
  };
  const except = exceptEnrollmentId === undefined ? {} : { id: { not: exceptEnrollmentId } };
  const holds = await tx.slotHold.findMany({
    where: { slotId: { in: [...slotIds] }, releasedAt: null },
    select: { slotId: true },
  });
  for (const { slotId } of holds) useOf(slotId).taken = true;
  const enrollments = await tx.enrollment.findMany({
    where: {
      slotId: { in: [...slotIds] },
      status: { in: ['pending_payment', 'confirmed', 'completed'] },
      ...except,
    },
    orderBy: { id: 'asc' },
    select: { id: true, slotId: true, status: true, snapshotSlotTimezone: true },
  });
  for (const { id, slotId, status, snapshotSlotTimezone } of enrollments) {
    const use = useOf(slotId);
    if (status === 'completed')
      use.completed.push({ enrollmentId: id, timezone: snapshotSlotTimezone });
    else use.taken = true;
  }
  // T070: the held closings, on the slots still free.
  const free = slotIds.filter((slotId) => uses.get(slotId)?.taken !== true);
  if (free.length === 0) return uses;
  const closed = await tx.enrollment.findMany({
    where: {
      slotId: { in: free },
      confirmedAt: { not: null },
      slotReleasedAt: null,
      OR: [
        { status: 'terminated_no_show' },
        { status: 'cancelled', cancellationReason: { in: ['admin', 'teacher_suspended'] } },
      ],
      ...except,
    },
    orderBy: { id: 'asc' },
    select: { id: true, slotId: true, status: true, cancellationReason: true },
  });
  if (closed.length === 0) return uses;
  const now = await clockTimestamp(tx);
  for (const { id, slotId, status, cancellationReason } of closed) {
    if (uses.get(slotId)?.taken === true) continue;
    const closing = closingOf({
      status,
      lastCancellationReason: cancellationReason,
      endCase: latestEndCaseOf(await compensationCasesOf(tx, id)),
    });
    if (closing === undefined || !closing.restorable) continue;
    const until = await restorableUntil(closing.closingCase.createdAt, closing.kind, windowDays);
    if (now.getTime() < until.getTime()) useOf(slotId).taken = true;
  }
  return uses;
}
