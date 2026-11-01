// T008 (R-211, SC-303): session generation proves itself with properties over every zone the city
// list offers, not only Cairo. For each zone, a third of the cases are random weekly slots, lengths,
// instants and leads in 2020–2039 over up to a year of weeks; two thirds sit on one of the zone's
// real clock changes, found from the time zone data, so the gap and the repeat come up in every zone
// that has them (purely random slots met one gap and no repeat in 15 000 occurrences).
//
// The declared resolution (FR-019, R-TIME-7) is checked against an oracle of its own, built on the
// runtime's `Intl.DateTimeFormat` and not on the Temporal polyfill the package uses: a wall clock
// that happens once is exact, one that happens twice takes the earlier instant, and one that never
// happens is read with the offset before the gap, which moves it forward by the gap's length.
//
// Seeds are fixed (303 plus the zone's index), so a run is reproducible; a failure prints its seed
// and path. numRuns: 3 cases per zone for each generation property (418 zones) and 2 000 pairs for
// the week circle; the file runs in about twelve seconds on the development machine.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { weeklyIntervalsOverlap } from './calendar.js';
import { timeZoneCities } from './cities.js';
import {
  firstOccurrenceAfter,
  resolveOccurrences,
  type DayOfWeek,
  type Occurrence,
  type RecurringSlot,
} from './index.js';

const ZONES = timeZoneCities.map((city) => city.zone);
const RUNS_PER_ZONE = 3;
const SEED = 303;
const TIMEOUT_MILLISECONDS = 120_000;

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;
const MINUTES_PER_WEEK = 10_080;
const YEAR_OF_WEEKS = 53;
const MINIMUM_SEEN = 20;

// ---------------------------------------------------------------------------------------------
// The oracle: wall clocks read through Intl, offsets as the difference between wall and instant.

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall clock `zone` shows at `epochMilliseconds`, as milliseconds of a UTC-less calendar. */
function wallClockAt(epochMilliseconds: number, zone: string): number {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, formatter);
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(
      formatter.formatToParts(epochMilliseconds).find((candidate) => candidate.type === type)
        ?.value,
    );
  return Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
}

const offsetAt = (epochMilliseconds: number, zone: string) =>
  wallClockAt(epochMilliseconds, zone) - epochMilliseconds;

const wallClockOf = (localDate: string, localTime: string) =>
  Date.parse(`${localDate}T${localTime}Z`);

const isoOf = (epochMilliseconds: number) =>
  new Date(epochMilliseconds).toISOString().replace('.000Z', 'Z');

interface Declared {
  readonly startsAt: number;
  readonly disambiguation: Occurrence['disambiguation'];
}

/**
 * The declared resolution of a wall clock in a zone. The candidate instants are the wall clock read
 * with the offset a day before and a day after it; those that read back as the same wall clock are
 * the instants it happened at. No zone in the list changes its clocks twice within two days.
 */
function declaredResolution(localDate: string, localTime: string, zone: string): Declared {
  const wall = wallClockOf(localDate, localTime);
  const offsetBefore = offsetAt(wall - MILLISECONDS_PER_DAY, zone);
  const offsetAfter = offsetAt(wall + MILLISECONDS_PER_DAY, zone);
  const happened = [...new Set([wall - offsetBefore, wall - offsetAfter])]
    .filter((instant) => wallClockAt(instant, zone) === wall)
    .sort((a, b) => a - b);
  const [earliest] = happened;
  if (earliest === undefined) {
    return { startsAt: wall - offsetBefore, disambiguation: 'shifted_forward' };
  }
  return { startsAt: earliest, disambiguation: happened.length === 2 ? 'first_of_two' : 'exact' };
}

/** What an occurrence must be, from its own request and the slot's length, by the oracle. */
function expectedOccurrence(occurrence: Occurrence, slot: RecurringSlot): Occurrence {
  const declared = declaredResolution(
    occurrence.requestedLocalDate,
    occurrence.requestedStartTimeLocal,
    slot.timezone,
  );
  const landed = isoOf(wallClockAt(declared.startsAt, slot.timezone));
  return {
    localDate: landed.slice(0, 'YYYY-MM-DD'.length),
    startTimeLocal: landed.slice('YYYY-MM-DDT'.length, 'YYYY-MM-DDTHH:MM:SS'.length),
    timezone: slot.timezone,
    startsAt: isoOf(declared.startsAt),
    endsAt: isoOf(declared.startsAt + slot.durationMinutes * MILLISECONDS_PER_MINUTE),
    utcOffsetMinutes: offsetAt(declared.startsAt, slot.timezone) / MILLISECONDS_PER_MINUTE,
    disambiguation: declared.disambiguation,
    requestedLocalDate: occurrence.requestedLocalDate,
    requestedStartTimeLocal: occurrence.requestedStartTimeLocal,
  };
}

