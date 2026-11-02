// T020 (R-207, FR-312, FR-318): booking's answers to catalog's `CatalogUse` port, bound in
// `main.ts`. Queries only, each on the caller's transaction, and no lock: the caller holds its
// locks before it asks (T005's rule 1, lock then read). A soft-deleted enrollment is left out by
// the client's extension (T148).
//
// Whether a slot is in use is R-205's occupancy since T026 (`slot-occupancy.service.ts`): an active
// hold or an enrollment `pending_payment`, or a `confirmed` one until its slot's release, the week
// after its last session plus `slot_release_buffer_weeks` (FR-BOOK-10).
import type { Transaction } from '../../platform/db/prisma.repository.js';

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
