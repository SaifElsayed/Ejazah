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

// 005:T010 (B46, lane E; FR-609, FR-610; R-412; the note under T010, Q12 (a)): `ijazahs.list`,
// `.get`, `.revoke`, `.bar` and `.liftBar`. The administrator sees every ijazah, revoked or not,
// with whether it is rendered and whether it is revoked; a revoked one is never shown as valid
// (R-HONEST-6): its status is `revoked` whatever else it holds. `get` adds a signed link to the
// rendered PDF, never its key (R-SEC-3); the token's hash is never answered (R-DB-7). The three
// writes are keyed and need a reason; a revocation is final in v1.0 (Q12 (a)).

/** An ijazah's state as the administrator reads it: revoked first, then signed off, then rendered. */
export const adminIjazahStatus = z.enum(['preparing', 'rendered', 'signed_off', 'revoked']);

/** The `ijazahs` writes' refusals, CONFLICT with this code. */
export const ijazahsRefusal = z.enum(['already_revoked', 'already_barred', 'not_barred']);

export const adminIjazahsListInput = z.object({
  status: adminIjazahStatus.optional(),
  /** The last ijazah id of the previous page (a UUIDv7, so the order is the order of issue). */
  cursor: z.uuid().optional(),
});

export const adminIjazahsListItem = z.object({
  ijazahId: z.uuid(),
  certificateNumber,
  enrollmentId: z.uuid(),
  requestId: z.uuid().nullable(),
  teacher: party,
  student: party,
  subject: subjectSummary,
  language,
  grantedAt: z.iso.datetime(),
  status: adminIjazahStatus,
  /** The current generation's PDF is rendered. */
  rendered: z.boolean(),
  revoked: z.boolean(),
  renderGeneration: z.int().min(0),
  signedOffAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});

export const adminIjazahsListOutput = z.object({
  items: z.array(adminIjazahsListItem),
  nextCursor: z.uuid().optional(),
});

export const adminIjazahsGetInput = z.object({ ijazahId: z.uuid() });

export const adminIjazahsGetOutput = adminIjazahsListItem.extend({
  /** From the request (FR-IJAZAH-15). */
  completionDate: calendarDate.nullable(),
  /** As frozen: origin first, the teacher appended (FR-ISNAD-7). */
  chain: z.array(generation).min(1),
  studentNamePrinted: z.string(),
  teacherNamePrinted: z.string(),
  riwaya: z.string(),
  tariq: z.string().nullable(),
  revokedReason: z.string().nullable(),
  /** A signed link to the current generation's PDF once rendered; null before (R-412). */
  pdfLink: z.string().nullable(),
});

export const adminIjazahsRevokeInput = z.object({
  ijazahId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

/**
 * `ijazahs.bar` and `ijazahs.liftBar` (FR-610). `targetUserId`: the person barred (a field named
 * `userId` is refused in an input, R-GENDER-4, as `users.requireIdentity`'s).
 */
export const adminIjazahBarInput = z.object({
  targetUserId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

export type AdminIjazahStatus = z.infer<typeof adminIjazahStatus>;
export type IjazahsRefusal = z.infer<typeof ijazahsRefusal>;
export type AdminIjazahsListInput = z.infer<typeof adminIjazahsListInput>;
export type AdminIjazahsListOutput = z.input<typeof adminIjazahsListOutput>;
export type AdminIjazahsListItem = z.input<typeof adminIjazahsListItem>;
export type AdminIjazahsGetInput = z.infer<typeof adminIjazahsGetInput>;
export type AdminIjazahsGetOutput = z.input<typeof adminIjazahsGetOutput>;
export type AdminIjazahsRevokeInput = z.infer<typeof adminIjazahsRevokeInput>;
export type AdminIjazahBarInput = z.infer<typeof adminIjazahBarInput>;

// 005:T032 (B46, lane E; FR-629; R-402, R-403; the note under T032, Q7 (a)): `ijazahs.signOff` and
// `ijazahs.rerender`. The sign-off is what shows a certificate to its parties; until it, an
// administrator may have it rendered again (a reason), and a correction re-freezes and re-renders it
// (R-403). Both are keyed; a sign-off is final (SC-604: nothing changes the certificate after it).

/** The sign-off's and the re-render's refusals, CONFLICT with this code (DEC-72, Q7 (a)). */
export const ijazahSignOffRefusal = z.enum([
  'not_rendered',
  'revoked',
  'already_signed_off',
  'student_barred',
]);

export const adminIjazahsSignOffInput = z.object({ ijazahId: z.uuid(), idempotencyKey });

export const adminIjazahsRerenderInput = z.object({
  ijazahId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

export type IjazahSignOffRefusal = z.infer<typeof ijazahSignOffRefusal>;
export type AdminIjazahsSignOffInput = z.infer<typeof adminIjazahsSignOffInput>;
export type AdminIjazahsRerenderInput = z.infer<typeof adminIjazahsRerenderInput>;

// 005:T022 (B49; FR-610; the note under T022, Q-P2 (b)): `ijazahs.barred`. A barred student gets no
// new request, so a student barred with no ijazah would have no page to lift the bar from: this read
// answers a page of the open bars (`lifted_at` null), newest first (a bar's id is a UUIDv7), each with
// the student, the reason, the instant and the administrator who barred, by id and display name.

export const adminIjazahsBarredInput = z.object({
  /** The last bar id of the previous page; the next page holds the older bars. */
  cursor: z.uuid().optional(),
});

export const adminIjazahsBarredItem = z.object({
  barId: z.uuid(),
  student: party,
  reason: z.string(),
  barredAt: z.iso.datetime(),
  barredBy: z.object({ adminId: z.uuid(), displayName: z.string() }),
});

export const adminIjazahsBarredOutput = z.object({
  items: z.array(adminIjazahsBarredItem),
  nextCursor: z.uuid().optional(),
});

export type AdminIjazahsBarredInput = z.infer<typeof adminIjazahsBarredInput>;
export type AdminIjazahsBarredItem = z.input<typeof adminIjazahsBarredItem>;
export type AdminIjazahsBarredOutput = z.input<typeof adminIjazahsBarredOutput>;
