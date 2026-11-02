// T026 (R-205, FR-394, FR-BOOK-10): a slot's release falls whole calendar weeks after the final
// session's local date, a step taken on the wall calendar (R-TIME-2), so no zone and no clock change
// moves it: the week across Cairo's April gap is still seven days on the calendar.
import { describe, expect, it } from 'vitest';

import { calendarWeeksAfter, TimeError } from './index.js';

describe('T026 calendarWeeksAfter', () => {
  it('steps whole calendar weeks from a local date', () => {
    expect(calendarWeeksAfter('2026-11-05', 1)).toBe('2026-11-12');
    expect(calendarWeeksAfter('2026-11-05', 3)).toBe('2026-11-26');
    expect(calendarWeeksAfter('2026-11-05', 0)).toBe('2026-11-05');
  });

  it('crosses a month, a year and a leap day on the calendar', () => {
    expect(calendarWeeksAfter('2026-12-29', 1)).toBe('2027-01-05');
    expect(calendarWeeksAfter('2028-02-24', 1)).toBe('2028-03-02');
  });

  it("keeps seven days across Cairo's April gap, which no instant arithmetic would", () => {
    expect(calendarWeeksAfter('2026-04-17', 1)).toBe('2026-04-24');
    expect(calendarWeeksAfter('2026-04-23', 1)).toBe('2026-04-30');
  });

  it('refuses a date that is not a calendar date and a count that is not whole weeks', () => {
    expect(() => calendarWeeksAfter('2026-02-30', 1)).toThrow(TimeError);
    expect(() => calendarWeeksAfter('2026-11-05', 1.5)).toThrow(TimeError);
    expect(() => calendarWeeksAfter('2026-11-05', -1)).toThrow(TimeError);
  });
});
