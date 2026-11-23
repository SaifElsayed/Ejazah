// 006:T008 of specs/006-programme (FR-706, FR-706a, FR-706b; R-505, R-508; SRS DEC-101; B-P2's
// conflict check, Q-3 (a) amended): the windows as pure functions, for T015's sweep and T008's own
// steps (`programmes.service.ts`). No clock and no read: the caller passes `now` (the database's) and
// the facts it read under the programme's row lock.
//
// THE OFFER'S DEADLINE (Q-3 (a) amended; the column `offer_due_at` holds the last derived value).
// Derived on every read while the programme awaits its offer, never set once: session 1's outcome
// chain (`sessions`' `assessmentOutcome`) delivered, or ended with no make-up pending (N-2), at its
// scheduled end + `programme_offer_hours`; none while a make-up is pending. An administrator's
// extension of a `no_offer` item gives `programme_offer_hours` more counted from the decision
// (I-2 (a)), so the deadline is the later of the two.
//
// THE `no_offer` ITEM (FR-706a; N-2, N-10). Once the deadline has passed with no offer (after it,
// never at it: an offer at the deadline itself is accepted), one item; none while one is open, and
// «once per deadline»: none when an item of the kind was created at or after the current deadline.
// An extension moves the deadline past the closed item, so a new one may open at the new deadline.
//
// PAST `pay_by_at` UNPAID (FR-706, FR-706b, DEC-101). After `pay_by_at` (never at it): while a
// `pay_blocked` item is open nothing happens, also once the account is verified (only the decision
// or a close ends it); in live mode with the teacher's payout account unverified at that instant,
// the item once per deadline, in place of the lapse, and never a lapse; otherwise the lapse,
// `offer_lapsed`.
import { addHours } from '@ijazah/time';

import type { AssessmentOutcome } from '../sessions/index.js';

/** What the offer's deadline is derived from (this file's head). */
export interface OfferDueFacts {
  readonly outcome: AssessmentOutcome;
  /** The latest `extended` `no_offer` item's decision instant; null for none. */
  readonly extendedAt: Date | null;
  readonly offerHours: number;
}

/** The latest of `instants`. */
function latest(instants: readonly Date[]): Date | null {
  return instants.reduce<Date | null>(
    (found, instant) => (found === null || instant > found ? instant : found),
    null,
  );
}

/** The offer's deadline (this file's head); null while session 1 waits for its make-up. */
export function offerDueOf({ outcome, extendedAt, offerHours }: OfferDueFacts): Date | null {
  if (outcome.kind === 'waiting') return null;
  const deadlines = [new Date(addHours(outcome.endsAt, offerHours))];
  if (extendedAt !== null) deadlines.push(new Date(addHours(extendedAt, offerHours)));
  return latest(deadlines);
}

/** An `awaiting_offer` programme's facts, read under its row lock. */
export interface NoOfferFacts extends OfferDueFacts {
  readonly now: Date;
  /** A `no_offer` item is open. */
  readonly openItem: boolean;
  /** The latest `no_offer` item's creation instant, whatever its status; null for none. */
  readonly lastItemAt: Date | null;
}

/** The deadline to write, and whether the `no_offer` item opens now. */
export interface NoOfferStep {
  readonly offerDueAt: Date | null;
  readonly raise: boolean;
}

/** An `awaiting_offer` programme's step (this file's head, THE `no_offer` ITEM). */
export function noOfferStep(facts: NoOfferFacts): NoOfferStep {
  const offerDueAt = offerDueOf(facts);
  const raise =
    offerDueAt !== null &&
    facts.now > offerDueAt &&
    !facts.openItem &&
    (facts.lastItemAt === null || facts.lastItemAt < offerDueAt);
  return { offerDueAt, raise };
}

/** An `offered` programme's facts, read under its row lock. */
export interface PayWindowFacts {
  readonly now: Date;
  readonly payByAt: Date;
  /** A `pay_blocked` item is open. */
  readonly openItem: boolean;
  /** The latest `pay_blocked` item's creation instant, whatever its status; null for none. */
  readonly lastItemAt: Date | null;
  /** Payments' «unverified in live mode» at `now` (FR-706b). */
  readonly unverifiedInLiveMode: boolean;
}

/** What an `offered` programme's step does. */
export type PayStep = 'none' | 'lapse' | 'raise_pay_blocked';

/** Whether `pay_by_at` has passed at `now` (after it, never at it). */
export function payByPassed(now: Date, payByAt: Date): boolean {
  return now > payByAt;
}

/** An `offered` programme's step (this file's head, PAST `pay_by_at` UNPAID). */
export function payWindowStep(facts: PayWindowFacts): PayStep {
  if (!payByPassed(facts.now, facts.payByAt) || facts.openItem) return 'none';
  if (!facts.unverifiedInLiveMode) return 'lapse';
  return facts.lastItemAt === null || facts.lastItemAt < facts.payByAt
    ? 'raise_pay_blocked'
    : 'none';
}
