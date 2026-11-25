// 006:T020 (FR-705, FR-706b, FR-723, FR-726; SRS DEC-112; B-P4's conflict check, Q-2 (a)): what the
// teacher's programme panel offers, from `programme.get` alone; the server stays the guard of every
// action. The offer form only while awaiting the offer with the assessment delivered: `offerDueAt` is
// the delivered assessment's end plus the offer's hours, null until it is delivered. The offer as sent
// once offered and while it runs; the administration's line while `payBlocked` (FR-706b); the months
// while it runs, and «late since» while paused (FR-726). The stop request only from the server's
// `stopRequestFrom` on (`paused_at` + `programme_stop_request_days` on the database's clock, null
// unless paused), read on the phone's clock by `secondsUntil` (R-TIME-1); `too_early` stays the
// server's guard. No refusal request exists in the app (SRS DEC-112): nothing here offers one.
import type {
  ProgrammeGetOutput,
  ProgrammePrices,
  ProgrammeState,
  SessionLengthMinutes,
  TeacherPackage,
  TeacherProgrammePackage,
} from '@ijazah/contracts';
import { PROGRAMME_TEXT_MAX_LENGTH } from '@ijazah/contracts';
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
    offerForm: programme.state === 'awaiting_offer' && programme.offerDueAt !== null,
    sentOffer: SENT.includes(programme.state) && programme.offer !== null,
    payBlocked: programme.payBlocked,
    running: RUNNING.includes(programme.state),
    lateSince: programme.paused?.since ?? null,
  };
}

/** Whether the stop request's button shows: `now` has reached the server's `stopRequestFrom`. */
export function stopRequestShown(
  programme: Pick<ProgrammeGetOutput, 'stopRequestFrom'>,
  now: Date,
): boolean {
  const from = programme.stopRequestFrom;
  return from !== null && secondsUntil(from, now) === 0;
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

/**
 * The teacher's price of a session of `minutes` on the enrollment's subject, read from their one
 * programme package of it, to show the offer's total before it is sent; undefined with none or more
 * than one, as the enrollment read names no package. The server prices the offer itself (R-506).
 */
export function sessionPriceOf(
  packages: readonly TeacherPackage[],
  subjectId: string,
  minutes: SessionLengthMinutes,
): Piasters | undefined {
  const ofSubject = packages.filter(
    (item): item is TeacherProgrammePackage =>
      item.isProgramme === true && item.subject.id === subjectId,
  );
  const [only] = ofSubject;
  if (only === undefined || ofSubject.length > 1) return undefined;
  return piasters(only.prices[PRICE_OF_LENGTH[minutes]]);
}
