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
import {
  addDays,
  addHours,
  addMinutes,
  calendarWeeksAfter,
  type DayOfWeek,
  localDateIn,
  resolveOccurrences,
  unixSeconds,
} from '@ijazah/time';
import { calendarDaysBefore } from '@ijazah/time/calendar';

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

// ---------------------------------------------------------------------------------------------
// 006:T015 of specs/006-programme (FR-714, FR-717, FR-721; R-507, R-508, R-509; SRS DEC-110,
// DEC-113; B-P3's conflict check, Q-1 (a), Q-3 (a); Q-10 (a) adjusted): the months as pure
// functions, for `advance-programmes`' steps (`programmes.service.ts`, `createProgrammeMonths`).
// No clock and no read: the caller passes `now` (the database's) and the facts it read.
//
// THE DUE POINT (Q-3 (a); R-507). The paid month's last session's end, `lastToEnd`: the latest end
// among the sessions of month `months_paid`, make-ups and postponements included (they take their
// original's month), never by sequence number. None in full, once every month is paid, before the
// first payment, or while the paid month has no session (its generation refused: the case's). The
// sweep derives it on every step and writes the column when it moved.
//
// THE STEPS, each its own transaction under the programme's row lock (R-508):
// - `due` (step 2): at the due point, with a saved card, the month's automatic order, attempt 0;
//   never while a programme order is payable or paid and not yet processed, nor once the month has
//   an automatic order («pending», A-1). Without a card the month is by hand.
// - `retry` (step 3): the month's latest automatic order soft-declined (failed `soft`, or `expired`:
//   no transaction, DEC-110 (3)) marks the first failure once; then retries at
//   `programme_charge_retry_days` (1, 3, 5, 7) whole days on the instant after it, at most 4, only
//   with a saved card and nothing pending. A hard decline, a failure whose kind the gateway has not
//   yet answered (Q-10 (a) adjusted: no retry without an authenticated kind) and an order still
//   unanswered (DEC-110 (4)) are never retried.
// - `item` (Q-1 (a), DEC-113 (1)): the month's automatic order unanswered past its expiry, asked at
//   the expiry and then every `slot_hold_ttl_minutes` (10); on the sweep minute the ask that is the
//   `programme_charge_inquiry_tries`th (6) or later answers nothing, the `charge_unknown` item, once
//   per order (none open, none created since the order's expiry); an open item withdrawn once the
//   order is answered (paid, failed, expired) or gone.
// - `pause` (step 4; FR-BOOK-17): an `active` programme whose month is unpaid when the next weekly
//   occurrence after the due point starts: `paused`, since that start. A paid, unprocessed order
//   holds it.
//
// THE CADENCE. The asks are counted from the order's expiry on the instant: the k-th is due at the
// expiry + (k − 1) × 10 minutes and is asked on the sweep minute that reaches it (the sweep runs every
// minute), so no ask is stored. A failed order whose kind the gateway has not yet answered (Q-10 (a)
// adjusted; the owner's answer to lane c's Q-5, 2026-11-24) is asked on the sweep minute after the
// failure, then every 10 minutes, at most `programme_charge_inquiry_tries` (6) times; then asking stops
// and nothing is written: the order stays failed with no kind, never retried, the month by hand; a
// later authenticated soft kind starts the retries from then.

/** A session of the programme as the due point reads it: its month (none for the assessment). */
export interface MonthSession {
  readonly programmeMonth?: number;
  readonly endsAt: Date;
}

/** What the due point is derived from, read under the programme's row lock. */
export interface DueFacts {
  readonly plan: 'in_full' | 'monthly' | null;
  readonly monthsPaid: number;
  readonly monthCount: number | null;
  readonly sessions: readonly MonthSession[];
}

/** The due point (this section's head, THE DUE POINT). */
export function nextDueOf({ plan, monthsPaid, monthCount, sessions }: DueFacts): Date | null {
  if (plan !== 'monthly' || monthCount === null || monthsPaid < 1 || monthsPaid >= monthCount) {
    return null;
  }
  return latest(
    sessions.filter(({ programmeMonth }) => programmeMonth === monthsPaid).map((one) => one.endsAt),
  );
}

/** The month's latest automatic order, as payments answers it. */
export interface AutomaticOrderFacts {
  readonly paymentId: string;
  readonly status: 'created' | 'paid' | 'failed' | 'expired' | 'refunded';
  readonly expiresAt: Date;
  readonly declineKind: 'soft' | 'hard' | null;
  readonly attempt: number;
  /** When the order failed (its `updated_at` as payments reads it); null unless `failed`. */
  readonly failedAt: Date | null;
}

