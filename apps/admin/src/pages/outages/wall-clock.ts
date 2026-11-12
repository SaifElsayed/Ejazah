// T048 (FR-445; R-TIME-6): an outage end's wall-clock time as typed, on the 24-hour clock, read as
// the API's `HH:MM` (`slotStartTimeLocal`). Arabic-Indic (٠…٩) and Eastern Arabic-Indic (۰…۹)
// digits read as Latin, as the day field reads them (`lib/day-field.ts`); a time that does not
// exist is nothing, and the form sends nothing for it.
const TYPED = /^(\d{1,2}):(\d{2})$/;
const HOURS = 24;
const MINUTES = 60;

function latinDigits(typed: string): string {
  return typed
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - '٠'.charCodeAt(0)))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - '۰'.charCodeAt(0)));
}

/** The `HH:MM` a typed time names; nothing for a time that is not whole or does not exist. */
export function wallClockOf(typed: string): string | undefined {
  const match = TYPED.exec(latinDigits(typed.trim()));
  if (match === null) return undefined;
  const [, hour = '', minute = ''] = match;
  if (Number(hour) >= HOURS || Number(minute) >= MINUTES) return undefined;
  return `${hour.padStart(2, '0')}:${minute}`;
}
