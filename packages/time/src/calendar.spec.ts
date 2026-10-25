// T051 (FR-AUTH-4): a date of birth goes to the phone's native date picker and comes back as the
// same calendar date, whatever the device's zone, since the picker shows the day in that zone.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { calendarDateOfPicked, calendarDaysBefore, pickerDateOf } from './calendar.js';

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
