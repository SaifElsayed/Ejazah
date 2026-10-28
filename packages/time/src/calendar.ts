// T051 (FR-AUTH-4): a calendar date (`YYYY-MM-DD`, a date of birth) and the native date picker of
// the phone, which shows and returns a day in the device's own zone. Built here, where datetimes are
// built (R-TIME-1), and its own export (`@ijazah/time/calendar`) so the phone takes it without
// Temporal. B14d: a calendar date a number of days earlier (the admin's audit). T109: the days of a
// month, for the phone's own date-of-birth picker.

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The day `date` is, as the picker takes it: that day's midnight in the device's own zone. */
export function pickerDateOf(date: string): Date {
  const match = CALENDAR_DATE.exec(date);
  if (match === null) throw new RangeError(`calendar: "${date}" is not a calendar date`);
  const [, year, month, day] = match.map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError(`calendar: "${date}" is not a calendar date`);
  }
  const picked = new Date(year, month - 1, day);
  if (calendarDateOfPicked(picked) !== date) {
    throw new RangeError(`calendar: "${date}" is not a calendar date`);
  }
  return picked;
}

/** The calendar date of the day the picker shows, read in the device's own zone. */
export function calendarDateOfPicked(picked: Date): string {
  const pad = (value: number) => String(value).padStart('MM'.length, '0');
  return `${picked.getFullYear()}-${pad(picked.getMonth() + 1)}-${pad(picked.getDate())}`;
}

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * The calendar date `count` days before `date`, both `YYYY-MM-DD` (B14d: the admin's audit reads its
 * last thirty days). Calendar days, counted at noon UTC, so no zone or clock change moves them.
 */
export function calendarDaysBefore(date: string, count: number): string {
  if (!Number.isSafeInteger(count)) {
    throw new RangeError(`calendar: ${String(count)} is not a whole number of days`);
  }
  const match = CALENDAR_DATE.exec(date);
  const noon = match === null ? Number.NaN : Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(noon) || new Date(noon).toISOString().slice(0, 'YYYY-MM-DD'.length) !== date) {
    throw new RangeError(`calendar: "${date}" is not a calendar date`);
  }
  return new Date(noon - count * MILLISECONDS_PER_DAY).toISOString().slice(0, 'YYYY-MM-DD'.length);
}

/** The days of each month of the Gregorian calendar, February's in a common year. */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const FEBRUARY = 2;

/**
 * The number of days in `month` (1 to 12) of `year` (T109: the date-of-birth picker offers no day
 * the month lacks). Counted by the Gregorian rule, with no Date, so no zone moves it.
 */
export function daysInMonth(year: number, month: number): number {
  const days = Number.isSafeInteger(year) ? MONTH_DAYS[month - 1] : undefined;
  if (days === undefined) {
    throw new RangeError(`calendar: ${String(year)}-${String(month)} is not a month`);
  }
  return month === FEBRUARY && isLeapYear(year) ? days + 1 : days;
}

/** Every fourth year, except a century that is not a fourth century. */
function isLeapYear(year: number): boolean {
  const divides = (divisor: number) => year % divisor === 0;
  return divides(4) && (!divides(100) || divides(400));
}
