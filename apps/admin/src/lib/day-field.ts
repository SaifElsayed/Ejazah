// T111: the call's day typed day / month / year, as the board draws it (`AdminApplications`, «يوم /
// شهر / سنة»), never the browser's month / day / year. The field shows `DD/MM/YYYY` in Latin digits
// as it is typed; the API takes the calendar date, `YYYY-MM-DD`, and the time package says whether
// that day exists (R-TIME-1).
import { calendarDaysBefore } from '@ijazah/time/calendar';

const DAY_DIGITS = 'DD'.length;
const MONTH_DIGITS = 'MM'.length;
const YEAR_DIGITS = 'YYYY'.length;
const FIELD = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** The digits typed, Arabic-Indic (٠…٩) and Eastern Arabic-Indic (۰…۹) read as Latin. */
function latinDigits(typed: string): string {
  return typed
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - '٠'.charCodeAt(0)))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - '۰'.charCodeAt(0)))
    .replace(/\D/g, '');
}

/** What the field shows for what was typed: its digits, at most a whole date, a slash after the day and the month. */
export function dayFieldText(typed: string): string {
  const digits = latinDigits(typed).slice(0, DAY_DIGITS + MONTH_DIGITS + YEAR_DIGITS);
  const day = digits.slice(0, DAY_DIGITS);
  const month = digits.slice(DAY_DIGITS, DAY_DIGITS + MONTH_DIGITS);
  const year = digits.slice(DAY_DIGITS + MONTH_DIGITS);
  return [day, month, year].filter((part) => part !== '').join('/');
}

/** A calendar date (`YYYY-MM-DD`, a recorded call) as the field shows it. */
export function dayFieldOf(date: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  return dayFieldText(`${day}${month}${year}`);
}

/** The calendar date (`YYYY-MM-DD`) a whole field names, day first; nothing for a day that does not exist. */
export function calendarDateOfDayField(text: string): string | undefined {
  const match = FIELD.exec(text);
  if (match === null) return undefined;
  const [, day, month, year] = match;
  const date = `${year ?? ''}-${month ?? ''}-${day ?? ''}`;
  try {
    // No days before: the same date, refused when the calendar does not have it.
    return calendarDaysBefore(date, 0);
  } catch {
    return undefined;
  }
}
