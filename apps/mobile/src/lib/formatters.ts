// T031: the only formatting layer (R-MOBILE-9, FR-203, NFR-USE-3). A number, a date or a time
// reaches the screen through these functions, in the active locale's words, the Gregorian
// calendar and the Western digits the boards draw (`formattingTag`, i18n/index.ts). An instant is
// an ISO 8601 string from the server; the zone is the IANA name it is shown in. Nothing here
// constructs or moves a datetime (R-TIME-1): parsing one string is all it does. T109: a month's name
// and a year, for the phone's own date-of-birth picker. T009: an amount of piasters, in pounds.
// T022: a weekday's name and a slot's wall-clock start, which belong to no zone, and the weekday
// an instant falls on in a zone. T070: a teacher's rating, to one decimal. T045: the checkout's
// countdown, as minutes and seconds.
import { type Piasters, toPlainNumber } from '@ijazah/money';
import { useMemo } from 'react';

import { formattingTag, type Locale, translate, useLocale } from '../i18n';

/** A number with the locale's grouping and decimal marks. */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(formattingTag(locale)).format(value);
}

/** The digits a rating keeps after the decimal mark: one, as the boards draw it («4.9»). */
const RATING_DECIMALS = 1;

/**
 * A teacher's aggregate rating, 1 to 5, to one decimal, rounded (T070; PR #118's review, nit 5):
 * «4.9» for 4.86, «5.0» for 4.96 and for 5. The card and the teacher's page both draw it so.
 */
export function formatRating(value: number, locale: Locale): string {
  return new Intl.NumberFormat(formattingTag(locale), {
    minimumFractionDigits: RATING_DECIMALS,
    maximumFractionDigits: RATING_DECIMALS,
  }).format(value);
}

const SECONDS_PER_MINUTE = 60;
const SECOND_DIGITS = 2;

/**
 * A countdown's whole seconds as minutes and two-digit seconds, «8:12» as the checkout's boards
 * draw it (T045). The seconds are a count `secondsUntil` gave (`@ijazah/time/calendar`); nothing
 * here reads a clock.
 */
export function formatCountdown(seconds: number, locale: Locale): string {
  const whole = Math.max(0, Math.floor(seconds));
  const tag = formattingTag(locale);
  const minutes = new Intl.NumberFormat(tag, { useGrouping: false });
  const rest = new Intl.NumberFormat(tag, {
    useGrouping: false,
    minimumIntegerDigits: SECOND_DIGITS,
  });
  return `${minutes.format(Math.floor(whole / SECONDS_PER_MINUTE))}:${rest.format(whole % SECONDS_PER_MINUTE)}`;
}

const PIASTERS_PER_POUND = 100;

/**
 * An amount in pounds, in `common.format.price` (T009, R-212): «150 ج.م», "EGP 150.50". Whole
 * pounds print with no decimals and any piasters with two. The amount leaves the brand through
 * `toPlainNumber` for display only; whether it is whole is read on the integer, which is exact.
 */
export function formatPounds(amount_piasters: Piasters, locale: Locale): string {
  return translate(locale, 'common.format.price', {
    amount: formatPoundAmount(amount_piasters, locale),
  });
}

/**
 * The amount alone, as `formatPounds` prints it, for a template that writes the currency itself
 * («{amount} ج.م للجلسة», T021).
 */
