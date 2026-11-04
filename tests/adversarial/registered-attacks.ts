// T011, T028: every registration of the adversarial procedure harness (`procedure-harness.ts`), run
// by `procedure-harness.spec.ts` in both directions against the real user surface (FR-410, SC-304).
// A registration lives in a module of its own beside its world; this list is the one the coverage
// spec reads, so a procedure of the `discovery`, `booking`, `checkout` or `enrollments` router that
// is not listed here fails it. T032 adds `booking.slots` as its router lands; T043 the checkout and
// enrollments procedures. T036 adds `checkout.hold` and `checkout.retry` as their router lands, and
// T049 `enrollments.list` and `enrollments.get`.
import { bookingAttacks } from './booking.attacks.js';
import { checkoutAttacks } from './checkout.attacks.js';
import { discoveryAttacks } from './discovery.attacks.js';
import { enrollmentsAttacks } from './enrollments.attacks.js';
import type { ProcedureAttacks } from './procedure-harness.js';

export const registeredAttacks: readonly ProcedureAttacks[] = [
  ...discoveryAttacks,
  ...bookingAttacks,
  ...checkoutAttacks,
  ...enrollmentsAttacks,
];
