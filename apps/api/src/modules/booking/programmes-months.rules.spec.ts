// 006:T015 of specs/006-programme (FR-714, FR-717, FR-721; R-507, R-508, R-509; SRS DEC-110,
// DEC-113; B-P3's conflict check, Q-1 (a), Q-3 (a); Q-10 (a) adjusted; PR #153 r1 nit 5) — the
// months as pure functions (`programmes.rules.ts`): the due point by `lastToEnd` over the paid
// month's sessions; the due step's automatic order, only with a saved card and nothing pending; the
// retries 1, 3, 5, 7 days after the first failure, soft only, at most 4, only with a saved card, each
// after the gateway answered; the `charge_unknown` item after 6 unanswered asks every 10 minutes,
// withdrawn by an answer; the pause at the next occurrence with the month unpaid; the inquiry's
// cadence; and the DST spec: the day-7 retry is 168 hours on the instant, not the next occurrence.
//
// Example (Q-1 (a), DEC-113): month 2 of 1,000 EGP charged Thursday 18:31 Cairo; no answer; asked
// from 18:41 every 10 minutes; the sixth ask at 19:31 unanswered opens the item.
import { addHours, addMinutes, addSeconds, resolveOccurrences } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import {
  asksMade,
  type AutomaticOrderFacts,
  inquiryDue,
  type MonthFacts,
  monthStepOf,
  nextDueOf,
  nextOccurrenceAt,
  retryAtOf,
} from './programmes.rules.js';

/** Cairo is UTC+2 in November: Thursday 18:30 local is 16:30Z. */
const THURSDAY_1830 = new Date('2026-11-26T16:30:00Z');
const THURSDAY_1831 = new Date('2026-11-26T16:31:00Z');
const THURSDAY_1841 = new Date('2026-11-26T16:41:00Z');
const NEXT_THURSDAY_1800 = new Date('2026-12-03T16:00:00Z');
const later = (instant: Date, minutes: number) => new Date(addMinutes(instant, minutes));

const order = (change: Partial<AutomaticOrderFacts> = {}): AutomaticOrderFacts => ({
  paymentId: '019a4a00-0000-7000-8000-0000000000a1',
  status: 'created',
  expiresAt: THURSDAY_1841,
  declineKind: null,
  attempt: 0,
  failedAt: null,
  ...change,
});

function facts(change: Partial<MonthFacts> = {}): MonthFacts {
  return {
    now: THURSDAY_1831,
    state: 'active',
    nextDueAt: THURSDAY_1830,
    nextOccurrenceAt: NEXT_THURSDAY_1800,
    firstFailureAt: null,
    retriesDone: 0,
    retryDays: [1, 3, 5, 7],
    orders: { cardSaved: true, payable: false, processing: false, automatic: null },
    item: { open: false, lastAt: null },
    inquiry: { ttlMinutes: 10, tries: 6 },
    askedNoAnswer: false,
    ...change,
  };
}

const withOrders = (change: Partial<MonthFacts['orders']>, rest: Partial<MonthFacts> = {}) =>
  facts({ ...rest, orders: { ...facts().orders, ...change } });

describe('the due point (Q-3 (a); R-507 «lastToEnd»)', () => {
  const sessions = [
    { endsAt: new Date('2026-10-29T08:00:00Z') },
    { programmeMonth: 1, endsAt: new Date('2026-11-05T16:30:00Z') },
    { programmeMonth: 1, endsAt: THURSDAY_1830 },
    // A make-up of month 1 booked earlier in the week: its number is higher, its end earlier.
    { programmeMonth: 1, endsAt: new Date('2026-11-24T16:30:00Z') },
  ];

  it('is the latest end among the paid month’s sessions, make-ups included', () => {
    expect(nextDueOf({ plan: 'monthly', monthsPaid: 1, monthCount: 3, sessions })).toEqual(
      THURSDAY_1830,
    );
  });

  it('the owner’s example: the last session postponed a week moves it', () => {
    const postponed = [...sessions, { programmeMonth: 1, endsAt: later(THURSDAY_1830, 7 * 24 * 60) }];
    expect(
      nextDueOf({ plan: 'monthly', monthsPaid: 1, monthCount: 3, sessions: postponed }),
    ).toEqual(later(THURSDAY_1830, 7 * 24 * 60));
  });

  it('is none once every month is paid, in full, or before any month', () => {
    expect(nextDueOf({ plan: 'monthly', monthsPaid: 3, monthCount: 3, sessions })).toBeNull();
    expect(nextDueOf({ plan: 'in_full', monthsPaid: 3, monthCount: 3, sessions })).toBeNull();
    expect(nextDueOf({ plan: null, monthsPaid: 0, monthCount: 3, sessions })).toBeNull();
  });

  it('is none while the paid month has no session yet (a refused generation)', () => {
    expect(nextDueOf({ plan: 'monthly', monthsPaid: 2, monthCount: 3, sessions })).toBeNull();
  });
});

