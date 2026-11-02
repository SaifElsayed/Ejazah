// T019 (R-206, FR-313, FR-317): a teacher's slots of two zones are compared in the newer slot's
// zone for the week of the save, and a slot's local start is written to and read from its `time`
// column here, where datetimes are built (R-TIME-1).
//
// Why these zones and dates. `Asia/Riyadh` keeps +03:00 all year; `Africa/Cairo` is +02:00 in
// winter and +03:00 from its April gap to its October overlap (the dates of first-occurrence.spec.ts:
// 2026 gap Friday 2026-04-24 00:00, 2026 overlap Thursday 2026-10-29 24:00). So a Riyadh slot reads
// an hour earlier in Cairo in the week of 2026-11-01 and at the same time in the week of 2026-07-05:
// the week of the save decides it.
import { describe, expect, it } from 'vitest';

import { weeklyIntervalsOverlap } from './calendar.js';
import { localTimeOf, TimeError, timeColumnOf, weeklyIntervalIn } from './index.js';

const CAIRO = 'Africa/Cairo';
const RIYADH = 'Asia/Riyadh';

/** A Saturday in Cairo's winter, and a Tuesday in its summer. */
const WINTER_SAVE = new Date('2026-11-07T10:00:00Z');
const SUMMER_SAVE = new Date('2026-07-07T10:00:00Z');

const slot = (
  dayOfWeek: number,
  startTimeLocal: string,
  timezone: string,
  durationMinutes = 60,
) => ({ dayOfWeek, startTimeLocal, durationMinutes, timezone });

describe('T019 weeklyIntervalIn: a slot as another zone reads it in the week of the save (R-206)', () => {
  it('leaves a slot of the zone itself as it is, even in the week a gap moves its occurrence', () => {
    // Friday 00:30 never happens in Cairo on 2026-04-24; the week of the save compares wall clocks.
    const fridayPastMidnight = slot(5, '00:30:00', CAIRO);
    expect(weeklyIntervalIn(fridayPastMidnight, CAIRO, new Date('2026-04-22T10:00:00Z'))).toEqual({
      dayOfWeek: 5,
      startTimeLocal: '00:30:00',
      durationMinutes: 60,
    });
  });

  it('reads a Riyadh Monday 10:00 as Cairo Monday 09:00 in winter and 10:00 in summer', () => {
    const monday = slot(1, '10:00:00', RIYADH, 45);
    expect(weeklyIntervalIn(monday, CAIRO, WINTER_SAVE)).toEqual({
      dayOfWeek: 1,
      startTimeLocal: '09:00:00',
      durationMinutes: 45,
    });
    expect(weeklyIntervalIn(monday, CAIRO, SUMMER_SAVE)).toEqual({
      dayOfWeek: 1,
      startTimeLocal: '10:00:00',
      durationMinutes: 45,
    });
  });

  it('moves a slot across midnight into the day before, Sunday to Saturday on the week', () => {
    expect(weeklyIntervalIn(slot(0, '00:30:00', RIYADH, 30), CAIRO, WINTER_SAVE)).toEqual({
      dayOfWeek: 6,
      startTimeLocal: '23:30:00',
      durationMinutes: 30,
    });
  });

  it('finds the overlap of two zones only in the week where the clocks make one', () => {
    const riyadh = slot(1, '10:00:00', RIYADH, 60);
    const cairo = slot(1, '09:30:00', CAIRO, 30);
    const inCairo = (at: Date) => weeklyIntervalIn(riyadh, CAIRO, at);
    // Winter: Riyadh 10:00 is Cairo 09:00 for 60, which covers Cairo 09:30.
    expect(weeklyIntervalsOverlap(inCairo(WINTER_SAVE), cairo)).toBe(true);
    // Summer: Riyadh 10:00 is Cairo 10:00, after Cairo 09:30 for 30 ends.
    expect(weeklyIntervalsOverlap(inCairo(SUMMER_SAVE), cairo)).toBe(false);
  });

  it('refuses a zone that is not one and a day that is not of the week', () => {
    expect(() => weeklyIntervalIn(slot(1, '10:00:00', 'Mars/Olympus'), CAIRO, WINTER_SAVE)).toThrow(
      TimeError,
    );
    expect(() => weeklyIntervalIn(slot(1, '10:00:00', RIYADH), '+02:00', WINTER_SAVE)).toThrow(
      TimeError,
    );
    expect(() => weeklyIntervalIn(slot(7, '10:00:00', RIYADH), CAIRO, WINTER_SAVE)).toThrow(
      TimeError,
    );
  });
});

describe('T019 timeColumnOf and localTimeOf: a local start as a `time` column holds it', () => {
  it('writes the time on the epoch day in UTC and reads the same time back', () => {
    const column = timeColumnOf('23:30:00');
    expect(column.toISOString()).toBe('1970-01-01T23:30:00.000Z');
    expect(localTimeOf(column)).toBe('23:30:00');
    expect(localTimeOf(timeColumnOf('00:00:00'))).toBe('00:00:00');
  });

  it('refuses a time that is not on the clock, in either direction', () => {
    expect(() => timeColumnOf('24:00:00')).toThrow(TimeError);
    expect(() => timeColumnOf('09:30')).toThrow(TimeError);
    expect(() => localTimeOf(new Date(Number.NaN))).toThrow(TimeError);
  });
});
