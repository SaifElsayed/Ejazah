// T011, T028: every registration of the adversarial procedure harness (`procedure-harness.ts`), run
// by `procedure-harness.spec.ts` in both directions against the real user surface (FR-410, SC-304).
// A registration lives in a module of its own beside its world; this list is the one the coverage
// spec reads, so a procedure of the `discovery`, `booking`, `checkout` or `enrollments` router that
// is not listed here fails it. T032 adds `booking.slots` as its router lands; T043 the checkout and
// enrollments procedures. T036 adds `checkout.hold` and `checkout.retry` as their router lands, and
// T049 `enrollments.list` and `enrollments.get`; T011 of specs/004-sessions `sessions.get` and
// `sessions.join`; T063 `live.events`; T021 `sessions.cancellation.request` and `.answer`; T026
// `sessions.dispute.raise`; T031 `sessions.remedy.choose`, `.accept`, `.counterOptions` and `.counter`;
// T032 `sessions.remedy.answerCounter`.
import { bookingAttacks } from './booking.attacks.js';
// T009 of specs/005-certification: `certificates.list` and `certificates.link`.
import { certificatesAttacks } from './certificates.attacks.js';
// 005:T011 (B47): `reports.create`.
import { reportsAttacks } from './reports.attacks.js';
// 005:T013 (B47): `genderFlags.raise`.
import { genderFlagsAttacks } from './gender-flags.attacks.js';
// T037 of specs/004-sessions: `chat.list` and `chat.send`; T038 `chat.attachmentLink`.
import { chatAttacks, chatDocumentAttacks } from './chat.attacks.js';
import { checkoutAttacks } from './checkout.attacks.js';
import { discoveryAttacks } from './discovery.attacks.js';
import { enrollmentsAttacks } from './enrollments.attacks.js';
import { liveAttacks } from './live.attacks.js';
import type { Registration } from './procedure-harness.js';
// 006:T007 of specs/006-programme: `programme.offer`.
import { programmeAttacks } from './programme.attacks.js';
// T060: `sessions.complaint.raise`.
import {
  sessionComplaintAttacks,
  sessionDisputeAttacks,
  sessionsAttacks,
} from './sessions.attacks.js';
import { sessionsCancellationAttacks } from './sessions-cancellation.attacks.js';
// 003:T112 (B-M3): `sessions.postpone`.
import { sessionsPostponeAttacks } from './sessions-postpone.attacks.js';
import { sessionsRemedyAttacks } from './sessions-remedy.attacks.js';

// T052 of specs/004-sessions: the registrations of `sessions`, `chat` and `live` are
// `SessionProcedureAttacks`, FR-496's three kinds beside FR-410's five; the others are unchanged.
export const registeredAttacks: readonly Registration[] = [
  ...discoveryAttacks,
  ...bookingAttacks,
  ...checkoutAttacks,
  ...enrollmentsAttacks,
  ...sessionsAttacks,
  ...sessionsCancellationAttacks,
  ...sessionDisputeAttacks,
  ...sessionsRemedyAttacks,
  // T060.
  ...sessionComplaintAttacks,
  // 003:T112 (B-M3).
  ...sessionsPostponeAttacks,
  ...liveAttacks,
  // T037 of specs/004-sessions.
  ...chatAttacks,
  // T038 of specs/004-sessions.
  ...chatDocumentAttacks,
  // T009 of specs/005-certification, registered with the integration's mount of `certificates`.
  ...certificatesAttacks,
  // 005:T011 (B47), registered with the integration's mount of `reports`.
  ...reportsAttacks,
  // 005:T013 (B47), registered with the integration's mount of `genderFlags`.
  ...genderFlagsAttacks,
  // 006:T007 of specs/006-programme, registered with its mount of `programme`.
  ...programmeAttacks,
];