/** The month's orders, as payments answers them under the enrollment's lock. */
export interface MonthOrders {
  /** A saved card exists (never a card detail). */
  readonly cardSaved: boolean;
  /** A programme order of the enrollment is `created` and unexpired. */
  readonly payable: boolean;
  /** A programme order is paid and not yet processed by the confirm step. */
  readonly processing: boolean;
  /** The month's latest automatic order; null for none. */
  readonly automatic: AutomaticOrderFacts | null;
}

/** An active or paused programme's month, read under its row lock (or with none, to survey). */
export interface MonthFacts {
  readonly now: Date;
  readonly state: 'active' | 'paused';
  /** The derived due point (`nextDueOf`); null while nothing is due or more is to be paid. */
  readonly nextDueAt: Date | null;
  /** The first weekly occurrence starting at or after `nextDueAt`; null with no due point. */
  readonly nextOccurrenceAt: Date | null;
  readonly firstFailureAt: Date | null;
  readonly retriesDone: number;
  /** `programme_charge_retry_days`, [1, 3, 5, 7] by default. */
  readonly retryDays: readonly number[];
  readonly orders: MonthOrders;
  /** The `charge_unknown` item: one open, and the latest's creation instant. */
  readonly item: { readonly open: boolean; readonly lastAt: Date | null };
  /** `slot_hold_ttl_minutes` (10) and `programme_charge_inquiry_tries` (6). */
  readonly inquiry: { readonly ttlMinutes: number; readonly tries: number };
  /** This run's ask about the month's automatic order answered nothing. */
  readonly askedNoAnswer: boolean;
}

/** The sweep's steps on a paid programme, each in its own transaction (R-508). */
export type MonthStepKind = 'item' | 'retry' | 'due' | 'pause';

/** What a step does. */
export type MonthAction =
  | { readonly kind: 'withdraw_item' }
  | { readonly kind: 'raise_item' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'retry'; readonly attempt: number }
  | { readonly kind: 'due' }
  | { readonly kind: 'pause'; readonly pausedAt: Date };

/** The seconds in `minutes` minutes from `at`, through `packages/time` (no literal, R-MONEY-12). */
function secondsIn(minutes: number, at: Date): number {
  return unixSeconds(new Date(addMinutes(at, minutes))) - unixSeconds(at);
}

/** Whether the month is due and unpaid (a due point exists and has passed). */
function monthDue(facts: MonthFacts): boolean {
  return facts.nextDueAt !== null && facts.now >= facts.nextDueAt;
}

/** Whether a programme order is payable, or paid and not yet processed («pending», A-1). */
function pending({ orders }: MonthFacts): boolean {
  return orders.payable || orders.processing;
}

/** The month's latest automatic order soft-declined: failed `soft`, or `expired` (DEC-110 (3)). */
function softDeclined(order: AutomaticOrderFacts | null): boolean {
  if (order === null) return false;
  return order.status === 'expired' || (order.status === 'failed' && order.declineKind === 'soft');
}

/** The month's latest automatic order unanswered past its expiry. */
function unanswered(order: AutomaticOrderFacts | null, now: Date): order is AutomaticOrderFacts {
  return order !== null && order.status === 'created' && now >= order.expiresAt;
}

function dueStep(facts: MonthFacts): MonthAction | null {
  if (!monthDue(facts) || pending(facts) || facts.orders.automatic !== null) return null;
  return facts.orders.cardSaved ? { kind: 'due' } : null;
}

function retryStep(facts: MonthFacts): MonthAction | null {
  if (!softDeclined(facts.orders.automatic)) return null;
  if (facts.firstFailureAt === null) return { kind: 'failed' };
  const at = retryAtOf(facts.firstFailureAt, facts.retriesDone, facts.retryDays);
  if (at === null || facts.now < at) return null;
  if (!facts.orders.cardSaved || pending(facts)) return null;
  return { kind: 'retry', attempt: facts.retriesDone + 1 };
}

function itemStep(facts: MonthFacts): MonthAction | null {
  const order = facts.orders.automatic;
  if (!unanswered(order, facts.now)) {
    return facts.item.open ? { kind: 'withdraw_item' } : null;
  }
  if (facts.item.open || !facts.askedNoAnswer) return null;
  if (facts.item.lastAt !== null && facts.item.lastAt >= order.expiresAt) return null;
  const asks = asksMade(facts.now, order.expiresAt, facts.inquiry.ttlMinutes);
  return asks >= facts.inquiry.tries ? { kind: 'raise_item' } : null;
}

