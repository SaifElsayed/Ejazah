// T071: what the panel prints of a date and a zone, in the page's language with Latin digits and
// the Gregorian calendar (`formattingTag`): a day with its month («14 أكتوبر»), the same with its
// year in a detail («14 أكتوبر 2026»; the English boards print «14 Oct 2026», day first), and a zone as its city («القاهرة»), the raw zone when the
// list holds no city for it.
import { describe, expect, it } from 'vitest';

import { cityName, dayMonth, dayMonthYear } from './format';

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
