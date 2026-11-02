// T011, T028: every registration of the adversarial procedure harness (`procedure-harness.ts`), run
// by `procedure-harness.spec.ts` in both directions against the real user surface (FR-410, SC-304).
// A registration lives in a module of its own beside its world; this list is the one the coverage
// spec reads, so a procedure of the `discovery`, `booking`, `checkout` or `enrollments` router that
// is not listed here fails it. T043 adds the booking, checkout and enrollments procedures.
import { discoveryAttacks } from './discovery.attacks.js';
import type { ProcedureAttacks } from './procedure-harness.js';

export const registeredAttacks: readonly ProcedureAttacks[] = [...discoveryAttacks];