function pauseStep(facts: MonthFacts): MonthAction | null {
  const startsAt = facts.nextOccurrenceAt;
  if (facts.state !== 'active' || !monthDue(facts) || startsAt === null) return null;
  if (facts.now < startsAt || facts.orders.processing) return null;
  return { kind: 'pause', pausedAt: startsAt };
}

const STEPS: Readonly<Record<MonthStepKind, (facts: MonthFacts) => MonthAction | null>> = {
  item: itemStep,
  retry: retryStep,
  due: dueStep,
  pause: pauseStep,
};

/** What `step` does on `facts` (this section's head, THE STEPS); null for nothing. */
export function monthStepOf(step: MonthStepKind, facts: MonthFacts): MonthAction | null {
  return STEPS[step](facts);
}

/**
 * The instant of the retry after `retriesDone` retries: the first failure + that day of
 * `retryDays`, in whole 24-hour days on the instant (`packages/time`, R-TIME-1; never the next
 * occurrence's wall-clock); null when none is left (at most 4, the setting's bound).
 */
export function retryAtOf(
  firstFailureAt: Date,
  retriesDone: number,
  retryDays: readonly number[],
): Date | null {
  const days = retryDays[retriesDone];
  return days === undefined ? null : new Date(addDays(firstFailureAt, days));
}

/** Whether this sweep minute asks the gateway about `order` (this section's head, THE CADENCE). */
export function inquiryDue(
  now: Date,
  order: AutomaticOrderFacts,
  ttlMinutes: number,
  tries: number,
): boolean {
  if (order.status === 'failed') {
    if (order.declineKind !== null) return false;
    // Q-5: from the sweep minute after the failure, every `ttlMinutes`, at most `tries` asks.
    const first = new Date(addMinutes(order.failedAt ?? order.expiresAt, 1));
    return askMinute(now, first, ttlMinutes) && asksMade(now, first, ttlMinutes) <= tries;
  }
  return unanswered(order, now) && askMinute(now, order.expiresAt, ttlMinutes);
}

/** Whether `now` falls in the sweep minute of an ask, the first at `first`, then every `ttlMinutes`. */
function askMinute(now: Date, first: Date, ttlMinutes: number): boolean {
  const elapsedSeconds = unixSeconds(now) - unixSeconds(first);
  // The sweep runs every minute (`EVERY_MINUTE`): the ask falls in the minute that reaches it.
  return elapsedSeconds >= 0 && elapsedSeconds % secondsIn(ttlMinutes, now) < secondsIn(1, now);
}

/** How many asks the cadence has made by `now`: one at the expiry, then one every `ttlMinutes`. */
export function asksMade(now: Date, expiresAt: Date, ttlMinutes: number): number {
  const elapsedSeconds = unixSeconds(now) - unixSeconds(expiresAt);
  return elapsedSeconds < 0 ? 0 : Math.floor(elapsedSeconds / secondsIn(ttlMinutes, now)) + 1;
}

/**
 * The weekly time's first occurrence starting at or after `after`, in `timezone`: week by week from
 * the day before `after`'s local date, each resolved on its own date (R-TIME-2), never by adding
 * intervals.
 */
export function nextOccurrenceAt(
  slot: {
    readonly dayOfWeek: number;
    readonly startTimeLocal: string;
    readonly durationMinutes: number;
  },
  timezone: string,
  after: Date,
): Date {
  const weekly = {
    // `availability_slots.day_of_week` is 0 to 6 by its check (ERD §15 rule 37); the package asserts it.
    dayOfWeek: slot.dayOfWeek as DayOfWeek,
    startTimeLocal: slot.startTimeLocal,
    durationMinutes: slot.durationMinutes,
    timezone,
  };
  let from = calendarDaysBefore(localDateIn(after, timezone), 1);
  for (;;) {
    const [occurrence] = resolveOccurrences(weekly, { fromLocalDate: from, count: 1 });
    if (occurrence === undefined) throw new Error('resolveOccurrences answered no occurrence');
    const startsAt = new Date(occurrence.startsAt);
    if (startsAt >= after) return startsAt;
    from = calendarWeeksAfter(occurrence.requestedLocalDate, 1);
  }
}
