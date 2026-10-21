// T051 (FR-AUTH-4): a date of birth goes to the phone's native date picker and comes back as the
// same calendar date, whatever the device's zone, since the picker shows the day in that zone.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { calendarDateOfPicked, pickerDateOf } from './calendar.js';

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
