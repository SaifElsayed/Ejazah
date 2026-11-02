// T020 (R-207, FR-312, FR-318): booking's answers to catalog's `CatalogUse` port, bound in
// `main.ts`. Queries only, each on the caller's transaction, and no lock: the caller holds its
// locks before it asks (T005's rule 1, lock then read). A soft-deleted enrollment is left out by
// the client's extension (T148).
//
// A slot is in use while an active hold (`released_at IS NULL`, data-model §3) or an enrollment
// `pending_payment` or `confirmed` uses it. A confirmed enrollment counts until its slot's release,
// the week after its last session plus `slot_release_buffer_weeks` (R-205, FR-BOOK-10); that release
// reads the last session through `sessions/index.ts`, which T026 brings, so until then every
// confirmed enrollment counts, the side that refuses an edit rather than allows one.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'slotHold' | 'enrollment'>;

/** Whether an active hold, or an enrollment awaiting payment or confirmed, uses the slot. */
export async function slotInUse(tx: Client, slotId: string): Promise<boolean> {
  const hold = await tx.slotHold.findFirst({
    where: { slotId, releasedAt: null },
    select: { id: true },
  });
  if (hold !== null) return true;
  const enrollment = await tx.enrollment.findFirst({
    where: { slotId, status: { in: ['pending_payment', 'confirmed'] } },
    select: { id: true },
  });
  return enrollment !== null;
}

/**
 * Of `packageIds`, each package's live enrollments in any status and its `confirmed` ones (T018),
 * in one grouped statement, so a teacher's list asks once. A package with none is absent.
 */
export async function packageEnrollmentCounts(
  tx: Pick<Transaction, 'enrollment'>,
  packageIds: readonly string[],
): Promise<ReadonlyMap<string, { readonly total: number; readonly active: number }>> {
  const counts = new Map<string, { total: number; active: number }>();
  if (packageIds.length === 0) return counts;
  const groups = await tx.enrollment.groupBy({
    by: ['packageId', 'status'],
    where: { packageId: { in: [...packageIds] } },
    _count: { _all: true },
  });
  for (const { packageId, status, _count } of groups) {
    const held = counts.get(packageId) ?? { total: 0, active: 0 };
    held.total += _count._all;
    if (status === 'confirmed') held.active += _count._all;
    counts.set(packageId, held);
  }
  return counts;
}

/** Whether any enrollment, in any status, was made on the package. */
export async function packageHasEnrollment(
  tx: Pick<Transaction, 'enrollment'>,
  packageId: string,
): Promise<boolean> {
  const enrollment = await tx.enrollment.findFirst({
    where: { packageId },
    select: { id: true },
  });
  return enrollment !== null;
}
