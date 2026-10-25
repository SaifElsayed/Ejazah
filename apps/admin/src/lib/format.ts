// T071: what the panel prints of a date and a zone (the admin's `useFormatters`, R-MOBILE-9's
// neighbour), in the page's language through `formattingTag`: Latin digits, the Gregorian calendar.
// An instant is printed as its day in the zone given; a calendar day (`YYYY-MM-DD`) as itself.
// The English boards print the day first with a short month («14 Oct 2026»), as British English
// does, so English dates are formatted in `en-GB` (AdminApplicationsEn).
import { cityOf } from '@ijazah/time/cities';

import { formattingTag, type Locale } from '../i18n';

const ENGLISH_DATES = 'en-GB-u-ca-gregory-nu-latn';

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(
  value: string,
  locale: Locale,
  zone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  // A calendar day is that day wherever it is read: print it at noon UTC, in UTC.
  const calendar = CALENDAR_DAY.test(value);
  return new Intl.DateTimeFormat(locale === 'en' ? ENGLISH_DATES : formattingTag(locale), {
    ...options,
    ...(locale === 'en' && options.month !== undefined ? { month: 'short' } : {}),
    timeZone: calendar ? 'UTC' : zone,
  }).format(new Date(calendar ? `${value}T12:00:00Z` : value));
}

/** «14 أكتوبر»: a row's date. */
export function dayMonth(value: string, locale: Locale, zone: string): string {
  return day(value, locale, zone, { day: 'numeric', month: 'long' });
}

/** «14 أكتوبر 2026»: a detail's date. */
export function dayMonthYear(value: string, locale: Locale, zone: string): string {
  return day(value, locale, zone, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** A zone as its city in `locale`; the zone itself when the list holds no city for it. */
export function cityName(zone: string, locale: Locale): string {
  return cityOf(zone, locale) ?? zone;
}

/** «الخميس 15 أكتوبر 2026»: the home's day (B14d). */
export function weekdayDate(value: string, locale: Locale, zone: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? ENGLISH_DATES : formattingTag(locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: zone,
  })
    .format(new Date(value))
    .replace(/[،,]/u, '');
}

/** «11:20 ص»: a moment's time of day in the zone (the audit's rows, B14d). */
export function timeOfDay(value: string, locale: Locale, zone: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? ENGLISH_DATES : formattingTag(locale), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: zone,
  }).format(new Date(value));
}
