// T046 (FR-380, FR-382, FR-384, R-HONEST-1): which outcome screen an enrollment's server status
// leads to. Success only on the server's `confirmed`; a failure only where the server reports the
// order failed or the enrollment cancelled; an order expired while its hold's grace runs is still
// pending, since a payment started in its last moments is still confirmed on its hold (FR-PAYG-6).
import type { CheckoutStatusOutput } from '@ijazah/contracts';
import { describe, expect, it } from '@jest/globals';

import { type CheckoutOutcome, outcomeOf, outcomeRoute } from './outcome';

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';

type Read = Pick<CheckoutStatusOutput, 'status' | 'cancellationReason' | 'lastOrder'>;

const read = (
  status: Read['status'],
  order: Read['lastOrder']['status'],
  cancellationReason?: Read['cancellationReason'],
): Read => ({
  status,
  lastOrder: { status: order, reference: 'IJZ-7Q4K2M' },
  ...(cancellationReason === undefined ? {} : { cancellationReason }),
});

describe('outcomeOf', () => {
  it.each<[string, Read, CheckoutOutcome]>([
    ['confirmed', read('confirmed', 'paid'), 'confirmed'],
    ['an order still payable', read('pending_payment', 'created'), 'pending'],
    ['an order paid, confirmation to come', read('pending_payment', 'paid'), 'pending'],
    ['an order expired inside the hold grace', read('pending_payment', 'expired'), 'pending'],
    ['an order the gateway failed', read('pending_payment', 'failed'), 'failed'],
    [
      'cancelled with slot_unavailable',
      read('cancelled', 'paid', 'slot_unavailable'),
      'slotUnavailable',
    ],
    [
      'cancelled with a paid order (a suspension, FR-362)',
      read('cancelled', 'paid', 'teacher_suspended'),
      'slotUnavailable',
    ],
    ['cancelled on expiry', read('cancelled', 'expired', 'payment_expired'), 'expired'],
    ['cancelled after a failure', read('cancelled', 'failed', 'payment_failed'), 'expired'],
    ['cancelled by a new checkout', read('cancelled', 'failed', 'checkout_abandoned'), 'expired'],
    ['completed', read('completed', 'paid'), 'ended'],
    ['terminated', read('terminated_no_show', 'paid'), 'ended'],
  ])('%s', (_name, status, outcome) => {
    expect(outcomeOf(status)).toBe(outcome);
  });
});

describe('outcomeRoute', () => {
  it('names each outcome screen under (student)/checkout with the enrollment', () => {
    const at = (outcome: CheckoutOutcome) => outcomeRoute(outcome, ENROLLMENT_ID);
    const params = { enrollmentId: ENROLLMENT_ID };
    expect(at('pending')).toEqual({ pathname: '/(student)/checkout/processing', params });
    expect(at('confirmed')).toEqual({ pathname: '/(student)/checkout/confirmed', params });
    expect(at('failed')).toEqual({ pathname: '/(student)/checkout/failed', params });
    expect(at('slotUnavailable')).toEqual({
      pathname: '/(student)/checkout/slot-unavailable',
      params,
    });
    expect(at('expired')).toEqual({ pathname: '/(student)/checkout/expired', params });
    expect(at('ended')).toBe('/(student)/(tabs)/enrollments');
  });
});
