// T021 fixture — VIOLATION of R-API-1: a router procedure that decides instead of dispatching.
// A router validates its input, calls one service method and returns; the branching below is
// the shape a business rule takes when it is written in the wrong file, and it is what the
// complexity ceiling on `*.router.ts` is measuring.
//
// The ceiling is a number no Phase 0 document fixes, so this fixture does not aim just past it:
// `enroll` carries more than twenty independent decisions, which is over any ceiling a reviewer
// would defend. See the note in tests/violations/layers.spec.ts.
// Refused by api/no-logic-in-router.
import type { Piasters } from '@ijazah/money';

interface EnrollInput {
  readonly requesterGender: string;
  readonly teacherGender: string;
  readonly teacherApproved: boolean;
  readonly teacherPayoutVerified: boolean;
  readonly holdExpired: boolean;
  readonly holdOwnerId: string;
  readonly requesterId: string;
  readonly package_price_piasters: Piasters;
  readonly sessionCount: number;
  readonly locale: string;
  readonly slotTimezone: string;
  readonly paidEventSeen: boolean;
  readonly alreadyEnrolled: boolean;
  readonly suspended: boolean;
  readonly termsAccepted: boolean;
}

export const bookingRouter = {
  enroll(input: EnrollInput): string {
    let outcome = 'confirmed';

    if (input.requesterGender !== input.teacherGender) {
      outcome = 'not_found';
    }
    if (!input.teacherApproved) {
      outcome = 'not_found';
    }
    if (!input.teacherPayoutVerified) {
      outcome = 'not_found';
    }
    if (input.suspended) {
      outcome = 'forbidden';
    }
    if (!input.termsAccepted) {
      outcome = 'forbidden';
    }
    if (input.alreadyEnrolled) {
      outcome = 'conflict';
    }
    if (input.holdExpired) {
      outcome = 'expired';
    }
    if (input.holdOwnerId !== input.requesterId) {
      outcome = 'forbidden';
    }
    if (input.package_price_piasters <= 0) {
      outcome = 'invalid';
    }
    if (input.sessionCount <= 0) {
      outcome = 'invalid';
    }
    if (input.sessionCount > 200) {
      outcome = 'invalid';
    }
    if (input.locale !== 'ar' && input.locale !== 'en') {
      outcome = 'invalid';
    }
    if (input.slotTimezone.length === 0) {
      outcome = 'invalid';
    }
    if (!input.paidEventSeen) {
      outcome = 'pending_payment';
    }
    if (outcome === 'pending_payment' && input.holdExpired) {
      outcome = 'cancelled';
    }
    if (outcome === 'cancelled' && input.alreadyEnrolled) {
      outcome = 'conflict';
    }
    if (outcome === 'conflict' && input.suspended) {
      outcome = 'forbidden';
    }
    if (outcome === 'invalid' && input.locale === 'ar') {
      outcome = 'invalid_ar';
    }
    if (outcome === 'invalid_ar' && input.sessionCount === 0) {
      outcome = 'invalid_ar_empty';
    }
    if (outcome === 'confirmed' && input.package_price_piasters > 1_000_000) {
      outcome = 'review_required';
    }
    if (outcome === 'review_required' && !input.teacherPayoutVerified) {
      outcome = 'not_found';
    }
    if (outcome === 'not_found' && input.requesterId.length === 0) {
      outcome = 'unauthenticated';
    }

    return outcome;
  },
};
