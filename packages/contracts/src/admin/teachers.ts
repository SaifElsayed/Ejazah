// T068: the administrator surface's `teachers` namespace (admin-surface.md "`teachers` — an approved
// teacher's standing"; FR-165, FR-142, ADR 0016 D2). Each action carries its mandatory reason
// (screens.md "AdminSuspendDialog"), which reaches the audit log; a revocation's reason is also the
// note the teacher reads on `ApplicationRejected`.
import { z } from 'zod';

import { idempotencyKey } from '../idempotency-key.js';
import { adminReason } from './admins.js';

export const teachersActionInput = z.object({ teacherUserId: z.uuid(), reason: adminReason });

// T072 of specs/004-sessions (FR-502; SRS FR-ADMIN-5 as amended, DEC-66): `teachers.liftBan` (a
// teacher's ban or an applicant's, as `ban` serves both) and `teachers.liftRevocation`, keyed under
// the administrator's idempotency key; each answers `banLiftOutput` (`students.ts`).
export const teachersLiftInput = z.object({
  teacherUserId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

export type TeachersLiftInput = z.infer<typeof teachersLiftInput>;
