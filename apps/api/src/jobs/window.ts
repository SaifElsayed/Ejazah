// T025: the one piece of instant arithmetic the purge sweeps need, through `packages/time`
// (R-TIME-1: no `Date` arithmetic outside the package). A sweep's window is a count of hours or
// days read from a setting; the instant that long before now is what a row is compared with.
import { addSeconds } from '@ijazah/time';

export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86_400;

/** The instant `seconds` before `now`. */
export function instantBefore(now: Date, seconds: number): Date {
  return new Date(addSeconds(now, -seconds));
}
