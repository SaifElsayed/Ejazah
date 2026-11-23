// 006:T008 of specs/006-programme (FR-706, FR-706a, FR-706b; R-505, R-508; SRS DEC-101; Q-3 (a)
// amended) — the windows as pure functions, for T015's sweep and T008's own steps: the offer's
// deadline derived from session 1's outcome chain and an administrator's extension; the `no_offer`
// item once per deadline; and past `pay_by_at`, the lapse, or in live mode with the payout account
// unverified the `pay_blocked` item once per deadline, never a lapse while one is open.
import { addSeconds } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { AssessmentOutcome } from '../sessions/index.js';
import {
  type NoOfferFacts,
  noOfferStep,
  offerDueOf,
  type PayWindowFacts,
  payWindowStep,
} from './programmes.rules.js';

/** Cairo is UTC+2 in November: 18:00 local is 16:00Z. */
const MONDAY_1800 = new Date('2026-11-23T16:00:00Z');
const TUESDAY_1800 = new Date('2026-11-24T16:00:00Z');
const TUESDAY_1900 = new Date('2026-11-24T17:00:00Z');
const WEDNESDAY_1000 = new Date('2026-11-25T08:00:00Z');
const THURSDAY_1000 = new Date('2026-11-26T08:00:00Z');
const THURSDAY_1800 = new Date('2026-11-26T16:00:00Z');
const FRIDAY_1800 = new Date('2026-11-27T16:00:00Z');
const after = (instant: Date) => new Date(addSeconds(instant, 1));

const delivered = (endsAt: Date): AssessmentOutcome => ({ kind: 'delivered', endsAt });
const WAITING: AssessmentOutcome = { kind: 'waiting' };

function offerFacts(change: Partial<NoOfferFacts> = {}): NoOfferFacts {
  return {
    outcome: delivered(MONDAY_1800),
    extendedAt: null,
    offerHours: 24,
    now: after(TUESDAY_1800),
    openItem: false,
    lastItemAt: null,
    ...change,
  };
}

describe('the offer’s deadline (FR-706a, R-505, Q-3 (a) amended)', () => {
  it('is the delivered assessment’s scheduled end + programme_offer_hours', () => {
    expect(offerDueOf(offerFacts())).toStrictEqual(TUESDAY_1800);
  });

  it('has none while session 1 waits for its make-up', () => {
    expect(offerDueOf(offerFacts({ outcome: WAITING }))).toBeNull();
  });

  it('is the end + programme_offer_hours when session 1 ended with no make-up pending (N-2)', () => {
    expect(
      offerDueOf(offerFacts({ outcome: { kind: 'ended', endsAt: MONDAY_1800 } })),
    ).toStrictEqual(TUESDAY_1800);
  });

  it('is the administrator’s extension + programme_offer_hours, counted from the decision', () => {
    expect(offerDueOf(offerFacts({ extendedAt: WEDNESDAY_1000 }))).toStrictEqual(THURSDAY_1000);
  });

  it('follows a later delivery past an earlier extension', () => {
    expect(
      offerDueOf(offerFacts({ outcome: delivered(THURSDAY_1800), extendedAt: WEDNESDAY_1000 })),
    ).toStrictEqual(FRIDAY_1800);
  });
});

describe('the owner’s example: a re-resolution moves the deadline (Q-3 (a) amended)', () => {
  it('done Monday 18:00 → due Tuesday 18:00', () => {
    expect(noOfferStep(offerFacts({ now: MONDAY_1800 }))).toStrictEqual({
      offerDueAt: TUESDAY_1800,
      raise: false,
    });
  });

  it('re-resolved Tuesday as the teacher’s no-show, the make-up pending: no deadline and no item at the old one', () => {
    expect(noOfferStep(offerFacts({ outcome: WAITING, now: TUESDAY_1900 }))).toStrictEqual({
      offerDueAt: null,
      raise: false,
    });
  });

  it('the make-up delivered Thursday 18:00 → due Friday 18:00, the item only after it', () => {
    const facts = offerFacts({ outcome: delivered(THURSDAY_1800) });
    expect(noOfferStep({ ...facts, now: FRIDAY_1800 })).toStrictEqual({
      offerDueAt: FRIDAY_1800,
      raise: false,
    });
    expect(noOfferStep({ ...facts, now: after(FRIDAY_1800) })).toStrictEqual({
      offerDueAt: FRIDAY_1800,
      raise: true,
    });
  });
});

