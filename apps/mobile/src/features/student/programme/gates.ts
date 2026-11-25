// 006:T019 (FR-706b, FR-710, FR-713, FR-713a, FR-715, FR-716, FR-726, FR-BOOK-19): what the
// student's programme panel offers, from `programme.get` alone; the server stays the guard of every
// action. On the offer (`offered`): «pay in full» and «pay monthly» unless an administrator is
// deciding (`payBlocked`, FR-706b) or the teacher's payment details are unverified (`payeePending`,
// FR-716), each with its line, the administration's first; the cancellation always (FR-706). On a
// running programme (`active`, `paused`): «renew now» with no card saved, «pay now» and «change
// card» with one, only while `renewOpen` and never while `payeePending` or `chargePending`, each
// with its line; the automatic renewal's off row only while a card is saved (FR-713a). The consent
// (FR-713) saves the card on «monthly» only: in full has no later month to charge. The reminder
// (FR-708, SRS DEC-114): «pay before» while `offered`, from the server's `payReminderFrom` on.
import { secondsUntil } from '@ijazah/time/calendar';

import type {
  EnrollmentProgramme,
  ProgrammeGetOutput,
  ProgrammePlan,
  ProgrammeState,
} from '@ijazah/contracts';

export type RenewalButton = 'renewNow' | 'payNow' | 'changeCard';
export type OfferLine = 'payBlocked' | 'payeePending';

export interface OfferView {
  /** «pay in full» and «pay monthly». */
  readonly pay: boolean;
  readonly line: OfferLine | null;
  readonly cancel: boolean;
}

export interface RenewalView {
  readonly buttons: readonly RenewalButton[];
  /** Payment opens once the teacher's payment details are verified (FR-716). */
  readonly payeeLine: boolean;
  /** This month's charge is already under way (FR-713a). */
  readonly chargeLine: boolean;
}

export interface ProgrammeView {
  readonly offer: OfferView | null;
  readonly renewal: RenewalView | null;
  readonly autoRenewOff: boolean;
  readonly pausedSince: string | null;
  readonly unavailable: boolean;
}

/** The states a paid programme runs in, renewed month by month. */
const RUNNING: readonly ProgrammeState[] = ['active', 'paused'];

function offerOf(programme: ProgrammeGetOutput): OfferView | null {
  if (programme.state !== 'offered') return null;
  const line: OfferLine | null = programme.payBlocked
    ? 'payBlocked'
    : programme.payeePending
      ? 'payeePending'
      : null;
  return { pay: line === null, line, cancel: true };
}

function renewalOf(programme: ProgrammeGetOutput): RenewalView | null {
  if (!RUNNING.includes(programme.state)) return null;
  const { renewOpen, payeePending, chargePending, card } = programme;
  const open = renewOpen && !payeePending && !chargePending;
  const buttons: readonly RenewalButton[] = !open
    ? []
    : card === null
      ? ['renewNow']
      : ['payNow', 'changeCard'];
  return { buttons, payeeLine: payeePending, chargeLine: chargePending };
}

export function programmeViewOf(programme: ProgrammeGetOutput): ProgrammeView {
  return {
    offer: offerOf(programme),
    renewal: renewalOf(programme),
    autoRenewOff: programme.card !== null && RUNNING.includes(programme.state),
    pausedSince: programme.paused?.since ?? null,
    unavailable: programme.teacherUnavailable,
  };
}

/** `programme.pay`'s plan and consent: the card saved on «monthly» with the box ticked only. */
export function payInputOf(
  plan: ProgrammePlan,
  consent: boolean,
): { readonly plan: ProgrammePlan; readonly saveCard: boolean } {
  return { plan, saveCard: plan === 'monthly' && consent };
}

/** `programme.renew`'s `saveCard`: «change card» pays with a new card that replaces the saved one. */
export function renewInputOf(button: RenewalButton): { readonly saveCard: boolean } {
  return { saveCard: button === 'changeCard' };
}

/**
 * The reminder's deadline (FR-708, SRS DEC-114): `payBy` while the offer awaits payment and `now` has
 * reached the server's `payReminderFrom` (`payBy` − `programme_pay_reminder_hours`); else null. The
 * instant is read on the phone's clock by `secondsUntil` (R-TIME-1); the phone reads no setting.
 */
export function payReminderOf(
  programme: EnrollmentProgramme | undefined,
  now: Date,
): string | null {
  if (programme?.state !== 'offered') return null;
  const { payBy, payReminderFrom } = programme;
  if (payBy === null || payReminderFrom === null) return null;
  return secondsUntil(payReminderFrom, now) === 0 ? payBy : null;
}
