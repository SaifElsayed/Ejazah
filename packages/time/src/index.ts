// T032: the time package over @js-temporal/polyfill. The public surface exposes the project's own
// types and never a Temporal object (FR-017, research R-4). Two distinct concepts, never conflated:
//   wall-clock in a zone (availability_slots.start_time_local + timezone)
//   absolute instant     (sessions.scheduled_start_at)
//
// The polyfill is imported here and in ./resolve.ts and nowhere else in the repository, which is
// what makes the eventual swap to native Temporal an internal change (research R-4). Nothing it
// returns escapes: every value handed back is a canonical string or a number, so a caller can
// compare, store and log it without a parser and without the library.
import { Temporal } from '@js-temporal/polyfill';

/** Calendar date with no zone and no time — `YYYY-MM-DD`. */
export type LocalDate = string;

/** Wall-clock time of day with no zone — `HH:MM:SS`, how Postgres renders a `time` column. */
export type LocalTime = string;

/** IANA zone identifier, e.g. `Africa/Cairo` — `availability_slots.timezone`. */
export type TimeZoneId = string;

/** Absolute instant in UTC — `YYYY-MM-DDTHH:MM:SSZ`. What a `sessions.*_at` column holds. */
export type UtcInstant = string;

/** `availability_slots.day_of_week`, 0–6 with 0 = Sunday, matching Postgres `EXTRACT(DOW)`. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * What the zone did to the requested wall-clock time (R-TIME-7, FR-019).
 * `exact` — the local time happened once. `shifted_forward` — it never happened and was moved past
 * the gap. `first_of_two` — it happened twice and the earlier instant was taken.
 */
export type Disambiguation = 'exact' | 'shifted_forward' | 'first_of_two';

/** One weekly `availability_slots` row, as the domain sees it. */
export interface RecurringSlot {
  readonly dayOfWeek: DayOfWeek;
  readonly startTimeLocal: LocalTime;
  readonly durationMinutes: number;
  readonly timezone: TimeZoneId;
}

/** A wall-clock time in a zone, resolved to an instant. The local fields are where it *landed*. */
export interface ResolvedInstant {
  readonly localDate: LocalDate;
  readonly startTimeLocal: LocalTime;
  readonly timezone: TimeZoneId;
  readonly startsAt: UtcInstant;
  readonly utcOffsetMinutes: number;
  readonly disambiguation: Disambiguation;
}

/** One resolved occurrence of a slot — a future `sessions` row's two instants. */
export interface Occurrence extends ResolvedInstant {
  readonly endsAt: UtcInstant;
}

/**
 * Refusal of an input this package cannot resolve. Thrown, not returned: every call site is either
 * a validated boundary (a zod schema has already checked the shape, so a throw is a programming
 * error) or a database row (a column that fails this test is corrupt data and must stop the request
 * loudly). Named and carrying the offending field so a caller identifies it without matching on
 * message text — the same shape as the kernel's `ConfigError` and `packages/money`'s `MoneyError`.
 */
export class TimeError extends Error {
  readonly offendingField: string;
  readonly offendingValue: string;