describe('the no_offer item (FR-706a; I-2 (a); N-2, N-10)', () => {
  it('opens once the deadline has passed with no offer, never at the deadline itself', () => {
    expect(noOfferStep(offerFacts()).raise).toBe(true);
    expect(noOfferStep(offerFacts({ now: TUESDAY_1800 })).raise).toBe(false);
  });

  it('opens 24 h after the scheduled end when session 1 ended with no make-up pending (N-2)', () => {
    expect(
      noOfferStep(offerFacts({ outcome: { kind: 'ended', endsAt: MONDAY_1800 } })),
    ).toStrictEqual({ offerDueAt: TUESDAY_1800, raise: true });
  });

  it('opens no second item while one is open', () => {
    expect(noOfferStep(offerFacts({ openItem: true })).raise).toBe(false);
  });

  it('opens once per deadline: none when an item was created at or after it', () => {
    expect(noOfferStep(offerFacts({ lastItemAt: TUESDAY_1800 })).raise).toBe(false);
    expect(noOfferStep(offerFacts({ lastItemAt: after(TUESDAY_1800) })).raise).toBe(false);
  });

  it('opens a new item at the extension’s new deadline (closed `extended`)', () => {
    const extended = offerFacts({ extendedAt: WEDNESDAY_1000, lastItemAt: after(TUESDAY_1800) });
    expect(noOfferStep({ ...extended, now: THURSDAY_1000 }).raise).toBe(false);
    expect(noOfferStep({ ...extended, now: after(THURSDAY_1000) })).toStrictEqual({
      offerDueAt: THURSDAY_1000,
      raise: true,
    });
  });
});

/** Offered Monday 16:00Z: `pay_by_at` 48 hours later, Wednesday 16:00Z. */
const PAY_BY = new Date('2026-11-25T16:00:00Z');

function payFacts(change: Partial<PayWindowFacts> = {}): PayWindowFacts {
  return {
    now: after(PAY_BY),
    payByAt: PAY_BY,
    openItem: false,
    lastItemAt: null,
    unverifiedInLiveMode: false,
    ...change,
  };
}

describe('past pay_by_at unpaid: the lapse or the pay_blocked item (FR-706, FR-706b, DEC-101)', () => {
  it('does nothing until pay_by_at has passed, at pay_by_at itself included', () => {
    expect(payWindowStep(payFacts({ now: PAY_BY }))).toBe('none');
    expect(payWindowStep(payFacts({ now: PAY_BY, unverifiedInLiveMode: true }))).toBe('none');
  });

  it('the same in test mode lapses: offer_lapsed', () => {
    expect(payWindowStep(payFacts())).toBe('lapse');
  });

  it('unverified in live mode: no lapse, one item', () => {
    const first = payFacts({ unverifiedInLiveMode: true });
    expect(payWindowStep(first)).toBe('raise_pay_blocked');
    expect(payWindowStep({ ...first, openItem: true, lastItemAt: after(PAY_BY) })).toBe('none');
  });

  it('verified while the item is open: no lapse', () => {
    expect(payWindowStep(payFacts({ openItem: true, lastItemAt: after(PAY_BY) }))).toBe('none');
  });

  it('raises once per deadline: no second item for an item created at or after pay_by_at', () => {
    expect(payWindowStep(payFacts({ unverifiedInLiveMode: true, lastItemAt: PAY_BY }))).toBe(
      'none',
    );
  });

  it('raises a new item at an extension’s new pay_by_at', () => {
    const extendedPayBy = new Date('2026-11-28T10:00:00Z');
    expect(
      payWindowStep(
        payFacts({
          now: after(extendedPayBy),
          payByAt: extendedPayBy,
          unverifiedInLiveMode: true,
          lastItemAt: after(PAY_BY),
        }),
      ),
    ).toBe('raise_pay_blocked');
  });
});
