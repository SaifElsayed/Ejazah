// T007 (R-209, FR-368, ADR 0009 D1): an occurrence carries the local date and start it was asked
// for beside where it landed, and `firstOccurrenceAfter` finds the first occurrence at least the
// lead after an instant, each candidate resolved from its own local date (R-TIME-1, R-TIME-2).
//
// Why these dates. They were read out of the time zone data this package resolves with (Node 24.13,
// tz 2025b, ICU 77.1) by scanning `Africa/Cairo` at 15-minute steps across 2026 and 2027:
//
//   2026 gap     2026-04-23T22:00:00Z — Friday 2026-04-24 00:00 (+02:00) becomes 01:00 (+03:00)
//   2026 overlap 2026-10-29T21:00:00Z — Thursday 2026-10-29 24:00 (+03:00) becomes 23:00 (+02:00)
//   2027 gap     2027-04-29T22:00:00Z — Friday 2027-04-30 00:00 (+02:00) becomes 01:00 (+03:00)
//   2027 overlap 2027-10-28T21:00:00Z — Thursday 2027-10-28 24:00 (+03:00) becomes 23:00 (+02:00)
//
// So Friday 00:30 never happens on 2026-04-24 and 2027-04-30, and Thursday 23:30 happens twice on
// 2026-10-29 and 2027-10-28. Ramadan (from about 18 February 2026 and 8 February 2027) ends before
// April, so neither year's rule is suspended.
import { describe, expect, it } from 'vitest';

import {
  firstOccurrenceAfter,
  resolveOccurrences,
  TimeError,
  type Occurrence,
  type RecurringSlot,
} from './index.js';

const CAIRO = 'Africa/Cairo';
const EET = 120;
const EEST = 180;

const fridayMorning: RecurringSlot = {
  dayOfWeek: 5,
  startTimeLocal: '09:00:00',
  durationMinutes: 60,
  timezone: CAIRO,
};
const fridayPastMidnight: RecurringSlot = { ...fridayMorning, startTimeLocal: '00:30:00' };
const thursdayLate: RecurringSlot = { ...fridayMorning, dayOfWeek: 4, startTimeLocal: '23:30:00' };

/** The schedule as ADR 0009 D1 stores it, and the instant cached beside it. */
const scheduleOf = (occurrence: Occurrence) => ({
  requested: `${occurrence.requestedLocalDate} ${occurrence.requestedStartTimeLocal}`,
  landed: `${occurrence.localDate} ${occurrence.startTimeLocal}`,
  startsAt: occurrence.startsAt,
  disambiguation: occurrence.disambiguation,
});

function refusalFrom(call: () => unknown): TimeError {
  try {
    call();
  } catch (error: unknown) {
    if (error instanceof TimeError) return error;
    throw error;
  }
  throw new Error('expected a TimeError, but the call returned');
}

describe('T007 an occurrence keeps what was asked beside where it landed (ADR 0009 D1)', () => {
  it('keeps the requested Friday 00:30 across the 2026 gap, which lands it at 01:30', () => {
    const occurrences = resolveOccurrences(fridayPastMidnight, {
      fromLocalDate: '2026-04-17',
      count: 3,
    });

    expect(occurrences.map(scheduleOf)).toEqual([
      {
        requested: '2026-04-17 00:30:00',
        landed: '2026-04-17 00:30:00',
        startsAt: '2026-04-16T22:30:00Z',
        disambiguation: 'exact',
      },
      {
        requested: '2026-04-24 00:30:00',
        landed: '2026-04-24 01:30:00',
        startsAt: '2026-04-23T22:30:00Z',
        disambiguation: 'shifted_forward',
      },
      {
        requested: '2026-05-01 00:30:00',
        landed: '2026-05-01 00:30:00',
        startsAt: '2026-04-30T21:30:00Z',
        disambiguation: 'exact',
      },
    ]);
    expect(occurrences.map((occurrence) => occurrence.utcOffsetMinutes)).toEqual([EET, EEST, EEST]);
    expect(occurrences[1]?.endsAt).toBe('2026-04-23T23:30:00Z');
  });

  it('keeps the requested Friday 00:30 across the 2027 gap', () => {
    const [occurrence] = resolveOccurrences(fridayPastMidnight, {
      fromLocalDate: '2027-04-30',
      count: 1,
    });

    expect(occurrence && scheduleOf(occurrence)).toEqual({
      requested: '2027-04-30 00:30:00',
      landed: '2027-04-30 01:30:00',
      startsAt: '2027-04-29T22:30:00Z',
      disambiguation: 'shifted_forward',
    });
  });

  it('takes the first Thursday 23:30 of the 2026 and 2027 repeats, the request unchanged', () => {
    const autumn2026 = resolveOccurrences(thursdayLate, { fromLocalDate: '2026-10-22', count: 3 });
    expect(autumn2026.map(scheduleOf)).toEqual([
      {
        requested: '2026-10-22 23:30:00',
        landed: '2026-10-22 23:30:00',
        startsAt: '2026-10-22T20:30:00Z',
        disambiguation: 'exact',
      },
      {
        requested: '2026-10-29 23:30:00',
        landed: '2026-10-29 23:30:00',
        startsAt: '2026-10-29T20:30:00Z',
        disambiguation: 'first_of_two',
      },
      {
        requested: '2026-11-05 23:30:00',
        landed: '2026-11-05 23:30:00',
        startsAt: '2026-11-05T21:30:00Z',
        disambiguation: 'exact',
      },
    ]);

    const [autumn2027] = resolveOccurrences(thursdayLate, {
      fromLocalDate: '2027-10-28',
      count: 1,
    });
    expect(autumn2027 && scheduleOf(autumn2027)).toEqual({
      requested: '2027-10-28 23:30:00',
      landed: '2027-10-28 23:30:00',
      startsAt: '2027-10-28T20:30:00Z',
      disambiguation: 'first_of_two',
    });
  });
});