describe('the due step: the month’s automatic order (R-508 step 2, R-509)', () => {
  it('records attempt 0 at the due point with a saved card', () => {
    expect(monthStepOf('due', facts())).toEqual({ kind: 'due' });
  });

  it('nothing before the due point', () => {
    expect(monthStepOf('due', facts({ now: addSecondsTo(THURSDAY_1830, -1) }))).toBeNull();
  });

  it('red first: no automatic order without a saved card (the month by hand)', () => {
    expect(monthStepOf('due', withOrders({ cardSaved: false }))).toBeNull();
  });

  it.each([
    ['a programme order payable', { payable: true }],
    ['a paid order not yet processed', { processing: true }],
    ['the month’s automatic order already recorded', { automatic: order() }],
  ] as const)('red first: never twice: none while %s', (_name, change) => {
    expect(monthStepOf('due', withOrders(change))).toBeNull();
  });

  it('nothing while no month is due (all paid)', () => {
    expect(monthStepOf('due', facts({ nextDueAt: null }))).toBeNull();
  });
});

describe('the retry step (R-508 step 3; DEC-110, DEC-113; Q-10 (a) adjusted)', () => {
  const expired = order({ status: 'expired' });
  const soft = order({ status: 'failed', declineKind: 'soft' });
  const failedAt = THURSDAY_1841;

  it.each([
    ['expired with no transaction', expired],
    ['failed with a soft decline', soft],
  ] as const)('marks the first failure once: %s', (_name, automatic) => {
    expect(monthStepOf('retry', withOrders({ automatic }))).toEqual({ kind: 'failed' });
  });

  it('retries 1, 3, 5 and 7 days after the first failure, at most 4', () => {
    const at = (days: number) => later(failedAt, days * 24 * 60);
    for (const [retriesDone, days] of [
      [0, 1],
      [1, 3],
      [2, 5],
      [3, 7],
    ] as const) {
      const base = { firstFailureAt: failedAt, retriesDone, now: at(days) };
      expect(monthStepOf('retry', withOrders({ automatic: soft }, base))).toEqual({
        kind: 'retry',
        attempt: retriesDone + 1,
      });
      expect(
        monthStepOf('retry', withOrders({ automatic: soft }, { ...base, now: later(at(days), -1) })),
      ).toBeNull();
    }
    expect(
      monthStepOf(
        'retry',
        withOrders({ automatic: soft }, { firstFailureAt: failedAt, retriesDone: 4, now: at(30) }),
      ),
    ).toBeNull();
  });

  const due = { firstFailureAt: failedAt, retriesDone: 0, now: later(failedAt, 24 * 60) };

  it('red first: no retry on a hard decline', () => {
    const hard = order({ status: 'failed', declineKind: 'hard' });
    expect(monthStepOf('retry', withOrders({ automatic: hard }, due))).toBeNull();
    expect(monthStepOf('retry', withOrders({ automatic: hard }))).toBeNull();
  });

  it('red first: no retry without an authenticated kind (a failed callback not yet asked)', () => {
    const unknown = order({ status: 'failed', declineKind: null });
    expect(monthStepOf('retry', withOrders({ automatic: unknown }, due))).toBeNull();
  });

  it('red first: no retry while the earlier automatic order is unanswered (DEC-110 (4))', () => {
    expect(
      monthStepOf('retry', withOrders({ automatic: order({ expiresAt: THURSDAY_1831 }) }, due)),
    ).toBeNull();
  });

  it('red first: no retry without a saved card (turned off, or deleted at a suspension)', () => {
    expect(monthStepOf('retry', withOrders({ automatic: soft, cardSaved: false }, due))).toBeNull();
  });

  it.each([
    ['a manual order payable', { payable: true }],
    ['a paid order not yet processed', { processing: true }],
  ] as const)('red first: no retry while %s', (_name, change) => {
    expect(monthStepOf('retry', withOrders({ automatic: soft, ...change }, due))).toBeNull();
  });

  it('nothing with no automatic order, or a paid one', () => {
    expect(monthStepOf('retry', facts(due))).toBeNull();
    expect(monthStepOf('retry', withOrders({ automatic: order({ status: 'paid' }) }, due))).toBeNull();
  });

  it('the retry instants are whole days on the instant, none past the list', () => {
    expect(retryAtOf(failedAt, 0, [1, 3, 5, 7])).toEqual(new Date(addHours(failedAt, 24)));
    expect(retryAtOf(failedAt, 3, [1, 3, 5, 7])).toEqual(new Date(addHours(failedAt, 168)));
    expect(retryAtOf(failedAt, 4, [1, 3, 5, 7])).toBeNull();
    expect(retryAtOf(failedAt, 0, [])).toBeNull();
  });
});

