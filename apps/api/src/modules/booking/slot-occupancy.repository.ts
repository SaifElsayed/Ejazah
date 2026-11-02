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
  readonly confirmed: { readonly enrollmentId: string; readonly timezone: string }[];
}

/**
 * Of `slotIds`, each slot an active hold (`released_at IS NULL`, data-model §3) or an enrollment
 * `pending_payment` or `confirmed` uses, with its confirmed enrollments and the zone each snapshot
 * its slot in; a slot nothing uses is absent. Two statements over `slot_holds.slot_id` and
 * `enrollments.slot_id`'s indexes. One active hold per slot (the partial unique index), and a slot's
 * enrollments are the few it has carried, so both reads are bounded by the slots asked about.
 */
export async function slotUses(
  tx: Pick<Transaction, 'slotHold' | 'enrollment'>,
  slotIds: readonly string[],
): Promise<ReadonlyMap<string, SlotUse>> {
  const uses = new Map<string, Gathered>();
  if (slotIds.length === 0) return uses;
  const useOf = (slotId: string): Gathered => {
    const held = uses.get(slotId) ?? { slotId, taken: false, confirmed: [] };
    uses.set(slotId, held);
    return held;
  };
  const holds = await tx.slotHold.findMany({
    where: { slotId: { in: [...slotIds] }, releasedAt: null },
    select: { slotId: true },
  });
  for (const { slotId } of holds) useOf(slotId).taken = true;
  const enrollments = await tx.enrollment.findMany({
    where: { slotId: { in: [...slotIds] }, status: { in: ['pending_payment', 'confirmed'] } },
    orderBy: { id: 'asc' },
    select: { id: true, slotId: true, status: true, snapshotSlotTimezone: true },
  });
  for (const { id, slotId, status, snapshotSlotTimezone } of enrollments) {
    const use = useOf(slotId);
    if (status === 'pending_payment') use.taken = true;
    else use.confirmed.push({ enrollmentId: id, timezone: snapshotSlotTimezone });
  }
  return uses;
}
