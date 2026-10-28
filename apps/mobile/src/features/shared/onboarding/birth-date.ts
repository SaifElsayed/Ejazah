// T109: the choices of the date-of-birth picker of the onboarding's profile, the app's own (three
// lists side by side: day, month, year), since Android's takes no locale. A calendar date
// (`YYYY-MM-DD`) belongs to no zone; it is read and written as its parts, and the days of a month
// come from `@ijazah/time/calendar`, so nothing here constructs a datetime (R-TIME-1).
import { daysInMonth } from '@ijazah/time/calendar';

/** A calendar date as its parts; the month runs from 1 to 12. */
export interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** The lists the picker offers: the years newest first, the months and days in order. */
export interface BirthChoices {
  readonly years: readonly number[];
  readonly months: readonly number[];
  readonly days: readonly number[];
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_IN_YEAR = 12;

/** The parts of a calendar date; a malformed one throws. */
export function partsOf(date: string): CalendarParts {
  const match = CALENDAR_DATE.exec(date);
  if (match === null) throw new RangeError(`birth-date: "${date}" is not a calendar date`);
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  return { year, month, day };
}

/** The calendar date of `parts`. */
export function dateOfParts({ year, month, day }: CalendarParts): string {
  const pad = (value: number) => String(value).padStart('MM'.length, '0');
  return `${String(year).padStart('YYYY'.length, '0')}-${pad(month)}-${pad(day)}`;
}

/** `parts` moved inside `earliest` to `latest`: a day the month lacks becomes its last day. */
export function clampParts(
  parts: CalendarParts,
  earliest: CalendarParts,
  latest: CalendarParts,
): CalendarParts {
  const year = within(parts.year, earliest.year, latest.year);
  const months = monthsOf(year, earliest, latest);
  const month = within(parts.month, months.first, months.last);
  const days = daysOf(year, month, earliest, latest);
  return { year, month, day: within(parts.day, days.first, days.last) };
}

/** What the three lists offer while `parts` is chosen, `parts` already clamped. */
export function choicesOf(
  parts: CalendarParts,
  earliest: CalendarParts,
  latest: CalendarParts,
): BirthChoices {
  const months = monthsOf(parts.year, earliest, latest);
  const days = daysOf(parts.year, parts.month, earliest, latest);
  return {
    years: range(earliest.year, latest.year).reverse(),
    months: range(months.first, months.last),
    days: range(days.first, days.last),
  };
}

interface Span {
  readonly first: number;
  readonly last: number;
}

function monthsOf(year: number, earliest: CalendarParts, latest: CalendarParts): Span {
  return {
    first: year === earliest.year ? earliest.month : 1,
    last: year === latest.year ? latest.month : MONTHS_IN_YEAR,
  };
}

function daysOf(year: number, month: number, earliest: CalendarParts, latest: CalendarParts): Span {
  return {
    first: year === earliest.year && month === earliest.month ? earliest.day : 1,
    last: year === latest.year && month === latest.month ? latest.day : daysInMonth(year, month),
  };
}

function within(value: number, first: number, last: number): number {
  return Math.min(Math.max(value, first), last);
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
