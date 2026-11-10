// T026 (R-205, FR-318, FR-394): what booking's rows say uses each slot, read for the slot's
// occupancy (`slot-occupancy.service.ts`). Queries only, on the caller's transaction, and no lock:
// a path that decides and writes locks first (T005's rule 1), and discovery only reads. A
// soft-deleted enrollment is left out by the client's extension (T148).
import type { Transaction } from '../../platform/db/prisma.repository.js';
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
 */
export async function slotUses(
  tx: Pick<Transaction, 'slotHold' | 'enrollment'>,
  slotIds: readonly string[],
  exceptEnrollmentId?: string,
): Promise<ReadonlyMap<string, SlotUse>> {
  const uses = new Map<string, Gathered>();
  if (slotIds.length === 0) return uses;
  const useOf = (slotId: string): Gathered => {
    const held = uses.get(slotId) ?? { slotId, taken: false, completed: [] };
    uses.set(slotId, held);
    return held;
  };
  const holds = await tx.slotHold.findMany({
    where: { slotId: { in: [...slotIds] }, releasedAt: null },
    select: { slotId: true },
  });
  for (const { slotId } of holds) useOf(slotId).taken = true;
  const enrollments = await tx.enrollment.findMany({
    where: {
      slotId: { in: [...slotIds] },
      status: { in: ['pending_payment', 'confirmed', 'completed'] },
      ...(exceptEnrollmentId === undefined ? {} : { id: { not: exceptEnrollmentId } }),
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
  return uses;
}
