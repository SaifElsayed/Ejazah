// T013 of specs/005-certification: `genderFlags.raise`, a signed-in user's flag on another user's
// declared gender (FR-614, FR-613; SRS FR-GENDER-3; research R-409; contracts/app-surface.md,
// `genderFlags.raise`).
//
// The caller names the person flagged and why. Who flags is the session's account, never the
// input's (R-GENDER-4); the person flagged is one the caller is paired with or can see, which the
// server decides. The reason is free text, stored and never logged. The answer says only that the
// flag was received, nothing of the flag, its id or its outcome, as `reports.create` answers
// (spec.md:305). One open flag per flagged user: a second is refused `open_exists`. Keyed by the
// kernel's idempotency (`idempotent-procedures.ts`). Additive only once merged (R-API-9).
import { z } from 'zod';

import { idempotencyKey } from './idempotency-key.js';
import { PARTICIPANT_REASON_MAX_LENGTH } from './sessions.js';

/** `genderFlags.raise`'s refusal, CONFLICT with this code (FR-614: one open flag per user). */
export const genderFlagRaiseRefusal = z.enum(['open_exists']);

export const genderFlagsRaiseInput = z.object({
  flaggedUserId: z.uuid(),
  reason: z.string().trim().min(1).max(PARTICIPANT_REASON_MAX_LENGTH),
  idempotencyKey,
});

/** Received, and nothing else (as `reports.create`, spec.md:305). */
export const genderFlagsRaiseOutput = z.object({ received: z.literal(true) });

export type GenderFlagRaiseRefusal = z.infer<typeof genderFlagRaiseRefusal>;
export type GenderFlagsRaiseInput = z.infer<typeof genderFlagsRaiseInput>;
export type GenderFlagsRaiseOutput = z.infer<typeof genderFlagsRaiseOutput>;
