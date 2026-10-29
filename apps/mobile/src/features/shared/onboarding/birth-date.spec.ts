// T109: the choices of the date-of-birth picker. The day, month and year lists offer only dates
// between the first day and today, and a day the new month or year lacks is moved to its last.
import { describe, expect, it } from '@jest/globals';

import { choicesOf, clampParts, dateOfParts, partsOf } from './birth-date';

const earliest = partsOf('1900-01-01');
const latest = partsOf('2026-10-28');

describe('the date-of-birth picker’s choices (T109)', () => {
  it('reads a calendar date into its parts and back', () => {
    expect(partsOf('2004-03-12')).toEqual({ year: 2004, month: 3, day: 12 });
    expect(dateOfParts({ year: 2004, month: 3, day: 2 })).toBe('2004-03-02');
    expect(() => partsOf('2004-3-12')).toThrow(RangeError);
  });

  it('offers every year from the first to this one, newest first, and the days of the month', () => {
    const choices = choicesOf(partsOf('2000-02-10'), earliest, latest);
    expect(choices.years[0]).toBe(2026);
    expect(choices.years.at(-1)).toBe(1900);
    expect(choices.years).toHaveLength(127);
    expect(choices.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(choices.days).toHaveLength(29);
  });

  it('offers no month or day after today', () => {
    expect(choicesOf(partsOf('2026-10-05'), earliest, latest).months.at(-1)).toBe(10);
    expect(choicesOf(partsOf('2026-10-05'), earliest, latest).days.at(-1)).toBe(28);
    expect(choicesOf(partsOf('2026-09-05'), earliest, latest).days.at(-1)).toBe(30);
  });

  it('moves a day the new month or year lacks to its last day', () => {
    expect(clampParts({ year: 2000, month: 2, day: 31 }, earliest, latest)).toEqual({
      year: 2000,
      month: 2,
      day: 29,
    });
    expect(clampParts({ year: 2001, month: 2, day: 29 }, earliest, latest)).toEqual({
      year: 2001,
      month: 2,
      day: 28,
    });
    expect(clampParts({ year: 2004, month: 4, day: 31 }, earliest, latest).day).toBe(30);
  });

  it('moves a date after today back to today', () => {
    expect(clampParts({ year: 2026, month: 12, day: 31 }, earliest, latest)).toEqual(latest);
    expect(clampParts({ year: 2026, month: 10, day: 30 }, earliest, latest)).toEqual(latest);
  });
});