describe('T007 firstOccurrenceAfter: the first occurrence at least the lead after an instant (FR-368)', () => {
  it('finds the Friday after the lead, across the 2026 spring change', () => {
    // Wednesday 2026-04-22 09:00 in Cairo (+02:00); 24 hours on is Thursday 09:00, so the lesson is
    // Friday 2026-04-24 09:00, already +03:00.
    const first = firstOccurrenceAfter(fridayMorning, new Date('2026-04-22T07:00:00Z'), 24);

    expect(first).toEqual({
      localDate: '2026-04-24',
      startTimeLocal: '09:00:00',
      timezone: CAIRO,
      startsAt: '2026-04-24T06:00:00Z',
      endsAt: '2026-04-24T07:00:00Z',
      utcOffsetMinutes: EEST,
      disambiguation: 'exact',
      requestedLocalDate: '2026-04-24',
      requestedStartTimeLocal: '09:00:00',
    });
  });

  it('takes an occurrence exactly the lead away, and the next week one second later', () => {
    const exactly = firstOccurrenceAfter(fridayMorning, new Date('2026-04-23T06:00:00Z'), 24);
    expect(exactly.requestedLocalDate).toBe('2026-04-24');

    const late = firstOccurrenceAfter(fridayMorning, new Date('2026-04-23T06:00:01Z'), 24);
    expect(late.requestedLocalDate).toBe('2026-05-01');
    expect(late.startsAt).toBe('2026-05-01T06:00:00Z');
  });

  it('compares the resolved instant, not the wall clock, on the Friday 00:30 gap', () => {
    // 24 hours after 2027-04-28T22:20Z is 2027-04-29T22:20Z, which Cairo reads as Friday 01:20,
    // later on the wall than the slot's 00:30. But 00:30 does not exist that night; it lands at
    // 01:30, 2027-04-29T22:30Z, after the lead, so this Friday is the first.
    const first = firstOccurrenceAfter(fridayPastMidnight, new Date('2027-04-28T22:20:00Z'), 24);

    expect(scheduleOf(first)).toEqual({
      requested: '2027-04-30 00:30:00',
      landed: '2027-04-30 01:30:00',
      startsAt: '2027-04-29T22:30:00Z',
      disambiguation: 'shifted_forward',
    });

    const sameNight2026 = firstOccurrenceAfter(
      fridayPastMidnight,
      new Date('2026-04-22T12:00:00Z'),
      24,
    );
    expect(sameNight2026.requestedLocalDate).toBe('2026-04-24');
    expect(sameNight2026.startsAt).toBe('2026-04-23T22:30:00Z');
  });

  it('weighs the first of a repeated Thursday 23:30, never the second', () => {
    // 24 hours after 2026-10-28T20:45Z is 23:45 the first time round on Thursday 2026-10-29. The
    // lesson is the first 23:30 (20:30Z), already past, so it is the next Thursday's, even though a
    // second 23:30 (21:30Z) is still to come that night.
    const first = firstOccurrenceAfter(thursdayLate, new Date('2026-10-28T20:45:00Z'), 24);

    expect(scheduleOf(first)).toEqual({
      requested: '2026-11-05 23:30:00',
      landed: '2026-11-05 23:30:00',
      startsAt: '2026-11-05T21:30:00Z',
      disambiguation: 'exact',
    });

    const before2027 = firstOccurrenceAfter(thursdayLate, new Date('2027-10-27T20:00:00Z'), 24);
    expect(before2027.startsAt).toBe('2027-10-28T20:30:00Z');
    expect(before2027.disambiguation).toBe('first_of_two');
  });

  it('is the first occurrence of the generation that starts from its requested date', () => {
    // How session generation will chain the two (T034): the first occurrence, then the weeks after
    // it from its requested date. Across the 2027 autumn change, every week stays at 23:30.
    const first = firstOccurrenceAfter(thursdayLate, new Date('2027-10-19T12:00:00Z'), 24);
    const generated = resolveOccurrences(thursdayLate, {
      fromLocalDate: first.requestedLocalDate,
      count: 3,
    });

    expect(generated[0]).toEqual(first);
    expect(generated.map((occurrence) => occurrence.startsAt)).toEqual([
      '2027-10-21T20:30:00Z',
      '2027-10-28T20:30:00Z',
      '2027-11-04T21:30:00Z',
    ]);
    expect(generated.map((occurrence) => occurrence.startTimeLocal)).toEqual([
      '23:30:00',
      '23:30:00',
      '23:30:00',
    ]);
  });

  it('takes a lead of zero hours', () => {
    const first = firstOccurrenceAfter(fridayMorning, new Date('2026-04-24T06:00:00Z'), 0);
    expect(first.startsAt).toBe('2026-04-24T06:00:00Z');
  });

  it('refuses a lead that is not a whole number of hours, and an instant that is not one', () => {
    expect(refusalFrom(() => firstOccurrenceAfter(fridayMorning, new Date(), -1))).toMatchObject({
      offendingField: 'leadHours',
    });
    expect(refusalFrom(() => firstOccurrenceAfter(fridayMorning, new Date(), 1.5))).toMatchObject({
      offendingField: 'leadHours',
    });
    expect(
      refusalFrom(() => firstOccurrenceAfter(fridayMorning, new Date(Number.NaN), 24)),
    ).toMatchObject({ offendingField: 'instant' });
    expect(
      refusalFrom(() =>
        firstOccurrenceAfter({ ...fridayMorning, timezone: 'UTC' }, new Date(), 24),
      ),
    ).toMatchObject({ offendingField: 'timezone' });
  });
});
