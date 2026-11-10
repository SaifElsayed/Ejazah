// T011, T028: every registration of the adversarial procedure harness (`procedure-harness.ts`), run
// by `procedure-harness.spec.ts` in both directions against the real user surface (FR-410, SC-304).
// A registration lives in a module of its own beside its world; this list is the one the coverage
// spec reads, so a procedure of the `discovery`, `booking`, `checkout` or `enrollments` router that
// is not listed here fails it. T032 adds `booking.slots` as its router lands; T043 the checkout and
// enrollments procedures. T036 adds `checkout.hold` and `checkout.retry` as their router lands, and
// T049 `enrollments.list` and `enrollments.get`; T011 of specs/004-sessions `sessions.get` and
// `sessions.join`; T063 `live.events`; T021 `sessions.cancellation.request` and `.answer`; T026
// `sessions.dispute.raise`; T031 `sessions.remedy.choose`, `.accept`, `.counterOptions` and `.counter`.
import { bookingAttacks } from './booking.attacks.js';
import { checkoutAttacks } from './checkout.attacks.js';
import { discoveryAttacks } from './discovery.attacks.js';
import { enrollmentsAttacks } from './enrollments.attacks.js';
import { liveAttacks } from './live.attacks.js';
import type { ProcedureAttacks } from './procedure-harness.js';
import { sessionDisputeAttacks, sessionsAttacks } from './sessions.attacks.js';
import { sessionsCancellationAttacks } from './sessions-cancellation.attacks.js';
import { sessionsRemedyAttacks } from './sessions-remedy.attacks.js';

export const registeredAttacks: readonly ProcedureAttacks[] = [
  ...discoveryAttacks,
  ...bookingAttacks,
  ...checkoutAttacks,
  ...enrollmentsAttacks,
  ...sessionsAttacks,
  ...sessionsCancellationAttacks,
  ...sessionDisputeAttacks,
  ...sessionsRemedyAttacks,
  ...liveAttacks,
];
