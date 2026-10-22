// T071: the zone the panel works in, and today's calendar day there. The browser's zone when it
// names a place the list knows (by its current name); Cairo when it names none (`UTC`, `Etc/*`,
// nothing), since the time package refuses a zone that is no place (B12b) and the screens read the
// administrator's "now" in Cairo (owner's decision at B14b's conflict check). The call's day is
// refused after today in this zone, and the audit's days (B14d) are read in it.
import { listedZone } from '@ijazah/time/cities';

export const FALLBACK_TIME_ZONE = 'Africa/Cairo';

/** The zone the panel sends with a day and reads its days in. */
export function panelTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (zone === undefined ? null : listedZone(zone)) ?? FALLBACK_TIME_ZONE;
}

/** The calendar day `now` is in `zone`, `YYYY-MM-DD` (a date field's maximum). */
export function todayIn(zone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-u-ca-gregory-nu-latn', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
