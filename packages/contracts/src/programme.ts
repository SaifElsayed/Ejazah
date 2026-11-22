// 006:T003: the `programme` namespace of the user surface (specs/006-programme/contracts/
// app-surface.md; ADR 0024; FR-701 to FR-733; R-501 to R-517).
//
// An ijazah programme is an `ijazah_track` enrollment an assessment created: the assessment is its
// session 1, then the teacher's offer (a count, a length and a total), then the rest paid in full
// or month by month. Every mutation takes the kernel's idempotency key, its scope listed in
// `idempotent-procedures.ts`; every refusal answers `CONFLICT` with one of the causes below as
// `details.cause`, writes nothing and logs one line of ids and a reason (FR-733). Inputs name the
// enrollment and never who asks (R-GENDER-4): only its two parties reach it, anyone else NOT_FOUND.
// Money crosses as `_piasters` integers computed by `packages/money` (R-MONEY-1, K-5); no card
// detail crosses but the student's own card's last four digits and brand (SC-707). Additive only
// once merged (R-API-9).
import { z } from 'zod';

import { checkoutUrl } from './checkout.js';
import { idempotencyKey } from './idempotency-key.js';
import { sessionLengthMinutes } from './packages.js';

/**
 * The most offer sessions a programme may have (R-506, analyze U-6): a definition of the contract,
 * not an operational number. The offer's count is 1 to this; the enrollment holds it plus the
 * assessment.
 */
export const MAX_PROGRAMME_SESSION_COUNT = 200;

/** The longest text of the offer and of a request, in characters (ERD section 15 rules 78 and 80). */
export const PROGRAMME_TEXT_MAX_LENGTH = 500;

const programmeText = z.string().trim().min(1).max(PROGRAMME_TEXT_MAX_LENGTH);

/** A whole number of piasters above zero (ERD section 0). */
const programmePiasters = z.int().positive();

/** ERD `programme_state`: where a programme stands (data-model.md, «State transitions»). */
export const programmeState = z.enum(['awaiting_offer', 'offered', 'active', 'paused', 'closed']);

/** ERD `programme_plan`: how the student pays the rest; absent until the first payment. */
export const programmePlan = z.enum(['in_full', 'monthly']);

/** ERD `programme_request_kind`: `stop` and `refusal` are the teacher's; the sweep raises the others. */
export const programmeRequestKind = z.enum(['stop', 'refusal', 'no_offer', 'pay_blocked']);

/** ERD `programme_request_status`: `extended` on a `no_offer` or `pay_blocked` item only. */
export const programmeRequestStatus = z.enum([
  'open',
  'approved',
  'declined',
  'withdrawn',
  'extended',
]);

/**
 * Why a programme cannot start (R-503, R-515; I-3, Q-5 (a)): the switch `programme_enabled` is off
 * (`checkout.hold` and `checkout.pay` on a programme package), or the assessment's price is not set
 * (§3.14 `assessment_fee_piasters` 0: creating or activating a programme package, a draft allowed,
 * and the hold). A programme already running goes on whatever the switch says.
 */
export const programmeStartRefusal = z.enum(['programme_disabled', 'assessment_fee_unset']);

/** One enrollment's programme: the input of `programme.get` and of the student's actions on it. */
export const programmeGetInput = z.object({ enrollmentId: z.uuid() });

/** The offer as the teacher sent it, frozen after (R-506). */
export const programmeOffer = z.object({
  level: programmeText,
  readiness: programmeText,
  expectedLength: programmeText,
  durationMinutes: sessionLengthMinutes,
  sessionCount: z.int().min(1).max(MAX_PROGRAMME_SESSION_COUNT),
  /** The count × the package's price for that length, read under the package's lock (R-506). */
  total_piasters: programmePiasters,
  sessionPrice_piasters: programmePiasters,
  offeredAt: z.iso.datetime(),
});

/** The student's saved card, to the student only; never its token (R-510, SC-707). */
export const programmeCard = z.object({
  last4: z.string().regex(/^\d{4}$/),
  brand: z.string().min(1),
});

/**
 * `programme.get`'s answer (FR-726). `card` is the student's alone, null to the teacher;
 * `payeePending` is true only in live mode with the teacher's payout account unverified (FR-716);
 * `payBlocked` while a `pay_blocked` item is open (FR-706b); `teacherUnavailable` as FR-BOOK-19.
 */
export const programmeGetOutput = z.object({
  state: programmeState,
  /** The offer's deadline: the delivered assessment's end + `programme_offer_hours` (R-505). */
  offerDueAt: z.iso.datetime().nullable(),
  /** The offer + `programme_pay_rest_hours`, the first payment's deadline (R-505). */
  payBy: z.iso.datetime().nullable(),
  offer: programmeOffer.nullable(),
  plan: programmePlan.nullable(),
  monthsPaid: z.int().nonnegative(),
  monthCount: z.int().positive().nullable(),
  /** The paid month's last session's end (`lastToEnd`, R-507). */
  nextDueAt: z.iso.datetime().nullable(),
  paused: z.object({ since: z.iso.datetime() }).nullable(),
  /** «renew now» is open: no saved card and within `programme_renew_early_days` of the due time. */
  renewOpen: z.boolean(),
  /** An automatic order of the month is `created` and unexpired (FR-716). */
  chargePending: z.boolean(),
  payeePending: z.boolean(),
  payBlocked: z.boolean(),
  teacherUnavailable: z.boolean(),
  card: programmeCard.nullable(),
});

