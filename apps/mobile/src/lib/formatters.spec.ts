// T031: the one formatting layer (R-MOBILE-9, FR-203, NFR-USE-3). Numbers, dates and times reach
// the screen through these functions only, with the locale's words and the digits the boards draw.
import { describe, expect, it } from '@jest/globals';

import {
  formatCalendarDate,
  formatDate,
  formatFullDate,
  formatMonth,
  formatNumber,
  formatTime,
  formatWeekdayDate,
  formatYear,
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

  it('refuses an instant that does not parse, never printing "Invalid Date"', () => {
    expect(() => formatDate('not a date', cairo, 'ar')).toThrow(RangeError);
  });
});
