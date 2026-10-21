// T051 (FR-AUTH-4): a calendar date (`YYYY-MM-DD`, a date of birth) and the native date picker of
// the phone, which shows and returns a day in the device's own zone. Built here, where datetimes are
// built (R-TIME-1), and its own export (`@ijazah/time/calendar`) so the phone takes it without
// Temporal.

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