  constructor(
    offendingField: string,
    offendingValue: string,
    detail: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid ${offendingField}, refusing to resolve (FR-017): ${detail}`, options);
    this.name = 'TimeError';
    this.offendingField = offendingField;
    this.offendingValue = offendingValue;
  }
}

// Canonical forms only, in as well as out. Temporal itself would accept `20250418`, `2025-04-18T00`
// and an offset suffix; taking any of those in would mean the value that comes back out is not the
// value that went in, and a `LocalDate` would stop being comparable with `===`.
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

const NANOSECONDS_PER_MINUTE = 60_000_000_000;

/**
 * Refuse anything that is not the canonical `YYYY-MM-DD` naming a real calendar date, and hand the
 * value back unchanged. Exported because `./resolve.ts` applies the same rule to `fromLocalDate`
 * under its own field name, and because a caller holding a string from outside can ask before it
 * calls. It takes and returns a plain string, so nothing about Temporal travels with it.
 */
export function assertLocalDate(offendingField: string, value: LocalDate): LocalDate {
  if (!LOCAL_DATE_PATTERN.test(value)) {
    throw new TimeError(offendingField, value, 'expected the canonical form YYYY-MM-DD');
  }
  try {
    // `overflow: 'reject'` is the difference between refusing 2025-02-30 and silently reading it
    // as 2025-02-28, which would move a lesson two days with nobody told.
    Temporal.PlainDate.from(value, { overflow: 'reject' });
  } catch (error: unknown) {
    throw new TimeError(offendingField, value, 'not a date on the calendar', { cause: error });
  }
  return value;
}

function assertLocalTime(offendingField: string, value: LocalTime): LocalTime {
  if (!LOCAL_TIME_PATTERN.test(value)) {
    throw new TimeError(offendingField, value, 'expected the canonical form HH:MM:SS');
  }
  // Temporal reads a leap second `:60` as `:59` even under `overflow: 'reject'`, a silent repair.
  if (value.endsWith(':60')) {
    throw new TimeError(offendingField, value, 'not a time on the clock');
  }
  try {
    Temporal.PlainTime.from(value, { overflow: 'reject' });
  } catch (error: unknown) {
    throw new TimeError(offendingField, value, 'not a time on the clock', { cause: error });
  }
  return value;
}

/**
 * An offset string such as `+02:00` parses as a zone and then never observes a transition, so a slot
 * stored with one would keep its summer offset all winter — the failure R-TIME-3 exists to prevent.
 * This is the fast first refusal; whether a name is in the IANA database is settled by the
 * conversion, and whether it is a place by `assertAreaLocation` after it.
 */
function assertTimeZoneShape(value: TimeZoneId): TimeZoneId {
  if (!/^[A-Za-z]/.test(value)) {
    throw new TimeError('timezone', value, 'expected an IANA zone identifier, not a fixed offset');
  }
  return value;
}

// IANA's continent and ocean areas (theory.html: names are AREA/LOCATION).
const IANA_AREAS: ReadonlySet<string> = new Set([
  'Africa',
  'America',
  'Antarctica',
  'Arctic',
  'Asia',
  'Atlantic',
  'Australia',
  'Europe',
  'Indian',
  'Pacific',
]);

/**
 * A slot's zone must name a place, so it follows that place's clock law summer and winter. W3C
 * "Working with Time Zones" §3.3.3 says to avoid special-purpose ids such as `Etc/*` and to prefer
 * continent/city over legacy ids; IANA names a place AREA/LOCATION. So `Etc/GMT-2`, `UTC`, `GMT`,
 * `EST`, `Egypt`, `US/Eastern` and `africa/cairo` all resolve in Temporal and are still refused
 * (decided by Amr in the #19 review, note under T032 and T033).
 */
function assertAreaLocation(value: TimeZoneId): void {
  const [area, location] = value.split('/');
  if (area === undefined || location === undefined || !IANA_AREAS.has(area)) {
    throw new TimeError('timezone', value, 'expected a continent/city IANA zone');
  }
}

/**
 * `value` when it is a zone a person may live by: a continent/city name the IANA database knows,
 * the same refusals a slot's zone meets (T043: `onboarding.complete` and the account's time zone,
 * FR-126). A `TimeError` naming `field` otherwise.
 */
export function assertTimeZone(field: string, value: TimeZoneId): TimeZoneId {
  if (!/^[A-Za-z]/.test(value)) {
    throw new TimeError(field, value, 'expected an IANA zone identifier, not a fixed offset');
  }
  try {
    Temporal.Now.instant().toZonedDateTimeISO(value);
  } catch (error: unknown) {
    throw new TimeError(field, value, 'not a zone in the IANA database', { cause: error });
  }
  const [area, location] = value.split('/');
  if (area === undefined || location === undefined || !IANA_AREAS.has(area)) {
    throw new TimeError(field, value, 'expected a continent/city IANA zone');
  }
  return value;
}

/** Canonical UTC render: no fractional seconds, `Z` rather than `+00:00`. */
function toUtcInstant(zoned: Temporal.ZonedDateTime): UtcInstant {
  return zoned.toInstant().toString({ smallestUnit: 'second' });
}

/**
 * One wall-clock time in one zone, resolved to the instant behind it (R-TIME-7, FR-019).
 *
 * `disambiguation: 'compatible'` is the whole reason R-4 chose Temporal: across a spring-forward
 * gap it shifts forward, across a fall-back overlap it takes the earlier instant, which is the rule
 * the constitution states rather than something assembled from primitives and hoped for.
 *
 * Reporting *which* of the three happened costs two further conversions. Version 0.5 of the
 * polyfill dropped `Temporal.TimeZone`, and with it `getPossibleInstantsFor`, which would have
 * answered this by returning zero, one or two candidates; the reduced surface that native Temporal
 * ships offers no replacement, so reaching for it would have bought a rewrite at the swap. Reading
 * `earlier` against `later` answers the same question with methods that survive the move: the two
 * agree exactly when the local time happened once, `compatible` matches `earlier` over an overlap,
 * and matches `later` — the far side of the gap — when the local time never happened at all.
 */
export function resolveLocalDateTime(input: {
  readonly localDate: LocalDate;
  readonly localTime: LocalTime;
  readonly timezone: TimeZoneId;
}): ResolvedInstant {
  const localDate = assertLocalDate('localDate', input.localDate);
  const localTime = assertLocalTime('localTime', input.localTime);
  const timezone = assertTimeZoneShape(input.timezone);

  const wallClock = Temporal.PlainDateTime.from(`${localDate}T${localTime}`);

  let earlier: Temporal.ZonedDateTime;
  let later: Temporal.ZonedDateTime;
  let resolved: Temporal.ZonedDateTime;
  try {
    earlier = wallClock.toZonedDateTime(timezone, { disambiguation: 'earlier' });
    later = wallClock.toZonedDateTime(timezone, { disambiguation: 'later' });
    resolved = wallClock.toZonedDateTime(timezone, { disambiguation: 'compatible' });
  } catch (error: unknown) {
    // The date and the time are already known good, so the zone is the only input left to blame.
    throw new TimeError('timezone', timezone, 'not a zone in the IANA database', { cause: error });
  }
  assertAreaLocation(timezone);

  const disambiguation: Disambiguation =
    Temporal.ZonedDateTime.compare(earlier, later) === 0
      ? 'exact'
      : Temporal.ZonedDateTime.compare(resolved, earlier) === 0
        ? 'first_of_two'
        : 'shifted_forward';

  return {
    // Where the instant landed, not what was asked for: over a gap this reads back `01:30:00` for a
    // requested `00:30:00`, so a caller can tell a student what actually happens (note under T029).
    localDate: resolved.toPlainDate().toString(),
    startTimeLocal: resolved.toPlainTime().toString({ smallestUnit: 'second' }),
    timezone,
    startsAt: toUtcInstant(resolved),
    // Divided rather than rounded. Every zone's offset has been a whole number of minutes since
    // long before the epoch; rounding one that was not would hide it instead of showing it.
    utcOffsetMinutes: resolved.offsetNanoseconds / NANOSECONDS_PER_MINUTE,
    disambiguation,
  };
}

/**
 * The instant `seconds` whole seconds after `from`, in canonical UTC, fractions of a second
 * dropped. R-TIME-1 keeps arithmetic on an instant inside this package, so a lifetime counted in
 * seconds, such as a signed link's (T116), is added here rather than beside its caller. A lesson's
 * time is never computed this way: it is resolved from its wall clock (`resolveLocalDateTime`).
 */
export function addSeconds(from: Date, seconds: number): UtcInstant {
  if (!Number.isSafeInteger(seconds)) {
    throw new TimeError('seconds', String(seconds), 'expected a whole number of seconds');
  }
  const epochMilliseconds = from.getTime();
  if (Number.isNaN(epochMilliseconds)) {
    throw new TimeError('from', String(from), 'not an instant');
  }
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds)
    .add({ seconds })
    .toString({ smallestUnit: 'second' });
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_DAY = 86_400;

/**
 * The instant `minutes` whole minutes after `from` (T044: an access token's and a one-time code's
 * lifetimes, read in minutes from settings). The conversion lives here, beside `addSeconds`, so no
 * module carries a unit's number (the magic-number gate, FR-034).
 */
export function addMinutes(from: Date, minutes: number): UtcInstant {
  if (!Number.isSafeInteger(minutes)) {
    throw new TimeError('minutes', String(minutes), 'expected a whole number of minutes');
  }
  return addSeconds(from, minutes * SECONDS_PER_MINUTE);
}

/**
 * The instant `days` days of 24 hours after `from` (T044: a refresh token's absolute lifetime). An
 * instant's day, never a wall-clock day: a clock change in between does not move it.
 */
export function addDays(from: Date, days: number): UtcInstant {
  if (!Number.isSafeInteger(days)) {
    throw new TimeError('days', String(days), 'expected a whole number of days');
  }
  return addSeconds(from, days * SECONDS_PER_DAY);
}

export * from './resolve.js';
