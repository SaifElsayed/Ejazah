// T005 of specs/004-sessions (`002:T144`; FR-421, FR-486; R-313): the administrator surface's
// `students` namespace (admin-surface.md "`students` — a student's standing"). Each action carries its
// mandatory reason, which reaches the audit log (`student.suspend`, `student.ban`,
// `student.reinstate`); each answers nothing. The person's field is `studentUserId`, not the
// contract's first `userId`: a field named `userId` is refused in any input (R-GENDER-4,
// `no-authority-in-input`), as `teacherUserId` and Phase 1's `targetUserId` are named (the owner's
// decision of 2026-11-07).
import { z } from 'zod';

import { adminReason } from './admins.js';

export const studentsActionInput = z.object({ studentUserId: z.uuid(), reason: adminReason });
