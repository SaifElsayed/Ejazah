// T051 (FR-AUTH-4): a date of birth goes to the phone's native date picker and comes back as the
// same calendar date, whatever the device's zone, since the picker shows the day in that zone.
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  calendarDateOfPicked,
  calendarDaysBefore,
  daysInMonth,
  pickerDateOf,
  secondsUntil,
  weeklyIntervalsOverlap,
} from './calendar.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the date picker', () => {
  it('carries a calendar date there and back', () => {
    expect(calendarDateOfPicked(pickerDateOf('2004-03-12'))).toBe('2004-03-12');
    expect(calendarDateOfPicked(pickerDateOf('1999-12-31'))).toBe('1999-12-31');
  });

  it('reads the day the picker shows, at any hour of it', () => {
    const late = pickerDateOf('2004-03-12');
    late.setHours(23, 59);
    expect(calendarDateOfPicked(late)).toBe('2004-03-12');
  });

  it('refuses a date that does not exist', () => {
    expect(() => pickerDateOf('2004-02-30')).toThrow(RangeError);
    expect(() => pickerDateOf('not a date')).toThrow(RangeError);
  });
});

describe('calendarDaysBefore (B14d: the audit’s last days)', () => {
  it('is the calendar day so many days earlier, across a month and a year', () => {
    expect(calendarDaysBefore('2026-10-25', 29)).toBe('2026-09-26');
    expect(calendarDaysBefore('2026-01-10', 15)).toBe('2025-12-26');
    expect(calendarDaysBefore('2026-10-25', 0)).toBe('2026-10-25');
  });

  it('refuses a date that does not exist, and a count that is not a whole number', () => {
    expect(() => calendarDaysBefore('2026-02-30', 1)).toThrow(RangeError);
    expect(() => calendarDaysBefore('2026-10-25', 1.5)).toThrow(RangeError);
  });
});

