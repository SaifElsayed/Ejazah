// T051, T052 (FR-AUTH-10, FR-131): the device's time zone as the app uses it, the onboarding
// form's default and the zone reported on every launch. The device may be set to UTC or a fixed
// offset, which no person lives by and the account refuses (review of B10, finding 5), or report
// a zone by an older name; the city list of `@ijazah/time/cities` decides both, without Temporal.
import { listedZone } from '@ijazah/time/cities';
import { getCalendars } from 'expo-localization';

/** The device's zone by its current name when the account accepts it; null otherwise. */
export function deviceTimeZone(): string | null {
  const reported = getCalendars()[0]?.timeZone ?? null;
  return reported === null ? null : listedZone(reported);
}
