// T007 of specs/005-certification: the administrator surface's `ijazahRequests` namespace
// (contracts/admin-surface.md, `ijazahRequests.*`; FR-604, FR-605, FR-628; research R-402). The
// administrator sees each request with the certificate as it was frozen at send, the teacher's
// current standing and its reason (FR-628), and a signed link to the frozen signature, never the
// copy's key (R-SEC-3); approves it (one ijazah, its number answered) or rejects it with a reason.
// Both decisions are keyed (`idempotencyKey`). T010 and T032 add `ijazahs.*` to this file.
import { z } from 'zod';

import { language } from '../account.js';
import { subjectSummary } from '../catalog.js';
import { idempotencyKey } from '../idempotency-key.js';
import { ijazahRequestStatus } from '../ijazah-requests.js';
import { calendarDate } from '../onboarding.js';
import { adminReason } from './admins.js';

/** A decision's refusals, CONFLICT with this code: the request is no longer pending, or the student is barred (FR-610). */
export const ijazahDecisionRefusal = z.enum(['not_pending', 'student_barred']);

/** The teacher's standing now (FR-628): the account's state, the approval's, or the account gone. */
export const teacherStandingStatus = z.enum([
  'active',
  'verification_required',
  'suspended',
  'revoked',
  'banned',
  'deleted',
]);

/** The standing, with the reason of its latest entry in the audit log where there is one (FR-628). */
export const teacherStanding = z.object({
  status: teacherStandingStatus,
  reason: z.string().optional(),
});

/** A certificate number as stored: 16 Crockford base32 symbols, no separators (FR-605). */
export const certificateNumber = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{16}$/);

/** A party of the request; the name is null once the account is deleted (FR-426's stand-in). */
const party = z.object({ userId: z.uuid(), displayName: z.string().nullable() });

/** One generation of the frozen chain: one or more names (ADR 0004 D3). */
const generation = z.array(z.string()).min(1);

export const adminIjazahRequestsListInput = z.object({
  status: ijazahRequestStatus.optional(),
  /** The last request id of the previous page (a UUIDv7, so the order is the order of sending). */
  cursor: z.uuid().optional(),
});

export const adminIjazahRequestsListItem = z.object({
  requestId: z.uuid(),
  enrollmentId: z.uuid(),
  teacher: party,
  student: party,
  subject: subjectSummary,
  status: ijazahRequestStatus,
  sentAt: z.iso.datetime(),
  /** The status only on the list: the reason is `get`'s (FR-628). */
  teacherStanding: teacherStanding.pick({ status: true }),
});

export const adminIjazahRequestsListOutput = z.object({
  items: z.array(adminIjazahRequestsListItem),
  nextCursor: z.uuid().optional(),
});

export const adminIjazahRequestsGetInput = z.object({ requestId: z.uuid() });

export const adminIjazahRequestsGetOutput = adminIjazahRequestsListItem.extend({
  completionDate: calendarDate,
  language,
  /** As frozen at send: origin first, the teacher appended (FR-ISNAD-7). */
  chain: z.array(generation).min(1),
  teacherNamePrinted: z.string(),
  /** The student's certificate name now, which approval prints; null while none is held. */
  studentName: z.string().nullable(),
  riwaya: z.string(),
  tariq: z.string().nullable(),
  /** A signed link to the request's own copy of the signature; null once erased (rejected, closed). */
  signatureLink: z.string().nullable(),
  teacherStanding,
  /** The rejection's reason. */
  reason: z.string().optional(),
  decidedAt: z.iso.datetime().optional(),
  /** Once approved. */
  ijazahId: z.uuid().optional(),
});

export const adminIjazahRequestsApproveInput = z.object({ requestId: z.uuid(), idempotencyKey });

export const adminIjazahRequestsApproveOutput = z.object({
  ijazahId: z.uuid(),
  certificateNumber,
});

export const adminIjazahRequestsRejectInput = z.object({
  requestId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

export type IjazahDecisionRefusal = z.infer<typeof ijazahDecisionRefusal>;
export type TeacherStandingStatus = z.infer<typeof teacherStandingStatus>;
export type AdminIjazahRequestsListInput = z.infer<typeof adminIjazahRequestsListInput>;
export type AdminIjazahRequestsListOutput = z.input<typeof adminIjazahRequestsListOutput>;
export type AdminIjazahRequestsGetInput = z.infer<typeof adminIjazahRequestsGetInput>;
export type AdminIjazahRequestsGetOutput = z.input<typeof adminIjazahRequestsGetOutput>;
export type AdminIjazahRequestsApproveInput = z.infer<typeof adminIjazahRequestsApproveInput>;
export type AdminIjazahRequestsApproveOutput = z.infer<typeof adminIjazahRequestsApproveOutput>;
export type AdminIjazahRequestsRejectInput = z.infer<typeof adminIjazahRequestsRejectInput>;