const daysAfter = (localDate: string, days: number) =>
  isoOf(Date.parse(`${localDate}T00:00:00Z`) + days * MILLISECONDS_PER_DAY).slice(
    0,
    'YYYY-MM-DD'.length,
  );

const dayOfWeekOf = (localDate: string) => new Date(`${localDate}T00:00:00Z`).getUTCDay();

// ---------------------------------------------------------------------------------------------
// The arbitraries.

const pad = (value: number) => String(value).padStart('00'.length, '0');

const changesFound = new Map<string, readonly number[]>();

/**
 * The instants `zone` changed its offset in `year`, each the first minute of the new offset: the
 * offset is read on the first of each month, and a month whose two ends differ is bisected to the
 * minute. A month with two changes would hide both; the generation case below then degrades to an
 * ordinary slot, which is still checked.
 */
function clockChangesIn(zone: string, year: number): readonly number[] {
  const key = `${zone} ${String(year)}`;
  const known = changesFound.get(key);
  if (known !== undefined) return known;
  const changes: number[] = [];
  for (let month = 0; month < 12; month += 1) {
    let low = Date.UTC(year, month, 1);
    let high = Date.UTC(year, month + 1, 1);
    const offsetLow = offsetAt(low, zone);
    if (offsetAt(high, zone) === offsetLow) continue;
    while (high - low > MILLISECONDS_PER_MINUTE) {
      const middle =
        low + Math.floor((high - low) / 2 / MILLISECONDS_PER_MINUTE) * MILLISECONDS_PER_MINUTE;
      if (offsetAt(middle, zone) === offsetLow) low = middle;
      else high = middle;
    }
    changes.push(high);
  }
  changesFound.set(key, changes);
  return changes;
}

/** One generated case: a slot, an instant and lead for the first occurrence, a date and a count. */
interface GenerationCase {
  readonly slot: RecurringSlot;
  readonly at: Date;
  readonly leadHours: number;
  readonly from: string;
  readonly count: number;
}

const durationMinutes = fc.constantFrom(30, 45, 60);
const leadHours = fc.integer({ min: 0, max: 72 });
const startOf2020 = Date.UTC(2020, 0, 1);
const startOf2039 = Date.UTC(2039, 0, 1);

/** Anywhere in 2020–2039, up to a year of weeks, so a zone with summer time crosses both changes. */
const anywhereIn = (zone: string): fc.Arbitrary<GenerationCase> =>
  fc
    .record({
      dayOfWeek: fc.integer({ min: 0, max: 6 }),
      minuteOfDay: fc.integer({ min: 0, max: 1_439 }),
      durationMinutes,
      at: fc.integer({ min: startOf2020, max: startOf2039 }),
      leadHours,
      fromAt: fc.integer({ min: startOf2020, max: startOf2039 }),
      count: fc.integer({ min: 1, max: YEAR_OF_WEEKS }),
    })
    .map((drawn) => ({
      slot: {
        dayOfWeek: drawn.dayOfWeek as DayOfWeek,
        startTimeLocal: `${pad(Math.floor(drawn.minuteOfDay / 60))}:${pad(drawn.minuteOfDay % 60)}:00`,
        durationMinutes: drawn.durationMinutes,
        timezone: zone,
      },
      at: new Date(drawn.at),
      leadHours: drawn.leadHours,
      from: isoOf(drawn.fromAt).slice(0, 'YYYY-MM-DD'.length),
      count: drawn.count,
    }));

/**
 * At one of the zone's real clock changes of a year in 2020–2038: the slot's day is the change's,
 * its start from half an hour before the skipped or repeated wall clock to well after it, and the
 * instant and the date a few weeks earlier, so the change's own week is among the first five. A
 * zone that kept its clock all year gets an ordinary slot on 1 June.
 */
