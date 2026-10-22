// T068: the administrator surface's `teachers` namespace (admin-surface.md "`teachers` — an approved
// teacher's standing"; FR-165, FR-142, ADR 0016 D2). Each action carries its mandatory reason
// (screens.md "AdminSuspendDialog"), which reaches the audit log; a revocation's reason is also the
// note the teacher reads on `ApplicationRejected`.
import { z } from 'zod';

import { adminReason } from './admins.js';

export const teachersActionInput = z.object({ teacherUserId: z.uuid(), reason: adminReason });
