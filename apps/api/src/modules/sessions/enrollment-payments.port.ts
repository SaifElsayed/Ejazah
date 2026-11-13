// T073 of specs/004-sessions/tasks.md (FR-507; SRS FR-CANCEL-8 as amended on 2026-11-12, DEC-66;
// research R-322, «The restore», the ninth cause; the note under T073, Q4 (a), Q6 (a), N3): what the
// restore needs of an enrollment's gateway orders, which only the payments module owns. Sessions
// reads no payment table (R-301), and payments imports booking, which imports sessions, so sessions
// may not import payments; sessions asks this port instead. Payments implements it (`refundedOf`,
// `apps/api/src/modules/payments/index.ts`), and `main.ts` hands it to the admin module's
// `createAdminServices` (`AdminServiceDependencies.enrollmentPayments`), which binds it into
// `createRestore`: a dependency handed in against the arrows (docs/ARCHITECTURE.md §4, the tenth).
//
// THE READ, WITH NO LOCK (N3). It runs on the restore's transaction, which holds the enrollment's
// row lock (contracts/kernel.md, the restore's row). Every move of an order takes its enrollment's
// lock before the order's (`apps/api/src/modules/payments/order-events.service.ts:5`), so no order
// can move to `refunded` between this read and the restore's commit.
import type { Transaction } from '../../platform/db/prisma.repository.js';

export interface EnrollmentPayments {
  /** Whether any gateway order of the enrollment is `refunded` (Q4 (a)); with no lock (N3). */
  refundedOf(tx: Transaction, enrollmentId: string): Promise<boolean>;
}
