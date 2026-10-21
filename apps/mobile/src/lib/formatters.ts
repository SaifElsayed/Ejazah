// T031: the only formatting layer (R-MOBILE-9, FR-203, NFR-USE-3). A number, a date or a time
// reaches the screen through these functions, in the active locale's words, the Gregorian
// calendar and the Western digits the boards draw (`formattingTag`, i18n/index.ts). An instant is
// an ISO 8601 string from the server; the zone is the IANA name it is shown in. Nothing here
// constructs or moves a datetime (R-TIME-1): parsing one string is all it does.
import { useMemo } from 'react';

import { formattingTag, type Locale, useLocale } from '../i18n';

/** A number with the locale's grouping and decimal marks. */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(formattingTag(locale)).format(value);
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

/** The time with the locale's day period: «10:02 ص», "10:02 AM". */
export function formatTime(instant: string, timeZone: string, locale: Locale): string {
  return dateTime(locale, timeZone, { hour: 'numeric', minute: '2-digit' }).format(parse(instant));
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
      date: (instant: string, timeZone: string) => formatDate(instant, timeZone, locale),
      fullDate: (instant: string, timeZone: string) => formatFullDate(instant, timeZone, locale),
      calendarDate: (date: string) => formatCalendarDate(date, locale),
      weekdayDate: (instant: string, timeZone: string) =>
        formatWeekdayDate(instant, timeZone, locale),
      time: (instant: string, timeZone: string) => formatTime(instant, timeZone, locale),
    }),
    [locale],
  );
}