const atClockChangeIn = (zone: string): fc.Arbitrary<GenerationCase> =>
  fc
    .record({
      year: fc.integer({ min: 2020, max: 2038 }),
      pick: fc.nat(),
      minutesIn: fc.integer({ min: -30, max: 150 }),
      durationMinutes,
      leadHours,
      daysBefore: fc.integer({ min: 1, max: 21 }),
      count: fc.integer({ min: 5, max: 8 }),
    })
    .map((drawn) => {
      const changes = clockChangesIn(zone, drawn.year);
      const change =
        changes[drawn.pick % Math.max(changes.length, 1)] ?? Date.UTC(drawn.year, 5, 1);
      const offsetBefore = offsetAt(change - MILLISECONDS_PER_MINUTE, zone);
      const wall =
        change +
        Math.min(offsetBefore, offsetAt(change, zone)) +
        drawn.minutesIn * MILLISECONDS_PER_MINUTE;
      const date = isoOf(wall).slice(0, 'YYYY-MM-DD'.length);
      return {
        slot: {
          dayOfWeek: dayOfWeekOf(date) as DayOfWeek,
          startTimeLocal: isoOf(wall).slice('YYYY-MM-DDT'.length, 'YYYY-MM-DDTHH:MM:SS'.length),
          durationMinutes: drawn.durationMinutes,
          timezone: zone,
        },
        at: new Date(
          change -
            drawn.leadHours * MILLISECONDS_PER_HOUR -
            drawn.daysBefore * MILLISECONDS_PER_DAY,
        ),
        leadHours: drawn.leadHours,
        from: daysAfter(date, -drawn.daysBefore),
        count: drawn.count,
      };
    });

const caseIn = (zone: string) =>
  fc.oneof(
    { weight: 1, arbitrary: anywhereIn(zone) },
    { weight: 2, arbitrary: atClockChangeIn(zone) },
  );

/** One `fc.assert` per zone, each with its own fixed seed, so every listed zone is exercised. */
function forEveryZone(predicate: (generated: GenerationCase) => void): void {
  ZONES.forEach((zone, index) => {
    fc.assert(fc.property(caseIn(zone), predicate), {
      numRuns: RUNS_PER_ZONE,
      seed: SEED + index,
    });
  });
}

// ---------------------------------------------------------------------------------------------

describe('T008 session generation over every zone of the city list (R-211, SC-303)', () => {
  it('lists the zones it runs over', () => {
    expect(ZONES.length).toBeGreaterThan(400);
    expect(ZONES).toContain('Africa/Cairo');
  });

  it(
    'generates from the first occurrence after the lead exactly as the declared resolution says',
    () => {
      const seen = new Map<Occurrence['disambiguation'], number>();
      forEveryZone(({ slot, at, leadHours: lead, count }) => {
        const first = firstOccurrenceAfter(slot, at, lead);
        const generated = resolveOccurrences(slot, {
          fromLocalDate: first.requestedLocalDate,
          count,
        });

        expect(generated[0]).toEqual(first);
        for (const occurrence of generated) {
          expect(occurrence).toEqual(expectedOccurrence(occurrence, slot));
          seen.set(occurrence.disambiguation, (seen.get(occurrence.disambiguation) ?? 0) + 1);
        }

        // The first is at least the lead away, and the week before it was not.
        const notBefore = at.getTime() + lead * MILLISECONDS_PER_HOUR;
        expect(Date.parse(first.startsAt)).toBeGreaterThanOrEqual(notBefore);
        const weekBefore = declaredResolution(
          daysAfter(first.requestedLocalDate, -DAYS_PER_WEEK),
          slot.startTimeLocal,
          slot.timezone,
        );
        expect(weekBefore.startsAt).toBeLessThan(notBefore);
      });

      // The property meant something only if the gap and the repeat both came up, many times.
      expect(seen.get('shifted_forward') ?? 0).toBeGreaterThan(MINIMUM_SEEN);
      expect(seen.get('first_of_two') ?? 0).toBeGreaterThan(MINIMUM_SEEN);
    },
    TIMEOUT_MILLISECONDS,
  );

  it(
    'keeps what was asked: the slot’s day each week from the anchor, its start, landed only when shifted',
    () => {
      forEveryZone(({ slot, from, count }) => {
        const occurrences = resolveOccurrences(slot, { fromLocalDate: from, count });
        const [first] = occurrences;
        if (first === undefined) throw new Error('no occurrence for a count of at least one');

        // The anchor is the slot's day on or after `from`, less than a week away.
        expect(dayOfWeekOf(first.requestedLocalDate)).toBe(slot.dayOfWeek);
        expect(first.requestedLocalDate >= from).toBe(true);
        expect(first.requestedLocalDate < daysAfter(from, DAYS_PER_WEEK)).toBe(true);

        occurrences.forEach((occurrence, week) => {
          expect(occurrence.requestedLocalDate).toBe(
            daysAfter(first.requestedLocalDate, week * DAYS_PER_WEEK),
          );
          expect(occurrence.requestedStartTimeLocal).toBe(slot.startTimeLocal);
          const asked = `${occurrence.requestedLocalDate}T${occurrence.requestedStartTimeLocal}`;
          const landed = `${occurrence.localDate}T${occurrence.startTimeLocal}`;
          if (occurrence.disambiguation === 'shifted_forward') {
            expect(landed > asked).toBe(true);
          } else {
            expect(landed).toBe(asked);
          }
        });
      });
    },
    TIMEOUT_MILLISECONDS,
  );

  it(
    'gives instants that strictly increase: each start, its end, the next start',
    () => {
      forEveryZone(({ slot, from, count }) => {
        const instants = resolveOccurrences(slot, { fromLocalDate: from, count }).flatMap(
          (occurrence) => [Date.parse(occurrence.startsAt), Date.parse(occurrence.endsAt)],
        );
        instants.slice(1).forEach((later, index) => {
          expect(later).toBeGreaterThan(instants[index] ?? Number.POSITIVE_INFINITY);
        });
      });
    },
    TIMEOUT_MILLISECONDS,
  );
});