describe('the charge_unknown item (Q-1 (a), DEC-113 (1))', () => {
  const unanswered = order({ expiresAt: THURSDAY_1841 });
  const sixthAsk = later(THURSDAY_1841, 50);

  it('the owner’s example: the sixth unanswered ask, 19:31, opens it', () => {
    expect(
      monthStepOf(
        'item',
        withOrders({ automatic: unanswered }, { now: sixthAsk, askedNoAnswer: true }),
      ),
    ).toEqual({ kind: 'raise_item' });
  });

  it('red first: not at the fifth ask (19:21)', () => {
    expect(
      monthStepOf(
        'item',
        withOrders(
          { automatic: unanswered },
          { now: later(THURSDAY_1841, 40), askedNoAnswer: true },
        ),
      ),
    ).toBeNull();
  });

  it('red first: no second item for the same order (open, or decided after its expiry)', () => {
    const base = { now: later(sixthAsk, 10), askedNoAnswer: true };
    expect(
      monthStepOf(
        'item',
        withOrders({ automatic: unanswered }, { ...base, item: { open: true, lastAt: sixthAsk } }),
      ),
    ).toBeNull();
    expect(
      monthStepOf(
        'item',
        withOrders({ automatic: unanswered }, { ...base, item: { open: false, lastAt: sixthAsk } }),
      ),
    ).toBeNull();
  });

  it('only on a minute this run asked and the gateway answered nothing', () => {
    expect(
      monthStepOf('item', withOrders({ automatic: unanswered }, { now: sixthAsk })),
    ).toBeNull();
  });

  it.each([
    ['paid', order({ status: 'paid' })],
    ['expired (no transaction)', order({ status: 'expired' })],
    ['failed', order({ status: 'failed', declineKind: 'soft' })],
    ['gone with the month paid', null],
  ] as const)('an answer withdraws the open item: %s', (_name, automatic) => {
    expect(
      monthStepOf('item', withOrders({ automatic }, { item: { open: true, lastAt: sixthAsk } })),
    ).toEqual({ kind: 'withdraw_item' });
  });

  it('red first: an open item stays while the order is still unanswered', () => {
    expect(
      monthStepOf(
        'item',
        withOrders(
          { automatic: unanswered },
          { now: later(sixthAsk, 10), item: { open: true, lastAt: sixthAsk } },
        ),
      ),
    ).toBeNull();
  });
});

describe('the pause step (R-507, R-508 step 4; FR-BOOK-17)', () => {
  it('pauses at the next occurrence’s start with the month unpaid, paused since that start', () => {
    expect(monthStepOf('pause', facts({ now: NEXT_THURSDAY_1800 }))).toEqual({
      kind: 'pause',
      pausedAt: NEXT_THURSDAY_1800,
    });
  });

  it('red first: nothing before the next occurrence starts', () => {
    expect(monthStepOf('pause', facts({ now: later(NEXT_THURSDAY_1800, -1) }))).toBeNull();
  });

  it('red first: no pause while the month is paid and not yet processed', () => {
    expect(
      monthStepOf('pause', withOrders({ processing: true }, { now: NEXT_THURSDAY_1800 })),
    ).toBeNull();
  });

  it('nothing once paused, or with nothing due', () => {
    expect(
      monthStepOf('pause', facts({ state: 'paused', now: NEXT_THURSDAY_1800 })),
    ).toBeNull();
    expect(
      monthStepOf(
        'pause',
        facts({ nextDueAt: null, nextOccurrenceAt: null, now: NEXT_THURSDAY_1800 }),
      ),
    ).toBeNull();
  });

  it('pauses while an automatic charge is still unanswered: the month is unpaid', () => {
    expect(
      monthStepOf('pause', withOrders({ automatic: order() }, { now: NEXT_THURSDAY_1800 })),
    ).toEqual({ kind: 'pause', pausedAt: NEXT_THURSDAY_1800 });
  });
});

