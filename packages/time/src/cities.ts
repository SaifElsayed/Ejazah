// T051 (FR-AUTH-10, FR-126): the zones a person may live by, named as cities, for the phone's
// time-zone picker and the "{city} · from the device" lines. The rows are generated from CLDR
// (`time-zone-cities.ts`, `scripts/dev/build-time-zone-cities.ts`); this entry reads them. It is its
// own export of the package (`@ijazah/time/cities`) so the phone takes the list without Temporal.
import { TIME_ZONE_CITIES } from './time-zone-cities.js';

/** A zone and its city in both languages; `aliases` are older names a device may still report. */
export interface TimeZoneCity {
  readonly zone: string;
  readonly ar: string;
  readonly en: string;
  readonly aliases: readonly string[];
}

export type CityLocale = 'ar' | 'en';

export const timeZoneCities: readonly TimeZoneCity[] = TIME_ZONE_CITIES;

const byName = new Map<string, TimeZoneCity>();
for (const city of TIME_ZONE_CITIES) {
  byName.set(city.zone, city);
  for (const alias of city.aliases) byName.set(alias, city);
}

/**
 * The listed zone `zone` names, by its current or an older name; null for a zone the list does not
 * hold (`UTC`, `Etc/*`, an unknown name), which the account refuses and a device may still report.
 */
export function listedZone(zone: string): string | null {
  return byName.get(zone)?.zone ?? null;
}

/** The city of `zone` in `locale`; null when the list does not hold it. */
export function cityOf(zone: string, locale: CityLocale): string | null {
  return byName.get(zone)?.[locale] ?? null;
}