/** `programme.offer`: the teacher's offer after the delivered assessment (FR-705, R-506). */
export const programmeOfferInput = z.object({
  enrollmentId: z.uuid(),
  level: programmeText,
  readiness: programmeText,
  expectedLength: programmeText,
  /** At most the reserved weekly time's length (`length_exceeds_slot`). */
  durationMinutes: sessionLengthMinutes,
  sessionCount: z.int().min(1).max(MAX_PROGRAMME_SESSION_COUNT),
  idempotencyKey,
});

export const programmeOfferOutput = z.object({
  total_piasters: programmePiasters,
  sessionPrice_piasters: programmePiasters,
  monthCount: z.int().positive(),
});

/** `programme.offer`'s refusals (FR-705, R-506; app-surface.md). */
export const programmeOfferRefusal = z.enum([
  'assessment_not_delivered',
  'not_awaiting_offer',
  'offer_due_passed',
  'length_exceeds_slot',
  'count_out_of_bounds',
  'teacher_not_active',
]);

/** `programme.pay`: the first payment of the rest, within `payBy`; no hold (FR-710 to FR-713). */
export const programmePayInput = z.object({
  enrollmentId: z.uuid(),
  plan: programmePlan,
  /** The student's consent to save the card for the later months (FR-713, R-510). */
  saveCard: z.boolean(),
  idempotencyKey,
});

/** `programme.renew`: the next month by hand (FR-713a, FR-715, FR-716). */
export const programmeRenewInput = z.object({
  enrollmentId: z.uuid(),
  saveCard: z.boolean(),
  idempotencyKey,
});

/** `programme.pay`'s and `programme.renew`'s answer: the gateway's hosted checkout. */
export const programmeCheckoutOutput = z.object({ checkoutUrl });

/**
 * `programme.pay`'s refusals; `payee_unverified` before the gateway, in live mode only (FR-716),
 * and `rest_not_positive` in full with a total not above the assessment's price (U-6).
 */
export const programmePayRefusal = z.enum([
  'not_offered',
  'pay_by_passed',
  'party_suspended',
  'payee_unverified',
  'rest_not_positive',
]);

/** `programme.renew`'s refusals (FR-713a, FR-715, FR-716). */
export const programmeRenewRefusal = z.enum([
  'party_suspended',
  'payee_unverified',
  'not_due_yet',
  'charge_pending',
  'nothing_due',
  'closed',
]);

/** `programme.request`: the teacher's stop or refusal, for an administrator to decide (R-513). */
export const programmeRequestInput = z.object({
  enrollmentId: z.uuid(),
  kind: z.enum(['stop', 'refusal']),
  reason: programmeText,
  idempotencyKey,
});

export const programmeRequestOutput = z.object({ requestId: z.uuid() });

/**
 * `programme.request`'s refusals: a stop before `programme_stop_request_days` of pause
 * (`too_early`) or while not paused; a refusal once the offer is sent or before the assessment's
 * delivery; either while one of its kind is open (FR-709, FR-723).
 */
export const programmeRequestRefusal = z.enum([
  'not_paused',
  'too_early',
  'request_open',
  'assessment_not_delivered',
  'offer_sent',
]);

/** `programme.autoRenewOff` and `programme.cancel`: the student's, on the enrollment. */
export const programmeActionInput = z.object({
  enrollmentId: z.uuid(),
  idempotencyKey,
});

/** `programme.autoRenewOff`'s and `programme.cancel`'s answer. */
export const programmeActionOutput = z.object({ ok: z.literal(true) });

export type ProgrammeState = z.infer<typeof programmeState>;
export type ProgrammePlan = z.infer<typeof programmePlan>;
export type ProgrammeRequestKind = z.infer<typeof programmeRequestKind>;
export type ProgrammeRequestStatus = z.infer<typeof programmeRequestStatus>;
export type ProgrammeStartRefusal = z.infer<typeof programmeStartRefusal>;
export type ProgrammeGetInput = z.infer<typeof programmeGetInput>;
export type ProgrammeOffer = z.infer<typeof programmeOffer>;
export type ProgrammeCard = z.infer<typeof programmeCard>;
export type ProgrammeGetOutput = z.infer<typeof programmeGetOutput>;
export type ProgrammeOfferInput = z.infer<typeof programmeOfferInput>;
export type ProgrammeOfferOutput = z.infer<typeof programmeOfferOutput>;
export type ProgrammeOfferRefusal = z.infer<typeof programmeOfferRefusal>;
export type ProgrammePayInput = z.infer<typeof programmePayInput>;
export type ProgrammeRenewInput = z.infer<typeof programmeRenewInput>;
export type ProgrammeCheckoutOutput = z.infer<typeof programmeCheckoutOutput>;
export type ProgrammePayRefusal = z.infer<typeof programmePayRefusal>;
export type ProgrammeRenewRefusal = z.infer<typeof programmeRenewRefusal>;
export type ProgrammeRequestInput = z.infer<typeof programmeRequestInput>;
export type ProgrammeRequestOutput = z.infer<typeof programmeRequestOutput>;
export type ProgrammeRequestRefusal = z.infer<typeof programmeRequestRefusal>;
export type ProgrammeActionInput = z.infer<typeof programmeActionInput>;
export type ProgrammeActionOutput = z.infer<typeof programmeActionOutput>;
