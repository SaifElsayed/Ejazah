// T031: the one formatting layer (R-MOBILE-9, FR-203, NFR-USE-3). Numbers, dates and times reach
// the screen through these functions only, with the locale's words and the digits the boards draw.
import { describe, expect, it } from '@jest/globals';
import { piasters } from '@ijazah/money';

import { isolate } from '../i18n';
import {
  formatCalendarDate,
  formatCountdown,
  formatDate,
  formatFullDate,
  formatMonth,
  formatNumber,
  formatPoundAmount,
  formatPounds,
  formatRating,
  formatTime,
  formatWallClock,
  formatWeekday,
  formatWeekdayDate,
  formatYear,
  weekdayIn,
} from './formatters';

const instant = '2026-10-15T07:02:00Z';
const cairo = 'Africa/Cairo';

describe('formatters', () => {
  it('formats a number with the Western digits and the locale grouping', () => {
    expect(formatNumber(1234.5, 'ar')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
  });

  it('formats a date in the zone given, as the boards draw it', () => {
    expect(formatDate(instant, cairo, 'ar')).toBe('15 أكتوبر');
    expect(formatDate(instant, cairo, 'en')).toBe('October 15');
    // The same instant is the next day where it is already past midnight.
    expect(formatDate('2026-10-15T22:30:00Z', 'Asia/Riyadh', 'ar')).toBe('16 أكتوبر');
  });

  it('formats a time with the locale day period', () => {
    expect(formatTime(instant, cairo, 'ar')).toBe('10:02 ص');
    expect(formatTime(instant, cairo, 'en')).toBe('10:02 AM');
  });

  it('formats a weekday and a date', () => {
    expect(formatWeekdayDate(instant, cairo, 'ar')).toBe('الخميس، 15 أكتوبر');
    expect(formatWeekdayDate(instant, cairo, 'en')).toBe('Thursday, October 15');
  });

  it('formats a date with its year, as the account draws «منذ 2 فبراير 2026»', () => {
    expect(formatFullDate('2026-02-02T09:00:00Z', cairo, 'ar')).toBe('2 فبراير 2026');
    expect(formatFullDate('2026-02-02T09:00:00Z', cairo, 'en')).toBe('February 2, 2026');
  });

  it('formats a calendar date, which belongs to no zone, as the profile draws «12 مارس 2004»', () => {
    expect(formatCalendarDate('2004-03-12', 'ar')).toBe('12 مارس 2004');
    expect(formatCalendarDate('2004-03-12', 'en')).toBe('March 12, 2004');
    expect(() => formatCalendarDate('2004-02-30', 'ar')).toThrow(RangeError);
  });

  it('names a month in the language, for the date-of-birth picker (T109)', () => {
    expect(formatMonth(3, 'ar')).toBe('مارس');
    expect(formatMonth(3, 'en')).toBe('March');
    expect(formatMonth(12, 'ar')).toBe('ديسمبر');
    expect(formatMonth(1, 'en')).toBe('January');
    expect(() => formatMonth(13, 'ar')).toThrow(RangeError);
  });

  it('writes a year whole, with no grouping mark (T109)', () => {
    expect(formatYear(2004, 'ar')).toBe('2004');
    expect(formatYear(1900, 'en')).toBe('1900');
  });

  it('names a day of the week, 0 = Sunday as the slots count them (T022)', () => {
    expect(formatWeekday(0, 'ar')).toBe('الأحد');
    expect(formatWeekday(6, 'ar')).toBe('السبت');
    expect(formatWeekday(1, 'en')).toBe('Monday');
    expect(formatWeekday(5, 'en')).toBe('Friday');
    expect(() => formatWeekday(7, 'ar')).toThrow(RangeError);
  });

  it('formats a wall-clock time of no zone as the boards draw it (T022)', () => {
    expect(formatWallClock('10:00', 'ar')).toBe('10:00 ص');
    expect(formatWallClock('20:15', 'ar')).toBe('8:15 م');
    expect(formatWallClock('00:00', 'en')).toBe('12:00 AM');
    expect(formatWallClock('23:45', 'en')).toBe('11:45 PM');
    expect(() => formatWallClock('24:00', 'en')).toThrow(RangeError);
  });

  it('reads the day of the week an instant falls on in a zone (T022)', () => {
    // A Thursday in Cairo, and already Friday in Riyadh at 22:30 UTC.
    expect(weekdayIn(instant, cairo)).toBe(4);
    expect(weekdayIn('2026-10-15T22:30:00Z', 'Asia/Riyadh')).toBe(5);
    expect(weekdayIn('2026-10-18T09:00:00Z', cairo)).toBe(0);
  });

  it('refuses an instant that does not parse, never printing "Invalid Date"', () => {
    expect(() => formatDate('not a date', cairo, 'ar')).toThrow(RangeError);
  });
});

describe('formatPounds (T009, R-212)', () => {
  it('prints a whole amount of pounds with no decimals, in the price template', () => {
    expect(formatPounds(piasters(15_000), 'ar')).toBe(`${isolate('150')} ج.م`);
    expect(formatPounds(piasters(15_000), 'en')).toBe(`EGP ${isolate('150')}`);
    expect(formatPounds(piasters(0), 'ar')).toBe(`${isolate('0')} ج.م`);
  });

  it('prints an amount with piasters to two decimals', () => {
    expect(formatPounds(piasters(15_050), 'ar')).toBe(`${isolate('150.50')} ج.م`);
    expect(formatPounds(piasters(15_005), 'en')).toBe(`EGP ${isolate('150.05')}`);
    expect(formatPounds(piasters(1), 'en')).toBe(`EGP ${isolate('0.01')}`);
  });

  it('groups thousands with the Western digits the boards draw', () => {
    expect(formatPounds(piasters(123_456_700), 'ar')).toBe(`${isolate('1,234,567')} ج.م`);
    expect(formatPounds(piasters(123_456_789), 'en')).toBe(`EGP ${isolate('1,234,567.89')}`);
  });
});

describe('formatPoundAmount (T021)', () => {
  it('prints the amount alone, for a template that writes the currency itself', () => {
    expect(formatPoundAmount(piasters(120_000), 'ar')).toBe('1,200');
    expect(formatPoundAmount(piasters(15_006), 'en')).toBe('150.06');
  });
});

describe('formatRating (T070; PR #118’s review, nit 5)', () => {
  it('prints a rating to one decimal, rounded, the same on the card and the teacher’s page', () => {
    for (const locale of ['ar', 'en'] as const) {
      expect(formatRating(4.96, locale)).toBe('5.0');
      expect(formatRating(4.86, locale)).toBe('4.9');
      expect(formatRating(4.5, locale)).toBe('4.5');
      expect(formatRating(5, locale)).toBe('5.0');
      expect(formatRating(1, locale)).toBe('1.0');
    }
  });
});

describe('formatCountdown (T045, the checkout countdown)', () => {
  it('writes whole seconds as minutes and two-digit seconds, as the board draws «8:12»', () => {
    expect(formatCountdown(492, 'ar')).toBe('8:12');
    expect(formatCountdown(492, 'en')).toBe('8:12');
    expect(formatCountdown(600, 'en')).toBe('10:00');
    expect(formatCountdown(9, 'ar')).toBe('0:09');
    expect(formatCountdown(0, 'en')).toBe('0:00');
  });
});
