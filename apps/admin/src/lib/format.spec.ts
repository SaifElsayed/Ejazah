// T071: what the panel prints of a date and a zone, in the page's language with Latin digits and
// the Gregorian calendar (`formattingTag`): a day with its month («14 أكتوبر»), the same with its
// year in a detail («14 أكتوبر 2026»; the English boards print «14 Oct 2026», day first), and a zone as its city («القاهرة»), the raw zone when the
// list holds no city for it.
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import { cityName, dayMonth, dayMonthYear, formatPounds, timeOfDay, weekdayDate } from './format';

const at = '2026-10-14T09:00:00.000Z';

describe('dates', () => {
  it('prints the day and the month, and with the year, in either language', () => {
    expect(dayMonth(at, 'ar', 'Africa/Cairo')).toBe('14 أكتوبر');
    expect(dayMonthYear(at, 'ar', 'Africa/Cairo')).toBe('14 أكتوبر 2026');
    expect(dayMonth(at, 'en', 'Africa/Cairo')).toBe('14 Oct');
    expect(dayMonthYear(at, 'en', 'Africa/Cairo')).toBe('14 Oct 2026');
  });

  it('reads a calendar day as that day, whatever the zone', () => {
    expect(dayMonth('2026-10-13', 'ar', 'America/New_York')).toBe('13 أكتوبر');
  });
});

describe('cityName', () => {
  it('names a zone as its city, and leaves a zone with no city as it is', () => {
    expect(cityName('Africa/Cairo', 'ar')).toBe('القاهرة');
    expect(cityName('Africa/Cairo', 'en')).toBe('Cairo');
    expect(cityName('Mars/Olympus', 'en')).toBe('Mars/Olympus');
  });
});

describe('the home and the audit (B14d)', () => {
  it('prints a day with its weekday, and a moment’s time of day, in the zone', () => {
    expect(weekdayDate('2026-10-15T09:00:00.000Z', 'ar', 'Africa/Cairo')).toBe(
      'الخميس 15 أكتوبر 2026',
    );
    expect(weekdayDate('2026-10-15T09:00:00.000Z', 'en', 'Africa/Cairo')).toBe(
      'Thursday 15 October 2026',
    );
    expect(timeOfDay('2026-10-15T08:20:00.000Z', 'ar', 'Africa/Cairo')).toBe('11:20 ص');
    expect(timeOfDay('2026-10-15T14:40:00.000Z', 'en', 'Africa/Cairo')).toBe('5:40 PM');
  });
});

describe('formatPounds (T009, R-212)', () => {
  // The amount is placed in the price template between isolates (002:T153).
  it('prints every amount to two decimals, whole pounds included', () => {
    expect(formatPounds(piasters(15_000), 'ar')).toBe('\u2068150.00\u2069 ج.م');
    expect(formatPounds(piasters(15_000), 'en')).toBe('EGP \u2068150.00\u2069');
    expect(formatPounds(piasters(15_050), 'ar')).toBe('\u2068150.50\u2069 ج.م');
    expect(formatPounds(piasters(1), 'en')).toBe('EGP \u20680.01\u2069');
    expect(formatPounds(piasters(0), 'ar')).toBe('\u20680.00\u2069 ج.م');
  });

  it('groups thousands with Latin digits', () => {
    expect(formatPounds(piasters(123_456_789), 'ar')).toBe('\u20681,234,567.89\u2069 ج.م');
    expect(formatPounds(piasters(123_456_700), 'en')).toBe('EGP \u20681,234,567.00\u2069');
  });
});
