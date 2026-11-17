// T006 of specs/005-certification: the teacher's ijazah request, `teacher.ijazahRequests.preview`,
// `.send` and `.get` (FR-603, FR-608, FR-627; research R-403, R-404; contracts/app-surface.md,
// `teacher.ijazahRequests.*` and «Enrollment reads gain»).
//
// The caller names the enrollment, the completion date and the certificate's language (Arabic unless
// said, FR-LOC-4); the parties, the subject and the frozen chain come from the server's rows, never
// the input. A party reads the request's state only: its status, the reason once rejected, the
// ijazah once approved; never the signature copy's storage key (R-SEC-3) or the frozen chain, which
// the output schemas strip. The preview's `riwaya` and `tariq` are the credential's as the
// certificate prints them (B46 Q5 (c), the printed riwaya and tariq). Additive only once merged
// (R-API-9).
import { z } from 'zod';

import { language } from './account.js';
import { idempotencyKey } from './idempotency-key.js';
import { calendarDate } from './onboarding.js';

/** FR-603's refusals of a send, each logged with ids and its reason; CONFLICT with this code. */
export const ijazahRequestRefusal = z.enum([
  'not_active',
  'not_ijazah_track',
  'no_credential',
  'no_signature',
  'student_barred',
  'request_open',
  'already_issued',
]);

/** A request's state (data-model.md, `ijazah_request_status`). */
export const ijazahRequestStatus = z.enum([
  'awaiting_student_name',
  'pending',
  'approved',
  'rejected',
  'closed',
]);

/** The certificate as it will be filled, before it is sent (FR-IJAZAH-15). */
export const ijazahRequestsPreviewInput = z.object({
  enrollmentId: z.uuid(),
  /** Not in the future, in the teacher's own day (the service's rule). */
  completionDate: calendarDate,
  language: language.default('ar'),
});

export const ijazahRequestsSendInput = ijazahRequestsPreviewInput.extend({ idempotencyKey });

export const ijazahRequestsGetInput = z.object({ enrollmentId: z.uuid() });

/** One generation of the chain: one or more names, printed as one row (ADR 0004 D3). */
const generation = z.array(z.string()).min(1);

export const ijazahRequestsPreviewOutput = z.object({
  /** Origin first, the teacher appended (FR-ISNAD-7). */
  chain: z.array(generation).min(1),
  /** The credential's holder name (ADR 0019 D1). */
  teacherName: z.string(),
  riwaya: z.string(),
  tariq: z.string().nullable(),
  /** The student's certificate name; null while none is held (FR-602). */
  studentName: z.string().nullable(),
  /** The completion date given, and today's in the teacher's zone as the issue date shown. */
  dates: z.object({ completionDate: calendarDate, issueDate: calendarDate }),
});

export const ijazahRequestsSendOutput = z.object({
  requestId: z.uuid(),
  status: z.enum(['awaiting_student_name', 'pending']),
});

/** A request as a party reads it on the enrollment (FR-608). */
export const enrollmentIjazahRequest = z.object({
  status: ijazahRequestStatus,
  /** The rejection's reason; the teacher's read only (FR-608). */
  reason: z.string().optional(),
  /** Once approved. */
  ijazahId: z.uuid().optional(),
  /**
   * 005:T010 (B46, Q-E2 (a); FR-609, R-HONEST-6): the approved request's ijazah was revoked, so no
   * party reads it as valid. The flag only: the revocation's reason stays in the audit.
   */
  revoked: z.literal(true).optional(),
});

export const ijazahRequestsGetOutput = z.object({
  request: enrollmentIjazahRequest.extend({ requestId: z.uuid() }).nullable(),
});

export type IjazahRequestRefusal = z.infer<typeof ijazahRequestRefusal>;
export type IjazahRequestStatus = z.infer<typeof ijazahRequestStatus>;
export type IjazahRequestsPreviewInput = z.infer<typeof ijazahRequestsPreviewInput>;
export type IjazahRequestsSendInput = z.infer<typeof ijazahRequestsSendInput>;
export type IjazahRequestsGetInput = z.infer<typeof ijazahRequestsGetInput>;
export type IjazahRequestsPreviewOutput = z.infer<typeof ijazahRequestsPreviewOutput>;
export type IjazahRequestsSendOutput = z.infer<typeof ijazahRequestsSendOutput>;
export type EnrollmentIjazahRequest = z.infer<typeof enrollmentIjazahRequest>;
export type IjazahRequestsGetOutput = z.infer<typeof ijazahRequestsGetOutput>;
