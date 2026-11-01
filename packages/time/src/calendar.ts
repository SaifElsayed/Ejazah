// T051 (FR-AUTH-4): a calendar date (`YYYY-MM-DD`, a date of birth) and the native date picker of
// the phone, which shows and returns a day in the device's own zone. Built here, where datetimes are
// built (R-TIME-1), and its own export (`@ijazah/time/calendar`) so the phone takes it without
// Temporal. B14d: a calendar date a number of days earlier (the admin's audit). T109: the days of a
// month, for the phone's own date-of-birth picker. T007: whether two weekly slots overlap on the
// week (R-206), and the seconds a checkout has left (R-217).

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

/** A weekly slot as the week sees it: a day (0 = Sunday, Postgres DOW), a local start, a length. */
export interface WeeklyInterval {
  readonly dayOfWeek: number;
  readonly startTimeLocal: string;
  readonly durationMinutes: number;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1_440;
const MINUTES_PER_WEEK = 10_080;
const DAYS_PER_WEEK = 7;
const WHOLE_MINUTE_TIME = /^([01]\d|2[0-3]):([0-5]\d):00$/;

/** Where `interval` starts on the week, in minutes from Sunday 00:00, and how long it lasts. */
function weekMinutesOf(interval: WeeklyInterval): { start: number; length: number } {
  const { dayOfWeek, startTimeLocal, durationMinutes } = interval;
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek >= DAYS_PER_WEEK) {
    throw new RangeError(`calendar: ${String(dayOfWeek)} is not a day of the week (0–6)`);
  }
  const time = WHOLE_MINUTE_TIME.exec(startTimeLocal);
  if (time === null) {
    throw new RangeError(`calendar: "${startTimeLocal}" is not a whole minute of the day`);
  }
  if (
    !Number.isSafeInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > MINUTES_PER_WEEK
  ) {
    throw new RangeError(`calendar: ${String(durationMinutes)} is not a length within a week`);
  }
  const [, hours, minutes] = time.map(Number);
  return {
    start: dayOfWeek * MINUTES_PER_DAY + (hours ?? 0) * MINUTES_PER_HOUR + (minutes ?? 0),
    length: durationMinutes,
  };
}

/**
 * Whether two weekly slots of one zone share a minute of the week (T007, R-206, FR-317). The week
 * is a circle of 10 080 minutes: a slot is `[start, start + length)` taken modulo 10 080, so one
 * that crosses midnight reaches into the next day and Saturday's end reaches Sunday. Two arcs meet
 * exactly when one's start lies inside the other. The zone is the caller's: both slots are read in
 * the same one.
 */
export function weeklyIntervalsOverlap(a: WeeklyInterval, b: WeeklyInterval): boolean {
  const first = weekMinutesOf(a);
  const second = weekMinutesOf(b);
  const startsInside = (outer: typeof first, inner: typeof first) =>
    (((inner.start - outer.start) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK <
    outer.length;
  return startsInside(first, second) || startsInside(second, first);
}

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MILLISECONDS_PER_SECOND = 1_000;
const WHOLE_SECONDS = 'YYYY-MM-DDTHH:MM:SS'.length;

/**
 * The whole seconds from `now` until `instant`, a part of a second counted as a second, so zero
 * means the instant has come, and never below zero (T007, R-217: the checkout countdown, the
 * order's expiry from the server against the phone's own clock, which keeps counting offline).
 */
export function secondsUntil(instant: string, now: Date): number {
  const at = UTC_INSTANT.test(instant) ? Date.parse(instant) : Number.NaN;
  if (
    Number.isNaN(at) ||
    new Date(at).toISOString().slice(0, WHOLE_SECONDS) !== instant.slice(0, WHOLE_SECONDS)
  ) {
    throw new RangeError(`calendar: "${instant}" is not a UTC instant`);
  }
  const from = now.getTime();
  if (Number.isNaN(from)) throw new RangeError('calendar: now is not an instant');
  return Math.max(0, Math.ceil((at - from) / MILLISECONDS_PER_SECOND));
}
