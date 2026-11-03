// T020 (R-207, FR-312, FR-318): what catalog asks about a slot or a package that only booking can
// answer. Booking imports catalog, so catalog may not import booking; its package and slot services
// take this port instead, and `main.ts` binds it to booking's entry, as Phase 1's
// `AccountConsequences` registry binds its subscribers (research R-121 of Phase 1).
//
// Each answer is read on the caller's transaction (`tx`) and takes no lock: the caller takes its
// locks first, in T005's order, and then asks (lock, then read). A slot's edit locks the teacher's
// account and then holds `lockKey('teacher-slots', teacherId)` (R-206); `checkout.hold` locks the
// same account before it inserts, so an edit and a hold cannot cross.
import type { Transaction } from '../../platform/db/prisma.repository.js';

export interface CatalogUse {
  /**
   * Whether an active hold, or an enrollment awaiting payment or confirmed, uses the slot: its
   * day, start time and length then stay as they are (`SLOT_IN_USE`, FR-318).
   */
  slotInUse(tx: Transaction, slotId: string): Promise<boolean>;
  /**
   * Whether any enrollment was made on the package: its track and length then stay as they are
   * (`PACKAGE_FROZEN`, FR-312).
   */
  packageHasEnrollment(tx: Transaction, packageId: string): Promise<boolean>;
  /**
   * Of `packageIds`, each package's enrollments (T018, the teacher's list: `frozen` and
   * `activeEnrollmentCount`), in one question rather than one per package. A package with none is
   * absent from the map.
   */
  packageEnrollmentCounts(
    tx: Transaction,
    packageIds: readonly string[],
  ): Promise<ReadonlyMap<string, PackageEnrollmentCounts>>;
}

/** A package's enrollments as `packageEnrollmentCounts` counts them (T018). */
export interface PackageEnrollmentCounts {
  /** Every live enrollment, any status: the package is frozen once there is one (FR-312). */
  readonly total: number;
  /** The `confirmed` ones, the enrollments under way. */
  readonly active: number;
}