export function formatPoundAmount(amount_piasters: Piasters, locale: Locale): string {
  const piasterCount = toPlainNumber(amount_piasters);
  const decimals = piasterCount % PIASTERS_PER_POUND === 0 ? 0 : 2;
  return new Intl.NumberFormat(formattingTag(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(piasterCount / PIASTERS_PER_POUND);
}

/** The day and month of `instant` in `timeZone`: «15 أكتوبر», "October 15". */
export function formatDate(instant: string, timeZone: string, locale: Locale): string {
  return dateTime(locale, timeZone, { day: 'numeric', month: 'long' }).format(parse(instant));
}

/** The weekday, day and month: «الخميس، 15 أكتوبر», "Thursday, October 15". */
export function formatWeekdayDate(instant: string, timeZone: string, locale: Locale): string {
  return dateTime(locale, timeZone, { weekday: 'long', day: 'numeric', month: 'long' }).format(
    parse(instant),
  );
}

/** The day, month and year of `instant` in `timeZone`: «2 فبراير 2026», "February 2, 2026". */
export function formatFullDate(instant: string, timeZone: string, locale: Locale): string {
  return dateTime(locale, timeZone, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    parse(instant),
  );
}

/**
 * A calendar date (`YYYY-MM-DD`, a date of birth), which belongs to no zone: «12 مارس 2004». It is
 * read and written in UTC so no zone moves it; a date that does not exist throws.
 */
export function formatCalendarDate(date: string, locale: Locale): string {
  return dateTime(locale, 'UTC', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    parseCalendarDate(date),
  );
}

/** `date` as the UTC midnight that starts it; a malformed or non-existent date throws. */
export function parseCalendarDate(date: string): Date {
  const parsed = parse(`${date}T00:00:00Z`);
  if (parsed.toISOString().slice(0, date.length) !== date) {
    throw new RangeError(`formatters: "${date}" is not a calendar date`);
  }
  return parsed;
}

/** Any year and the middle of the month: a month's name is read from one of its days. */
const SOME_YEAR = '2000';
const MID_MONTH = '15';

/**
 * The name of `month` (1 to 12), for the date-of-birth picker (T109): «مارس», "March". Read in
 * UTC from a calendar date, so no zone moves it; a month that is not one throws.
 */
export function formatMonth(month: number, locale: Locale): string {
  const mm = String(month).padStart('MM'.length, '0');
  return dateTime(locale, 'UTC', { month: 'long' }).format(
    parseCalendarDate(`${SOME_YEAR}-${mm}-${MID_MONTH}`),
  );
}

/** A year whole, with no grouping mark (T109): «2004», where `formatNumber` writes "2,004". */
export function formatYear(year: number, locale: Locale): string {
  return new Intl.NumberFormat(formattingTag(locale), { useGrouping: false }).format(year);
}

/** 2000-01-02 was a Sunday: the day of the week `n` (0 = Sunday) is read on 2000-01-0{2 + n}. */
const A_SUNDAY = 2;
const DAYS_PER_WEEK = 7;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * The name of a day of the week, 0 = Sunday as the slots count it (T022): «السبت», "Saturday".
 * Read in UTC from a calendar date, so no zone moves it; a day that is not one throws.
 */
export function formatWeekday(dayOfWeek: number, locale: Locale): string {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek >= DAYS_PER_WEEK) {
    throw new RangeError(`formatters: ${String(dayOfWeek)} is not a day of the week (0–6)`);
  }
  const dd = String(A_SUNDAY + dayOfWeek).padStart('DD'.length, '0');
  return dateTime(locale, 'UTC', { weekday: 'long' }).format(
    parseCalendarDate(`${SOME_YEAR}-01-${dd}`),
  );
}

/**
 * A wall-clock time `HH:MM` that belongs to no zone, a slot's local start (T022), with the
 * locale's day period: «8:15 م», "8:15 PM". Read in UTC on one day, so no zone moves it.
 */
export function formatWallClock(time: string, locale: Locale): string {
  const read = parse(`${SOME_YEAR}-01-01T${time}:00Z`);
  if (read.toISOString().slice('2000-01-01T'.length, '2000-01-01THH:MM'.length) !== time) {
    throw new RangeError(`formatters: "${time}" is not a time of day`);
  }
  return dateTime(locale, 'UTC', { hour: 'numeric', minute: '2-digit' }).format(read);
}

/** The day of the week (0 = Sunday) `instant` falls on in `timeZone` (T022, today's block). */
export function weekdayIn(instant: string, timeZone: string): number {
  const name = dateTime('en', timeZone, { weekday: 'short' }).format(parse(instant));
  const day = WEEKDAYS.indexOf(name as (typeof WEEKDAYS)[number]);
  if (day < 0) throw new RangeError(`formatters: "${name}" is not a day of the week`);
  return day;
}

/** The time with the locale's day period: «10:02 ص», "10:02 AM". */
export function formatTime(instant: string, timeZone: string, locale: Locale): string {
  return dateTime(locale, timeZone, { hour: 'numeric', minute: '2-digit' }).format(parse(instant));
}

/**
 * The locale's order of names, for one sort of a whole list (T104). Each `localeCompare` builds a
 * collator of its own, which Hermes makes slow enough to freeze a long list's screen.
 */
export function nameOrder(locale: Locale): (a: string, b: string) => number {
  return new Intl.Collator(locale).compare;
}

function dateTime(
  locale: Locale,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(formattingTag(locale), { ...options, timeZone });
}

/** The instant as a Date; an unparsable string throws rather than showing "Invalid Date". */
function parse(instant: string): Date {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`formatters: "${instant}" is not an instant`);
  }
  return date;
}

/** The formatters bound to the active locale. */
export function useFormatters() {
  const locale = useLocale();
  return useMemo(
    () => ({
      number: (value: number) => formatNumber(value, locale),
      rating: (value: number) => formatRating(value, locale),
      countdown: (seconds: number) => formatCountdown(seconds, locale),
      date: (instant: string, timeZone: string) => formatDate(instant, timeZone, locale),
      fullDate: (instant: string, timeZone: string) => formatFullDate(instant, timeZone, locale),
      calendarDate: (date: string) => formatCalendarDate(date, locale),
      month: (month: number) => formatMonth(month, locale),
      year: (year: number) => formatYear(year, locale),
      weekdayDate: (instant: string, timeZone: string) =>
        formatWeekdayDate(instant, timeZone, locale),
      time: (instant: string, timeZone: string) => formatTime(instant, timeZone, locale),
      weekday: (dayOfWeek: number) => formatWeekday(dayOfWeek, locale),
      wallClock: (time: string) => formatWallClock(time, locale),
    }),
    [locale],
  );
}
