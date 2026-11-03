// T046 (FR-380, FR-382, FR-384, R-HONEST-1): which outcome screen an enrollment's status, as the
// server reports it on `checkout.status`, leads to. Success only on `confirmed`. A failure only where
// the server reports the order failed (the hold stays for a Retry, FR-365) or the enrollment
// cancelled. An order that expired while its hold's grace still runs is pending: a payment started in
// its last moments is still confirmed on that hold (FR-PAYG-6), and the hold's expiry cancels it.
// A cancelled enrollment with a paid order is the paid event the slot could not honour (FR-362).
import type { CheckoutStatusOutput, PaymentStatus } from '@ijazah/contracts';
import type { Href } from 'expo-router';

export type CheckoutOutcome =
  'pending' | 'confirmed' | 'failed' | 'expired' | 'slotUnavailable' | 'ended';

/** The enrollments tab, where the released student and the ended enrollment go. */
export const ENROLLMENTS_ROUTE = '/(student)/(tabs)/enrollments';

/** An order the student paid: a cancelled enrollment carrying one is FR-362's refusal. */
const PAID: readonly PaymentStatus[] = ['paid', 'refunded'];

export function outcomeOf(
  read: Pick<CheckoutStatusOutput, 'status' | 'cancellationReason' | 'lastOrder'>,
): CheckoutOutcome {
  switch (read.status) {
    case 'confirmed':
      return 'confirmed';
    case 'pending_payment':
      return read.lastOrder.status === 'failed' ? 'failed' : 'pending';
    case 'cancelled':
      return read.cancellationReason === 'slot_unavailable' || PAID.includes(read.lastOrder.status)
        ? 'slotUnavailable'
        : 'expired';
    case 'completed':
    case 'terminated_no_show':
      return 'ended';
  }
}

/** Each outcome's screen under `(student)/checkout/`; `expired` is T045's `CheckoutExpired`. */
const SCREEN: Readonly<Record<Exclude<CheckoutOutcome, 'ended'>, string>> = {
  pending: 'processing',
  confirmed: 'confirmed',
  failed: 'failed',
  slotUnavailable: 'slot-unavailable',
  expired: 'expired',
};

export function outcomeRoute(outcome: CheckoutOutcome, enrollmentId: string): Href {
  if (outcome === 'ended') return ENROLLMENTS_ROUTE;
  return { pathname: `/(student)/checkout/${SCREEN[outcome]}`, params: { enrollmentId } };
}