describe('daysInMonth (T109: the date-of-birth picker’s days)', () => {
  it('counts the days of each month of the Gregorian calendar', () => {
    const counts = Array.from({ length: 12 }, (_, index) => daysInMonth(2023, index + 1));
    expect(counts).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });

  it('gives February 29 days in a leap year: every fourth, not a century, every fourth century', () => {
    expect(daysInMonth(2004, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('refuses a month or a year that is not one', () => {
    expect(() => daysInMonth(2004, 0)).toThrow(RangeError);
    expect(() => daysInMonth(2004, 13)).toThrow(RangeError);
    expect(() => daysInMonth(2004.5, 2)).toThrow(RangeError);
  });
});

// T007 (R-206, FR-317): a teacher's slots are compared on the week as a circle of 10 080 minutes,
// so a slot that crosses midnight reaches into the next day and Saturday's end reaches Sunday.
describe('weeklyIntervalsOverlap (T007: a slot against a teacher’s other slots, R-206)', () => {
  const slot = (dayOfWeek: number, startTimeLocal: string, durationMinutes: number) => ({
    dayOfWeek,
    startTimeLocal,
    durationMinutes,
  });

  it('refuses Sunday 23:30 for 60 against Monday 00:00, and passes it for 30 (half-open)', () => {
    expect(weeklyIntervalsOverlap(slot(0, '23:30:00', 60), slot(1, '00:00:00', 30))).toBe(true);
    expect(weeklyIntervalsOverlap(slot(0, '23:30:00', 30), slot(1, '00:00:00', 30))).toBe(false);
  });

  it('wraps Saturday’s end to Sunday’s start', () => {
    expect(weeklyIntervalsOverlap(slot(6, '23:30:00', 60), slot(0, '00:00:00', 30))).toBe(true);
    expect(weeklyIntervalsOverlap(slot(0, '00:15:00', 45), slot(6, '23:45:00', 45))).toBe(true);
    expect(weeklyIntervalsOverlap(slot(6, '23:30:00', 30), slot(0, '00:00:00', 30))).toBe(false);
  });

  it('finds the same slot, a slot inside another and a partial overlap; passes a gap', () => {
    expect(weeklyIntervalsOverlap(slot(3, '09:00:00', 60), slot(3, '09:00:00', 60))).toBe(true);
    expect(weeklyIntervalsOverlap(slot(3, '09:00:00', 60), slot(3, '09:15:00', 30))).toBe(true);
    expect(weeklyIntervalsOverlap(slot(3, '09:00:00', 45), slot(3, '09:30:00', 60))).toBe(true);
    expect(weeklyIntervalsOverlap(slot(3, '09:00:00', 60), slot(3, '10:00:00', 60))).toBe(false);
    expect(weeklyIntervalsOverlap(slot(3, '09:00:00', 60), slot(4, '09:00:00', 60))).toBe(false);
  });

  it('answers the same whichever slot comes first', () => {
    const pairs = [
      [slot(0, '23:30:00', 60), slot(1, '00:00:00', 30)],
      [slot(6, '23:30:00', 60), slot(0, '00:00:00', 30)],
      [slot(3, '09:00:00', 60), slot(3, '10:00:00', 60)],
    ] as const;
    for (const [a, b] of pairs) {
      expect(weeklyIntervalsOverlap(b, a)).toBe(weeklyIntervalsOverlap(a, b));
    }
  });

  it('refuses a day, a start or a length that is not one of a week', () => {
    const fine = slot(3, '09:00:00', 60);
    expect(() => weeklyIntervalsOverlap(slot(7, '09:00:00', 60), fine)).toThrow(RangeError);
    expect(() => weeklyIntervalsOverlap(fine, slot(-1, '09:00:00', 60))).toThrow(RangeError);
    expect(() => weeklyIntervalsOverlap(slot(3, '24:00:00', 60), fine)).toThrow(RangeError);
    expect(() => weeklyIntervalsOverlap(slot(3, '9:00', 60), fine)).toThrow(RangeError);
    // A minute circle counts whole minutes; a start with seconds would be cut, so it is refused.
    expect(() => weeklyIntervalsOverlap(slot(3, '09:00:30', 60), fine)).toThrow(RangeError);
    expect(() => weeklyIntervalsOverlap(fine, slot(3, '09:00:00', 0))).toThrow(RangeError);
    expect(() => weeklyIntervalsOverlap(fine, slot(3, '09:00:00', 1.5))).toThrow(RangeError);
    expect(() => weeklyIntervalsOverlap(fine, slot(3, '09:00:00', 10_081))).toThrow(RangeError);
  });
});

// T007 (R-217, FR-358): the checkout countdown reads the order's expiry from the server and the
// phone's own clock, so it keeps counting offline.
describe('secondsUntil (T007: the checkout countdown, R-217)', () => {
  it('counts the whole seconds left, a part of a second counted, so zero means the time has come', () => {
    expect(secondsUntil('2026-11-01T10:00:00Z', new Date('2026-11-01T09:59:00Z'))).toBe(60);
    expect(secondsUntil('2026-11-01T10:00:00Z', new Date('2026-11-01T09:59:59.500Z'))).toBe(1);
    expect(secondsUntil('2026-11-01T10:00:00.000Z', new Date('2026-11-01T09:45:00Z'))).toBe(900);
    expect(secondsUntil('2026-11-01T10:00:00Z', new Date('2026-11-01T10:00:00Z'))).toBe(0);
  });

  it('answers zero once the instant has passed, never a negative count', () => {
    expect(secondsUntil('2026-11-01T10:00:00Z', new Date('2026-11-01T10:00:00.001Z'))).toBe(0);
    expect(secondsUntil('2026-11-01T10:00:00Z', new Date('2026-11-02T10:00:00Z'))).toBe(0);
  });

  it('counts the same whatever the device’s zone', () => {
    vi.stubEnv('TZ', 'Africa/Cairo');
    expect(secondsUntil('2026-04-23T22:30:00Z', new Date('2026-04-23T21:30:00Z'))).toBe(3_600);
  });

  it('refuses an instant that is not a UTC instant, and a clock that holds no instant', () => {
    const now = new Date('2026-11-01T09:00:00Z');
    expect(() => secondsUntil('soon', now)).toThrow(RangeError);
    expect(() => secondsUntil('2026-02-30T10:00:00Z', now)).toThrow(RangeError);
    expect(() => secondsUntil('2026-11-01T12:00:00+02:00', now)).toThrow(RangeError);
    expect(() => secondsUntil('2026-11-01T10:00:00Z', new Date(Number.NaN))).toThrow(RangeError);
  });
});
