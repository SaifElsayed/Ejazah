// T070 of specs/004-sessions (FR-503; SRS FR-CANCEL-9, DEC-69; contracts/admin-surface.md,
// "`enrollments`"): the administrator surface's `enrollments` namespace, served by the booking
// module. `enrollments.releaseSlot` frees the weekly slot a closed enrollment holds through its
// window, before the window ends, with a mandatory reason, keyed under the administrator's
// idempotency key. Refused `CONFLICT` with `details.cause` `slot_not_held` (the enrollment not
// closed, its closing not restorable, the hold over, or the slot already released), writing nothing.
// No amount crosses.
import { z } from 'zod';

import { idempotencyKey } from '../idempotency-key.js';
import { adminReason } from './admins.js';

/** Why a release was refused, as `CONFLICT`'s `details.cause`. */
export const slotReleaseRefusalCause = z.enum(['slot_not_held']);

export const enrollmentsReleaseSlotInput = z.object({
  enrollmentId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

export const enrollmentsReleaseSlotOutput = z.object({
  enrollmentId: z.uuid(),
  /** The instant the slot was released, the database's clock (`enrollments.slot_released_at`). */
  slotReleasedAt: z.iso.datetime(),
});

export type SlotReleaseRefusalCause = z.infer<typeof slotReleaseRefusalCause>;
export type EnrollmentsReleaseSlotInput = z.infer<typeof enrollmentsReleaseSlotInput>;
export type EnrollmentsReleaseSlotOutput = z.infer<typeof enrollmentsReleaseSlotOutput>;
