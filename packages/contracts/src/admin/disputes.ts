// T034 of specs/004-sessions (FR-421, FR-474, FR-475, FR-476, FR-480; research R-308; plan.md
// decision 13; admin-surface.md, "`disputes`"): the administrator's disputes queue and its
// resolution, sessions' procedures over moderation's rows. No amount crosses (R-MONEY-6):
// `compensation_ordered` records the decision only (FR-DISPUTE-6). `disputes.get`'s `revisable` and
// `revisions` are T059's, added then (R-API-9).
import { z } from 'zod';

import { sessionStatus } from '../enrollments.js';
import { idempotencyKey } from '../idempotency-key.js';
import { adminReason } from './admins.js';
import { adminOutcome, telemetry } from './sessions.js';

/** A page of the list starts after this dispute. */
export const disputesListCursor = z.uuid();

export const disputesListInput = z.object({ cursor: disputesListCursor.optional() });

/** Who raised a session dispute: one of the session's two parties. */
export const disputeRaisedBy = z.enum(['student', 'teacher']);

export const disputesListItem = z.object({
  disputeId: z.uuid(),
  sessionId: z.uuid(),
  raisedBy: disputeRaisedBy,
  raisedAt: z.iso.datetime(),
  /** The outcome frozen beside the session's `disputed` status (R-308); absent before the evaluation. */
  outcomeUnderDispute: sessionStatus.optional(),
  /** The session's enrollment's Teacher-No-Show count (FR-451), read when listed. */
  teacherNoShows: z.int().nonnegative(),
  /** `teacherNoShows` at `repeated_absence_flag_count` or above (FR-451); nothing follows from it. */
  repeatedAbsence: z.boolean(),
});

export const disputesListOutput = z.object({
  /** The open disputes first, oldest first; then the closed ones, newest first. */
  items: z.array(disputesListItem),
  /** Present while more disputes follow the page. */
  nextCursor: disputesListCursor.optional(),
});

export const disputesGetInput = z.object({ disputeId: z.uuid() });

/** The six resolutions of a session dispute (R-308). */
export const disputeResolution = z.enum([
  'upheld',
  're_marked',
  'no_show_recorded',
  'compensation_ordered',
  'party_suspended',
  'party_banned',
]);

/** A session dispute as the administrator reads it. */
export const disputeDetail = z.object({
  disputeId: z.uuid(),
  sessionId: z.uuid(),
  enrollmentId: z.uuid(),
  raisedBy: disputeRaisedBy,
  /** The raiser's own text. */
  reason: z.string(),
  status: z.enum(['open', 'resolved', 'dismissed']),
  raisedAt: z.iso.datetime(),
  outcomeUnderDispute: sessionStatus.optional(),
  resolution: disputeResolution.optional(),
  resolutionNotes: z.string().optional(),
  resolvedAt: z.iso.datetime().optional(),
});

/** One revision of a ruling, from its `dispute_revised` row (T059); the reason is the audit's. */
export const disputeRevision = z.object({
  outcomeBefore: adminOutcome,
  outcomeAfter: adminOutcome,
  revisedAt: z.iso.datetime(),
});

export const disputesGetOutput = z.object({
  dispute: disputeDetail,
  telemetry,
  /** The dispute is open, so `disputes.chat` reads the enrollment's chat (FR-475). */
  chatAvailable: z.boolean(),
  /** `disputes.revise` would be admitted now (T059). */
  revisable: z.boolean(),
  /** The ruling's revisions, oldest first (T059). */
  revisions: z.array(disputeRevision),
});

/**
 * `re_marked` names whether the session was consumed (`consumed`), `no_show_recorded` whom the
 * absence is recorded against (`against`), and `party_suspended` and `party_banned` the party the
 * standing action reaches (`party`); each is required for its resolution.
 */
export const disputesResolveInput = z
  .object({
    disputeId: z.uuid(),
    resolution: disputeResolution,
    consumed: z.boolean().optional(),
    against: z.enum(['student', 'teacher']).optional(),
    party: z.enum(['student', 'teacher']).optional(),
    reason: adminReason,
  })
  .refine((input) => input.resolution !== 're_marked' || input.consumed !== undefined, {
    path: ['consumed'],
    message: 'A re-marking names whether the session was consumed',
  })
  .refine((input) => input.resolution !== 'no_show_recorded' || input.against !== undefined, {
    path: ['against'],
    message: 'A recorded no-show names whom it is recorded against',
  })
  .refine(
    (input) =>
      (input.resolution !== 'party_suspended' && input.resolution !== 'party_banned') ||
      input.party !== undefined,
    { path: ['party'], message: 'A standing action names its party' },
  );

export const disputesResolveOutput = z.object({ disputeId: z.uuid(), sessionStatus });

// T059 of specs/004-sessions (SRS FR-DISPUTE-7; FR-472, FR-480, FR-495; research R-308, «A ruling's
// revision»; admin-surface.md, `disputes.revise`): the session's outcome revised after a ruling,
// inside the dispute window and before any remedy; the ruling itself is never rewritten. Keyed by
// `idempotencyKey` (scope `disputes.revise`).
export const disputesReviseInput = z.object({
  disputeId: z.uuid(),
  outcome: adminOutcome,
  reason: adminReason,
  idempotencyKey,
});

/** What the earlier ruling did that the revision leaves as it is. */
export const notUndone = z.enum(['party_suspended', 'party_banned', 'enrollment_ended']);

export const disputesReviseOutput = z.object({
  disputeId: z.uuid(),
  sessionStatus: adminOutcome,
  previousStatus: adminOutcome,
  notUndone: z.array(notUndone),
});

export type DisputesListInput = z.infer<typeof disputesListInput>;
export type DisputesListItem = z.infer<typeof disputesListItem>;
export type DisputesListOutput = z.infer<typeof disputesListOutput>;
export type DisputesGetInput = z.infer<typeof disputesGetInput>;
export type DisputesGetOutput = z.infer<typeof disputesGetOutput>;
export type DisputeDetail = z.infer<typeof disputeDetail>;
export type DisputeResolution = z.infer<typeof disputeResolution>;
export type DisputesResolveInput = z.infer<typeof disputesResolveInput>;
export type DisputesResolveOutput = z.infer<typeof disputesResolveOutput>;
export type DisputeRevision = z.infer<typeof disputeRevision>;
export type DisputesReviseInput = z.infer<typeof disputesReviseInput>;
export type DisputesReviseOutput = z.infer<typeof disputesReviseOutput>;
