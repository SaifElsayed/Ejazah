// 006:T020 (FR-705, FR-706b, FR-723, FR-726; SRS DEC-112; B-P4's conflict check, Q-2 (a)): what the
// teacher's programme panel offers, from `programme.get` alone; the server stays the guard of every
// action. The offer form only while awaiting the offer with the assessment delivered: `offerDueAt` is
// the delivered assessment's end plus the offer's hours, null until it is delivered. The offer as sent
// once offered and while it runs; the administration's line while `payBlocked` (FR-706b); the months
// while it runs, and «late since» while paused (FR-726). The stop request only from the server's
// `stopRequestFrom` on (`paused_at` + `programme_stop_request_days` on the database's clock, null
// unless paused), read on the phone's clock by `secondsUntil` (R-TIME-1); `too_early` stays the
// server's guard. No refusal request exists in the app (SRS DEC-112): nothing here offers one.
// B-P4 round 2 (the owner's answers, 2026-11-25; Q-B2 (a), Q-B3 (a)): the form only while the server
// answers its terms (`offerTerms`, the teacher's, null once the deadline passed); its lengths those that
// fit the reserved weekly time (`slotMinutes`, `length_exceeds_slot` the server's guard), its price the
// programme package's for the length; no stop button while a stop request is open (`stopRequestOpen`).
import type {
  ProgrammeGetOutput,
  ProgrammeOfferTerms,
  ProgrammePrices,
  ProgrammeState,
  SessionLengthMinutes,
} from '@ijazah/contracts';
import { PROGRAMME_TEXT_MAX_LENGTH, SESSION_LENGTHS_MINUTES } from '@ijazah/contracts';
import { type Piasters, piasters } from '@ijazah/money';
import { secondsUntil } from '@ijazah/time/calendar';

export interface TeacherProgrammeView {
  /** The offer form: awaiting the offer, with the assessment delivered (its deadline known). */
  readonly offerForm: boolean;
  /** The offer as sent, once offered and while it runs. */
  readonly sentOffer: boolean;
  /** The offer is with the administration: the payout account was not verified (FR-706b). */
  readonly payBlocked: boolean;
  /** The months paid and the next due (FR-726). */
  readonly running: boolean;
  /** The student is late since this instant (FR-726, FR-BOOK-19). */
  readonly lateSince: string | null;
}

/** The states an offer has been sent in and the programme not closed. */
const SENT: readonly ProgrammeState[] = ['offered', 'active', 'paused'];
/** The states a paid programme runs in, month by month. */
const RUNNING: readonly ProgrammeState[] = ['active', 'paused'];

export function teacherProgrammeViewOf(programme: ProgrammeGetOutput): TeacherProgrammeView {
  return {
    offerForm:
      programme.state === 'awaiting_offer' &&
      programme.offerDueAt !== null &&
      programme.offerTerms !== null,
    sentOffer: SENT.includes(programme.state) && programme.offer !== null,
    payBlocked: programme.payBlocked,
    running: RUNNING.includes(programme.state),
    lateSince: programme.paused?.since ?? null,
  };
}

/**
 * Whether the stop request's button shows: no stop request is open, and `now` has reached the server's
 * `stopRequestFrom`.
 */
export function stopRequestShown(
  programme: Pick<ProgrammeGetOutput, 'stopRequestFrom' | 'stopRequestOpen'>,
  now: Date,
): boolean {
  const from = programme.stopRequestFrom;
  return !programme.stopRequestOpen && from !== null && secondsUntil(from, now) === 0;
}

/** One of the offer's texts, trimmed, while it is 1 to 500 characters (the contract's bound). */
export function offerTextOf(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= PROGRAMME_TEXT_MAX_LENGTH ? trimmed : null;
}

const PRICE_OF_LENGTH = {
  30: 'm30_piasters',
  45: 'm45_piasters',
  60: 'm60_piasters',
} as const satisfies Readonly<Record<SessionLengthMinutes, keyof ProgrammePrices>>;

/** B-P4 round 2 (Q-B2 (a)): the lengths the offer may take, those that fit the reserved weekly time. */
export function offerLengthsOf(terms: ProgrammeOfferTerms): readonly SessionLengthMinutes[] {
  return SESSION_LENGTHS_MINUTES.filter((minutes) => minutes <= terms.slotMinutes);
}

/**
 * B-P4 round 2 (Q-B2 (a)): the programme package's price of a session of `minutes`, as the server
 * answers it in the offer's terms, so the total is shown before it is sent; the server prices the
 * offer itself (R-506).
 */
export function offerPriceOf(terms: ProgrammeOfferTerms, minutes: SessionLengthMinutes): Piasters {
  return piasters(terms.prices[PRICE_OF_LENGTH[minutes]]);
}