describe('T008 weeklyIntervalsOverlap on the week circle (R-206, R-211)', () => {
  const MINUTES_PER_DAY = 1_440;
  const MINUTES_PER_HOUR = 60;

  /** A slot from its minute of the week: a day and a whole-minute local start. */
  const intervalAt = (weekMinute: number, durationMinutes: number) => {
    const minuteOfDay = weekMinute % MINUTES_PER_DAY;
    return {
      dayOfWeek: Math.floor(weekMinute / MINUTES_PER_DAY),
      startTimeLocal: `${pad(Math.floor(minuteOfDay / MINUTES_PER_HOUR))}:${pad(minuteOfDay % MINUTES_PER_HOUR)}:00`,
      durationMinutes,
    };
  };

  const length = fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(30, 45, 60) },
    { weight: 1, arbitrary: fc.integer({ min: 1, max: MINUTES_PER_WEEK }) },
  );
  // Starts anywhere, or within the last and first two hours of the week, where Saturday wraps.
  const weekMinute = fc.oneof(
    { weight: 2, arbitrary: fc.integer({ min: 0, max: MINUTES_PER_WEEK - 1 }) },
    { weight: 1, arbitrary: fc.integer({ min: 0, max: 119 }) },
    {
      weight: 1,
      arbitrary: fc.integer({ min: MINUTES_PER_WEEK - 120, max: MINUTES_PER_WEEK - 1 }),
    },
  );
  // Two slots anywhere on the week rarely meet, so half the pairs start within 90 minutes of each
  // other, across Saturday's end as often as not.
  const pair = fc.oneof(
    fc
      .tuple(weekMinute, length, weekMinute, length)
      .map(([a, lengthA, b, lengthB]) => [intervalAt(a, lengthA), intervalAt(b, lengthB)] as const),
    fc
      .tuple(weekMinute, length, fc.integer({ min: -90, max: 90 }), length)
      .map(
        ([a, lengthA, apart, lengthB]) =>
          [
            intervalAt(a, lengthA),
            intervalAt((a + apart + MINUTES_PER_WEEK) % MINUTES_PER_WEEK, lengthB),
          ] as const,
      ),
  );

  /** The minutes of the week an interval covers, counted one by one. */
  function minutesOf(value: ReturnType<typeof intervalAt>): number[] {
    const [hours = 0, minutes = 0] = value.startTimeLocal.split(':').map(Number);
    const start = value.dayOfWeek * MINUTES_PER_DAY + hours * MINUTES_PER_HOUR + minutes;
    return Array.from(
      { length: value.durationMinutes },
      (_, step) => (start + step) % MINUTES_PER_WEEK,
    );
  }

  it('is symmetric', () => {
    fc.assert(
      fc.property(pair, ([a, b]) => {
        expect(weeklyIntervalsOverlap(a, b)).toBe(weeklyIntervalsOverlap(b, a));
      }),
      { numRuns: 2_000, seed: SEED },
    );
  });

  it('agrees with a minute-by-minute check of the week', () => {
    let overlapping = 0;
    fc.assert(
      fc.property(pair, ([a, b]) => {
        const covered = new Set(minutesOf(a));
        const shared = minutesOf(b).some((minute) => covered.has(minute));
        if (shared) overlapping += 1;
        expect(weeklyIntervalsOverlap(a, b)).toBe(shared);
      }),
      { numRuns: 2_000, seed: SEED },
    );
    // The check meant something only if both answers came up often.
    expect(overlapping).toBeGreaterThan(200);
    expect(overlapping).toBeLessThan(1_800);
  });
});
