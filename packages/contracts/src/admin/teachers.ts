// T068: the administrator surface's `teachers` namespace (admin-surface.md "`teachers` — an approved
// teacher's standing"; FR-165, FR-142, ADR 0016 D2). Each action carries its mandatory reason
// (screens.md "AdminSuspendDialog"), which reaches the audit log; a revocation's reason is also the
// note the teacher reads on `ApplicationRejected`.
import { z } from 'zod';

import { idempotencyKey } from '../idempotency-key.js';
import { adminReason } from './admins.js';
import { timeZone } from '../onboarding.js';
import { documentsLinkOutput } from './documents.js';
import { outageWallClock } from './sessions.js';

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

// T077 of specs/004-sessions (FR-509; SRS FR-ADMIN-21, DEC-67; the note under T077, Q-R3 (a),
// Q-R5 (a)): `teachers.keptData.*`, an administrator's control of what a deleted teacher once
// approved keeps. Each takes a mandatory reason. `documentLink` answers one signed link per press,
// valid `document_link_ttl_seconds`, as `documents.link` answers one; the two writes are keyed under
// the administrator's idempotency key. `eraseAt` is a local wall clock with its IANA zone, as
// `outages.record` takes one (R-TIME-6: a client sends no instant; Q-K1 (a), the review session,
// 2026-11-14), resolved by the server through `@ijazah/time` and at least 24 hours ahead of the
// database's clock (refused `erase_date_too_soon` otherwise), or null to clear the date.
export const teachersKeptDocumentLinkInput = z.object({
  teacherUserId: z.uuid(),
  documentId: z.uuid(),
  reason: adminReason,
});

export const teachersKeptDocumentLinkOutput = documentsLinkOutput;

/**
 * How far ahead of now an erasure date must be, in hours: spec FR-509 and T077's line fix it
 * («`eraseAt` at least 24 h ahead»; the note under T077, Q-R5 (a)); the server refuses a nearer one
 * `CONFLICT` `erase_date_too_soon`, and the panel may read it to bound its date picker.
 */
export const KEPT_ERASE_DATE_MIN_HOURS_AHEAD = 24;

export const teachersKeptEraseDateInput = z.object({
  teacherUserId: z.uuid(),
  eraseAt: outageWallClock.extend({ timezone: timeZone }).nullable(),
  reason: adminReason,
  idempotencyKey,
});

export const teachersKeptEraseNowInput = z.object({
  teacherUserId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

export type TeachersKeptDocumentLinkInput = z.infer<typeof teachersKeptDocumentLinkInput>;
export type TeachersKeptEraseDateInput = z.infer<typeof teachersKeptEraseDateInput>;
export type TeachersKeptEraseNowInput = z.infer<typeof teachersKeptEraseNowInput>;

// 005:T031 of specs/005-certification (FR-631; R-411; the note under T031, Q-D2 (a)):
// `teachers.keptData.signatureLink`, the kept signature of a deleted teacher ever approved opened as a
// kept document is, one signed link per press, valid `document_link_ttl_seconds`, with a mandatory
// reason; audited on the person (`kept_signature.view`), under `rate_limit_kept_document_link`.
export const teachersKeptSignatureLinkInput = z.object({
  teacherUserId: z.uuid(),
  reason: adminReason,
});

export const teachersKeptSignatureLinkOutput = documentsLinkOutput;

export type TeachersKeptSignatureLinkInput = z.infer<typeof teachersKeptSignatureLinkInput>;
