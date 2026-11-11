// T034 of specs/004-sessions (FR-421, FR-474, FR-475, FR-476, FR-480; research R-308; plan.md
// decision 13; admin-surface.md, "`disputes`"): the administrator's disputes queue and its
// resolution, sessions' procedures over moderation's rows. No amount crosses (R-MONEY-6):
// `compensation_ordered` records the decision only (FR-DISPUTE-6). `disputes.get`'s `revisable` and
// `revisions` are T059's, added then (R-API-9).
import { z } from 'zod';

import { sessionStatus } from '../enrollments.js';
import { adminReason } from './admins.js';
import { telemetry } from './sessions.js';

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

export const disputesGetOutput = z.object({
  dispute: disputeDetail,
  telemetry,
  /** The dispute is open, so `disputes.chat` reads the enrollment's chat (FR-475). */
  chatAvailable: z.boolean(),
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

export type DisputesListInput = z.infer<typeof disputesListInput>;
export type DisputesListItem = z.infer<typeof disputesListItem>;
export type DisputesListOutput = z.infer<typeof disputesListOutput>;
export type DisputesGetInput = z.infer<typeof disputesGetInput>;
export type DisputesGetOutput = z.infer<typeof disputesGetOutput>;
export type DisputeDetail = z.infer<typeof disputeDetail>;
export type DisputeResolution = z.infer<typeof disputeResolution>;
export type DisputesResolveInput = z.infer<typeof disputesResolveInput>;
export type DisputesResolveOutput = z.infer<typeof disputesResolveOutput>;
