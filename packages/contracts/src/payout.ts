// T077: the `teacher.payout` namespace of the user surface (app-surface.md "`teacher.payout` —
// payout setup"; FR-190 to FR-194).
//
// An approved teacher hands the gateway the account the students' payments settle to; the platform
// keeps only the gateway's recipient reference, encrypted, never the account itself (FR-PAYG-13,
// R-DB-8). `register` serves the first setup and a replacement alike, and is keyed
// (`idempotent-procedures.ts`), so it carries the kernel's idempotency key.
import { z } from 'zod';

import { idempotencyKey } from './teacher-application.js';

/** The longest gateway rejection reason kept and shown; a longer one is cut (B15 check, decision 2). */
export const PAYOUT_REJECTED_REASON_MAX_LENGTH = 300;

/**
 * PROVISIONAL: the stand-in's shape of what payout setup sends the gateway (contracts/ports.md,
 * OPEN-11). The gateway task of Phase 2 settles the fields its gateway needs, additively.
 */
export const payoutDetails = z.object({
  holderName: z.string().trim().min(1).max(100),
  method: z.enum(['bank_account', 'mobile_wallet']),
  accountNumber: z.string().regex(/^[A-Za-z0-9]{4,34}$/),
});

export const payoutState = z.enum([
  'not_configured',
  'pending_verification',
  'verified',
  'rejected',
]);

/** `teacher.payout.get`'s answer: the state the four payout screens show. */
export const payoutGetOutput = z.object({
  state: payoutState,
  configuredAt: z.iso.datetime().optional(),
  verifiedAt: z.iso.datetime().optional(),
  /** The gateway's reason, as plain text, while the state is `rejected`. */
  rejectedReason: z.string().max(PAYOUT_REJECTED_REASON_MAX_LENGTH).optional(),
});

export const payoutRegisterInput = z.object({ details: payoutDetails, idempotencyKey });

export type PayoutDetailsInput = z.infer<typeof payoutDetails>;
export type PayoutState = z.infer<typeof payoutState>;
export type PayoutGetOutput = z.infer<typeof payoutGetOutput>;
export type PayoutRegisterInput = z.infer<typeof payoutRegisterInput>;
