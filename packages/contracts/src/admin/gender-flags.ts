// T013 of specs/005-certification: the administrator surface's `genderFlags` namespace
// (contracts/admin-surface.md, `genderFlags.*`; FR-614, FR-615; SRS FR-GENDER-3, FR-GENDER-4,
// FR-ADMIN-8; research R-409; the note under T013, Q-G1 (a)).
//
// The queue lists flags by status, the open ones unless said, a flag id as the cursor (a UUIDv7, so
// the order is the order of raising). `get` adds the raiser's reason, the resolution once there is
// one, and the enrollments a correction would end now (a preview: their count and ids, composed by
// the admin module from booking's entry, R-409). `raise` flags a person from a report (its id stored)
// or on the administrator's own initiative; `dismiss` closes an open flag with a reason. Every
// mutation is keyed (`idempotencyKey`) and refused `already_resolved` once the flag is not open, or
// `open_exists` while the person has an open flag. The person is named `targetUserId`, never
// `userId` (the no-authority-in-input lint; `admin/documents.ts`'s precedent). The people are ids
// only; no declared gender crosses. Additive only once merged (R-API-9).
import { z } from 'zod';

import { idempotencyKey } from '../idempotency-key.js';
import { adminReason } from './admins.js';

/** A flag's state (`gender_flag_status`, ERD §10). */
export const genderFlagStatus = z.enum(['open', 'corrected', 'fraud_ban', 'dismissed']);

/** How an open flag is closed (FR-615). */
export const genderFlagOutcome = z.enum(['corrected', 'fraud_ban', 'dismissed']);

/**
 * The administrators' refusals, CONFLICT with this code (FR-614, FR-615): `report_target_mismatch`
 * (path `reportId`) when the report a flag is raised from is about another person; an administrator
 * sees every report, so the refusal says why rather than hiding it (an unknown report is NOT_FOUND).
 */
export const genderFlagDecisionRefusal = z.enum([
  'already_resolved',
  'open_exists',
  'report_target_mismatch',
]);

export const adminGenderFlagsListInput = z.object({
  /** The queue's open flags unless said. */
  status: genderFlagStatus.default('open'),
  /** The last flag id of the previous page. */
  cursor: z.uuid().optional(),
});

export const adminGenderFlagsListItem = z.object({
  flagId: z.uuid(),
  flaggedUserId: z.uuid(),
  /** Null when an administrator raised it (FR-GENDER-3). */
  raisedByUserId: z.uuid().nullable(),
  /** The report an administrator raised it from; null otherwise. */
  reportId: z.uuid().nullable(),
  status: genderFlagStatus,
  createdAt: z.iso.datetime(),
});

export const adminGenderFlagsListOutput = z.object({
  items: z.array(adminGenderFlagsListItem),
  nextCursor: z.uuid().optional(),
});

export const adminGenderFlagsGetInput = z.object({ flagId: z.uuid() });

/** A flag's closing: the outcome, the administrator's reason, when and by whom (FR-615). */
export const genderFlagResolution = z.object({
  outcome: genderFlagOutcome,
  note: z.string().nullable(),
  resolvedAt: z.iso.datetime(),
  resolvedByAdminId: z.uuid(),
});

/** The confirmed enrollments a correction would end now (admin-surface.md: a preview count and ids). */
export const genderCorrectionPreview = z.object({
  count: z.int().nonnegative(),
  enrollmentIds: z.array(z.uuid()),
});

export const adminGenderFlagsGetOutput = adminGenderFlagsListItem.extend({
  /** The raiser's words, free text. */
  reason: z.string(),
  resolution: genderFlagResolution.nullable(),
  correctionWouldEnd: genderCorrectionPreview,
});

export const adminGenderFlagsRaiseInput = z.object({
  targetUserId: z.uuid(),
  reason: adminReason,
  /** The report the flag is raised from; its reported user is `targetUserId`. */
  reportId: z.uuid().optional(),
  idempotencyKey,
});

export const adminGenderFlagsRaiseOutput = z.object({ flagId: z.uuid() });

export const adminGenderFlagsDismissInput = z.object({
  flagId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

export type GenderFlagStatus = z.infer<typeof genderFlagStatus>;
export type GenderFlagOutcome = z.infer<typeof genderFlagOutcome>;
export type GenderFlagDecisionRefusal = z.infer<typeof genderFlagDecisionRefusal>;
export type AdminGenderFlagsListInput = z.infer<typeof adminGenderFlagsListInput>;
export type AdminGenderFlagsListItem = z.infer<typeof adminGenderFlagsListItem>;
export type AdminGenderFlagsListOutput = z.infer<typeof adminGenderFlagsListOutput>;
export type AdminGenderFlagsGetInput = z.infer<typeof adminGenderFlagsGetInput>;
export type AdminGenderFlagsGetOutput = z.infer<typeof adminGenderFlagsGetOutput>;
export type AdminGenderFlagsRaiseInput = z.infer<typeof adminGenderFlagsRaiseInput>;
export type AdminGenderFlagsRaiseOutput = z.infer<typeof adminGenderFlagsRaiseOutput>;
export type AdminGenderFlagsDismissInput = z.infer<typeof adminGenderFlagsDismissInput>;

// 005:T014 (FR-616; SRS FR-GENDER-7; research R-409; the note under T014): the correction of an
// honest error. It takes the flag, a reason and a key, never a gender: the person's declared gender
// becomes the other one, the server's reading of the flag (no administrator types a gender, the
// R-GENDER-6 CI test). It answers how many confirmed enrollments it ended (never restorable,
// DEC-69). ⚠️ Irreversible ends.
export const adminGenderFlagsCorrectInput = z.object({
  flagId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

export const adminGenderFlagsCorrectOutput = z.object({
  endedEnrollments: z.int().nonnegative(),
});

export type AdminGenderFlagsCorrectInput = z.infer<typeof adminGenderFlagsCorrectInput>;
export type AdminGenderFlagsCorrectOutput = z.infer<typeof adminGenderFlagsCorrectOutput>;