describe('the inquiry’s cadence (Q-1 (a); Q-10 (a) adjusted)', () => {
  it('asks at the expiry, then every 10 minutes, on the sweep minute that reaches each', () => {
    const asked = (minutes: number, seconds = 0) =>
      inquiryDue(new Date(addSeconds(later(THURSDAY_1841, minutes), seconds)), order(), 10, 6);
    expect([asked(0), asked(0, 59), asked(1), asked(9), asked(10), asked(20), asked(50)]).toEqual([
      true,
      true,
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it('red first: never before the expiry', () => {
    expect(inquiryDue(later(THURSDAY_1841, -1), order(), 10, 6)).toBe(false);
  });

  // The owner's answer to lane c's Q-5 (2026-11-24): a failed order with no kind is asked on the
  // sweep minute after the failure, then every 10 minutes, at most 6 times; then asking stops and
  // nothing is written (no item): the order stays failed with no kind, never retried.
  describe('a failed order with no kind (Q-5)', () => {
    const failedAt = THURSDAY_1841;
    const failed = order({ status: 'failed', declineKind: null, failedAt });
    const asked = (minutes: number, seconds = 0) =>
      inquiryDue(new Date(addSeconds(later(failedAt, minutes), seconds)), failed, 10, 6);

    it('red first: the first ask on the sweep minute after the failure, not within its own minute', () => {
      expect([asked(0), asked(0, 59), asked(1), asked(1, 59)]).toEqual([false, false, true, true]);
    });

    it('red first: the next asks every 10 minutes: at +11, not at +2', () => {
      expect([asked(2), asked(10), asked(11), asked(21), asked(51)]).toEqual([
        false,
        false,
        true,
        true,
        true,
      ]);
    });

    it('red first: nothing after the sixth ask (+51): asking stops', () => {
      expect([asked(61), asked(71), asked(24 * 60 + 1)]).toEqual([false, false, false]);
    });

    it('no retry throughout: the kind is unknown', () => {
      for (const minutes of [1, 51, 61, 7 * 24 * 60]) {
        expect(
          monthStepOf(
            'retry',
            withOrders(
              { automatic: failed },
              { now: later(failedAt, minutes), firstFailureAt: failedAt, retriesDone: 0 },
            ),
          ),
        ).toBeNull();
      }
    });

    it('a later authenticated soft kind starts the retries from then', () => {
      const soft = { ...failed, declineKind: 'soft' as const };
      const answeredAt = later(failedAt, 3 * 24 * 60);
      expect(monthStepOf('retry', withOrders({ automatic: soft }, { now: answeredAt }))).toEqual({
        kind: 'failed',
      });
      expect(
        monthStepOf(
          'retry',
          withOrders(
            { automatic: soft },
            { now: later(answeredAt, 24 * 60), firstFailureAt: answeredAt, retriesDone: 0 },
          ),
        ),
      ).toEqual({ kind: 'retry', attempt: 1 });
    });
  });

  it('red first: asks nothing about a settled order', () => {
    for (const settled of [
      order({ status: 'paid' }),
      order({ status: 'expired' }),
      order({ status: 'failed', declineKind: 'hard' }),
      order({ status: 'failed', declineKind: 'soft' }),
    ]) {
      expect(inquiryDue(later(THURSDAY_1841, 10), settled, 10, 6)).toBe(false);
    }
  });

  it('counts the asks: the sixth at the expiry + 50 minutes', () => {
    expect(asksMade(THURSDAY_1841, THURSDAY_1841, 10)).toBe(1);
    expect(asksMade(later(THURSDAY_1841, 49), THURSDAY_1841, 10)).toBe(5);
    expect(asksMade(later(THURSDAY_1841, 50), THURSDAY_1841, 10)).toBe(6);
    expect(asksMade(later(THURSDAY_1841, -1), THURSDAY_1841, 10)).toBe(0);
  });
});

describe('the next occurrence and the day-7 retry across a DST change (PR #153 r1 nit 5)', () => {
  // Egypt's clocks go forward on Friday 2027-04-30 at 00:00 (EET +2 → EEST +3). A Thursday 09:00
  // Cairo weekly time; the first failure on Thursday 2027-04-29 09:00 (07:00Z).
  const slot = { dayOfWeek: 4, startTimeLocal: '09:00:00', durationMinutes: 60 };
  const failedAt = new Date('2027-04-29T07:00:00Z');

  it('the next occurrence is the next Thursday 09:00 local, 167 hours later on the instant', () => {
    const [expected] = resolveOccurrences(
      { dayOfWeek: 4, startTimeLocal: '09:00:00', durationMinutes: 60, timezone: 'Africa/Cairo' },
      { fromLocalDate: '2027-05-06', count: 1 },
    );
    const next = nextOccurrenceAt(slot, 'Africa/Cairo', new Date(addSeconds(failedAt, 1)));
    expect(next).toEqual(new Date(expected?.startsAt ?? ''));
    expect(next).toEqual(new Date('2027-05-06T06:00:00Z'));
  });

  it('red first: the day-7 retry is 168 hours on the instant: 10:00 local, an hour after that occurrence starts', () => {
    expect(retryAtOf(failedAt, 3, [1, 3, 5, 7])).toEqual(new Date('2027-05-06T07:00:00Z'));
  });

  it('an occurrence starting exactly at the instant is that occurrence', () => {
    expect(nextOccurrenceAt(slot, 'Africa/Cairo', failedAt)).toEqual(failedAt);
  });
});

function addSecondsTo(instant: Date, seconds: number): Date {
  return new Date(addSeconds(instant, seconds));
}
