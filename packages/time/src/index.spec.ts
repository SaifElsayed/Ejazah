// T032/T033 — the paths the four mandatory DST cases in `resolve.spec.ts` do not reach: what the
// package refuses, where a week starts, and the two places a duration is added.
//
// `resolve.spec.ts` is T029's deliverable and stays as it was written — four cases, one per
// mandated proof. Everything the implementation added of its own accord is asserted here instead.

import { describe, expect, it } from 'vitest';

import {
  addDays,
  addHours,
  addMinutes,
  addSeconds,
  assertTimeZone,
  calendarDateOf,
  assertLocalDate,
  endOfLocalDay,
  resolveLocalDateTime,
  startOfLocalDay,
  resolveOccurrences,
  TimeError,
  unixSeconds,
  wholeHoursSince,
  type RecurringSlot,
} from './index.js';

const CAIRO = 'Africa/Cairo';

// 2025-04-18 is a Friday, so 2025-04-20 is a Sunday and 2025-04-21 a Monday. Every anchoring case
// below is stated against those three, which the Cairo cases in `resolve.spec.ts` already pin.
const FRIDAY = '2025-04-18';
const SUNDAY = '2025-04-20';
const MONDAY = '2025-04-21';

const fridayMorning: RecurringSlot = {
  dayOfWeek: 5,
  startTimeLocal: '09:00:00',
  durationMinutes: 60,
  timezone: CAIRO,
};

/** The refusal itself, so a case can assert which field was blamed rather than only that it threw. */
function refusalFrom(call: () => unknown): TimeError {
  try {
    call();
  } catch (error: unknown) {
    if (error instanceof TimeError) return error;
    throw error;
  }
  throw new Error('expected a TimeError, but the call returned');
}

describe('T032 the public surface carries no Temporal object (FR-017)', () => {
  it('returns only strings and numbers', () => {
    const [occurrence] = resolveOccurrences(fridayMorning, { fromLocalDate: FRIDAY, count: 1 });

    // The compiled declaration is the real proof — a Temporal type in a signature would be a
    // published dependency on the polyfill. This is the runtime half: nothing that comes back is an
    // object, so a caller can compare, store or log it without the library ever being loaded.
    expect(Object.values(occurrence ?? {}).every((value) => typeof value !== 'object')).toBe(true);
    expect(occurrence).toEqual({
      localDate: FRIDAY,
      startTimeLocal: '09:00:00',
      timezone: CAIRO,
      startsAt: '2025-04-18T07:00:00Z',
      endsAt: '2025-04-18T08:00:00Z',
      utcOffsetMinutes: 120,
      disambiguation: 'exact',
    });
  });

  it('resolves a zone whose offset is not a whole hour', () => {
    // Cairo alone would let a bug that assumes hour-sized offsets pass. Kolkata is +05:30 and has
    // observed no transition since 1945, so the number is the offset and nothing else.
    expect(
      resolveLocalDateTime({ localDate: FRIDAY, localTime: '09:00:00', timezone: 'Asia/Kolkata' }),
    ).toEqual({
      localDate: FRIDAY,
      startTimeLocal: '09:00:00',
      timezone: 'Asia/Kolkata',
      startsAt: '2025-04-18T03:30:00Z',
      utcOffsetMinutes: 330,
      disambiguation: 'exact',
    });
  });
});

describe('T033 where the first occurrence lands (day_of_week 0 = Sunday)', () => {
  const sundayEvening: RecurringSlot = {
    dayOfWeek: 0,
    startTimeLocal: '18:00:00',
    durationMinutes: 45,
    timezone: CAIRO,
  };

  it('starts on fromLocalDate when that day is already the slot day', () => {
    const [occurrence] = resolveOccurrences(sundayEvening, { fromLocalDate: SUNDAY, count: 1 });
    expect(occurrence?.localDate).toBe(SUNDAY);
  });

  it('wraps to the next week when fromLocalDate is the day after the slot day', () => {
    // Monday to Sunday is six days, and 0 must mean Sunday for it to be six rather than one.
    const [occurrence] = resolveOccurrences(sundayEvening, { fromLocalDate: MONDAY, count: 1 });
    expect(occurrence?.localDate).toBe('2025-04-27');
  });

  it('returns exactly count occurrences, one calendar week apart', () => {
    const occurrences = resolveOccurrences(sundayEvening, { fromLocalDate: MONDAY, count: 4 });
    expect(occurrences.map((occurrence) => occurrence.localDate)).toEqual([
      '2025-04-27',
      '2025-05-04',
      '2025-05-11',
      '2025-05-18',
    ]);
  });
});

describe('T033 each occurrence is resolved alone (FR-018, R-TIME-2)', () => {
  it('gives the same answer for an occurrence asked for on its own', () => {
    // The structural proof that occurrence N never reads occurrence N−1. The sequence spans the
    // April transition, so if any iteration carried the previous instant forward, the third
    // occurrence of the run would differ from the same date resolved from a standing start.
    const sequence = resolveOccurrences(fridayMorning, { fromLocalDate: FRIDAY, count: 3 });

    for (const occurrence of sequence) {
      const [alone] = resolveOccurrences(fridayMorning, {
        fromLocalDate: occurrence.localDate,
        count: 1,
      });
      expect(alone).toEqual(occurrence);
    }
  });

  it('carries the gap disambiguation into an occurrence', () => {
    // A Friday 00:30 slot: on 2025-04-25 that wall-clock time does not exist in Cairo.
    const [occurrence] = resolveOccurrences(
      { dayOfWeek: 5, startTimeLocal: '00:30:00', durationMinutes: 60, timezone: CAIRO },
      { fromLocalDate: '2025-04-25', count: 1 },
    );

    expect(occurrence).toEqual({
      localDate: '2025-04-25',
      startTimeLocal: '01:30:00',
      timezone: CAIRO,
      startsAt: '2025-04-24T22:30:00Z',
      endsAt: '2025-04-24T23:30:00Z',
      utcOffsetMinutes: 180,
      disambiguation: 'shifted_forward',
    });
  });

  it('adds the lesson length as elapsed time, not as wall clock', () => {
    // A two-hour Thursday lesson beginning inside the October overlap. Elapsed time says the
    // teacher is there until 22:30Z; the wall clock reads 23:30 to 00:30, one hour, because the
    // clocks went back underneath. `endsAt` follows the elapsed hours, which is what a lesson is.
    const [occurrence] = resolveOccurrences(
      { dayOfWeek: 4, startTimeLocal: '23:30:00', durationMinutes: 120, timezone: CAIRO },
      { fromLocalDate: '2025-10-30', count: 1 },
    );

    expect(occurrence).toEqual({
      localDate: '2025-10-30',
      startTimeLocal: '23:30:00',
      timezone: CAIRO,
      startsAt: '2025-10-30T20:30:00Z',
      endsAt: '2025-10-30T22:30:00Z',
      utcOffsetMinutes: 180,
      disambiguation: 'first_of_two',
    });
  });
});

describe('T032 what the package refuses', () => {
  it('refuses a local date that is not the canonical form', () => {
    for (const localDate of ['2025-4-18', '18-04-2025', '20250418', '2025-04-18T00:00:00']) {
      const error = refusalFrom(() =>
        resolveLocalDateTime({ localDate, localTime: '09:00:00', timezone: CAIRO }),
      );
      expect(error.offendingField).toBe('localDate');
      expect(error.offendingValue).toBe(localDate);
    }
  });

  it('refuses a date that is not on the calendar rather than moving it', () => {
    // Temporal would read this as 2025-02-28 under its default `constrain`, which is a lesson
    // silently moved two days. `overflow: 'reject'` is what turns that into a refusal.
    const error = refusalFrom(() =>
      resolveLocalDateTime({ localDate: '2025-02-30', localTime: '09:00:00', timezone: CAIRO }),
    );
    expect(error.offendingField).toBe('localDate');
  });

  it('refuses a local time that is not the canonical form or not on the clock', () => {
    for (const localTime of [
      '9:00:00',
      '09:00',
      '09:00:00.500',
      '25:00:00',
      '09:60:00',
      '23:59:60',
    ]) {
      const error = refusalFrom(() =>
        resolveLocalDateTime({ localDate: FRIDAY, localTime, timezone: CAIRO }),
      );
      expect(error.offendingField).toBe('localTime');
      expect(error.offendingValue).toBe(localTime);
    }
  });

  it('refuses a fixed offset in place of a zone (R-TIME-3)', () => {
    // `+02:00` parses as a time zone and then never observes a transition, so a slot stored with
    // one keeps its summer offset all winter. That is the bug R-TIME-3 exists to prevent.
    for (const timezone of ['+02:00', '-05:00']) {
      const error = refusalFrom(() =>
        resolveLocalDateTime({ localDate: FRIDAY, localTime: '09:00:00', timezone }),
      );
      expect(error.offendingField).toBe('timezone');
      expect(error.offendingValue).toBe(timezone);
    }
  });

  it('refuses a zone that resolves but is not a continent/city place (W3C §3.3.3)', () => {
    // Each of these is in the IANA database, so the conversion succeeds; a missing `cause` is what
    // shows the area check refused it rather than the database lookup.
    for (const timezone of [
      'Etc/GMT-2',
      'Etc/UTC',
      'UTC',
      'GMT',
      'EST',
      'Egypt',
      'US/Eastern',
      'africa/cairo',
    ]) {
      const error = refusalFrom(() =>
        resolveLocalDateTime({ localDate: FRIDAY, localTime: '09:00:00', timezone }),
      );
      expect(error.offendingField).toBe('timezone');
      expect(error.offendingValue).toBe(timezone);
      expect(error.cause).toBeUndefined();
    }
  });

  it('accepts a continent/city zone with or without summer time, at any depth', () => {
    // Kolkata has had no transition since 1945; the rule is "a place", not "has DST".
    for (const timezone of ['Asia/Kolkata', 'America/Argentina/Buenos_Aires']) {
      expect(
        resolveLocalDateTime({ localDate: FRIDAY, localTime: '09:00:00', timezone }).timezone,
      ).toBe(timezone);
    }
  });

  it('refuses a zone that is not in the IANA database', () => {
    const error = refusalFrom(() =>
      resolveLocalDateTime({
        localDate: FRIDAY,
        localTime: '09:00:00',
        timezone: 'Africa/Atlantis',
      }),
    );
    expect(error.offendingField).toBe('timezone');
    expect(error.cause).toBeDefined();
  });

  it('refuses a day of week outside 0–6', () => {
    for (const dayOfWeek of [-1, 7, 1.5, Number.NaN]) {
      const error = refusalFrom(() =>
        resolveOccurrences(
          { ...fridayMorning, dayOfWeek: dayOfWeek as RecurringSlot['dayOfWeek'] },
          { fromLocalDate: FRIDAY, count: 1 },
        ),
      );
      expect(error.offendingField).toBe('dayOfWeek');
    }
  });

  it('refuses a non-positive or fractional count rather than returning nothing', () => {
    // A zero that quietly produced an empty list would leave a paid enrollment with no sessions
    // and no error to show for it.
    for (const count of [0, -3, 2.5, Number.POSITIVE_INFINITY]) {
      const error = refusalFrom(() =>
        resolveOccurrences(fridayMorning, { fromLocalDate: FRIDAY, count }),
      );
      expect(error.offendingField).toBe('count');
    }
  });

  it('refuses a non-positive or fractional lesson length', () => {
    for (const durationMinutes of [0, -30, 30.5]) {
      const error = refusalFrom(() =>
        resolveOccurrences(
          { ...fridayMorning, durationMinutes },
          { fromLocalDate: FRIDAY, count: 1 },
        ),
      );
      expect(error.offendingField).toBe('durationMinutes');
    }
  });

  it('refuses a malformed fromLocalDate under its own field name', () => {
    const error = refusalFrom(() =>
      resolveOccurrences(fridayMorning, { fromLocalDate: '18-04-2025', count: 1 }),
    );
    expect(error.offendingField).toBe('fromLocalDate');
  });

  it('is identifiable without matching on message text', () => {
    const error = refusalFrom(() => assertLocalDate('localDate', 'not a date'));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TimeError');
    expect(assertLocalDate('localDate', FRIDAY)).toBe(FRIDAY);
  });
});

describe('T116 addSeconds: a lifetime counted from an instant (R-TIME-1)', () => {
  it('adds whole seconds and answers in canonical UTC, fractions of a second dropped', () => {
    expect(addSeconds(new Date('2026-10-07T10:00:00.900Z'), 600)).toBe('2026-10-07T10:10:00Z');
    expect(addSeconds(new Date('2026-10-07T23:59:59Z'), 604_800)).toBe('2026-10-14T23:59:59Z');
    expect(addSeconds(new Date('2026-10-07T10:00:00Z'), 0)).toBe('2026-10-07T10:00:00Z');
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s seconds, naming the field',
    (seconds) => {
      expect(() => addSeconds(new Date('2026-10-07T10:00:00Z'), seconds)).toThrow(
        expect.objectContaining({ name: 'TimeError', offendingField: 'seconds' }),
      );
    },
  );

  it('refuses a Date that holds no instant', () => {
    expect(() => addSeconds(new Date('not a date'), 1)).toThrow(
      expect.objectContaining({ name: 'TimeError', offendingField: 'from' }),
    );
  });
});

describe('T043 assertTimeZone: the zones a person may choose (FR-126, onboarding.complete)', () => {
  it('admits a continent/city zone the IANA database knows', () => {
    expect(assertTimeZone('timezone', CAIRO)).toBe(CAIRO);
    expect(assertTimeZone('timezone', 'America/Argentina/Buenos_Aires')).toBe(
      'America/Argentina/Buenos_Aires',
    );
  });

  it.each(['+02:00', 'UTC', 'Etc/GMT-2', 'Egypt', 'Africa/Atlantis', 'africa/cairo', ''])(
    'refuses %j, naming the field',
    (zone) => {
      expect(() => assertTimeZone('timezone', zone)).toThrow(TimeError);
      try {
        assertTimeZone('timezone', zone);
      } catch (error) {
        expect((error as TimeError).offendingField).toBe('timezone');
      }
    },
  );
});

describe('T044 addMinutes and addDays: a session’s lifetimes, counted from an instant (R-101)', () => {
  it('adds whole minutes and whole days of 24 hours, in canonical UTC', () => {
    expect(addMinutes(new Date('2026-10-20T08:00:00Z'), 15)).toBe('2026-10-20T08:15:00Z');
    expect(addDays(new Date('2026-10-20T08:00:00Z'), 30)).toBe('2026-11-19T08:00:00Z');
    // A day is 24 hours of an instant, never a wall-clock day: Cairo's clock change does not move it.
    expect(addDays(new Date('2026-10-29T21:30:00Z'), 1)).toBe('2026-10-30T21:30:00Z');
  });

  it.each([1.5, Number.NaN])('refuses %s, naming the field', (amount) => {
    expect(() => addMinutes(new Date('2026-10-20T08:00:00Z'), amount)).toThrow(
      expect.objectContaining({ name: 'TimeError', offendingField: 'minutes' }),
    );
    expect(() => addDays(new Date('2026-10-20T08:00:00Z'), amount)).toThrow(
      expect.objectContaining({ name: 'TimeError', offendingField: 'days' }),
    );
  });
});

describe('T066 addHours: an administrator session’s and an invite link’s lifetimes (R-107, R-110)', () => {
  it('adds whole hours of an instant, in canonical UTC', () => {
    expect(addHours(new Date('2026-10-20T08:00:00Z'), 12)).toBe('2026-10-20T20:00:00Z');
    // An hour of an instant: Cairo's clock change in between does not move it.
    expect(addHours(new Date('2026-10-29T21:30:00Z'), 48)).toBe('2026-10-31T21:30:00Z');
  });

  it.each([1.5, Number.NaN])('refuses %s, naming the field', (amount) => {
    expect(() => addHours(new Date('2026-10-20T08:00:00Z'), amount)).toThrow(
      expect.objectContaining({ name: 'TimeError', offendingField: 'hours' }),
    );
  });
});

describe('T066 unixSeconds: the whole seconds since the epoch an RFC 6238 time step counts', () => {
  it('answers the whole seconds, a fraction dropped', () => {
    expect(unixSeconds(new Date('1970-01-01T00:00:59Z'))).toBe(59);
    expect(unixSeconds(new Date('2009-02-13T23:31:30.999Z'))).toBe(1_234_567_890);
  });

  it('refuses a Date that holds no instant', () => {
    expect(() => unixSeconds(new Date(Number.NaN))).toThrow(
      expect.objectContaining({ name: 'TimeError', offendingField: 'at' }),
    );
  });
});

describe('T065 wholeHoursSince: the age of a queue item in whole hours, the reader passing now', () => {
  it('answers the whole hours from `from` to `now`, a part of an hour dropped', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(wholeHoursSince(new Date('2026-10-21T12:00:00Z'), now)).toBe(0);
    expect(wholeHoursSince(new Date('2026-10-21T11:00:01Z'), now)).toBe(0);
    expect(wholeHoursSince(new Date('2026-10-21T11:00:00Z'), now)).toBe(1);
    expect(wholeHoursSince(new Date('2026-10-18T09:30:00Z'), now)).toBe(74);
  });

  it('answers zero for an instant after now, never a negative age', () => {
    expect(
      wholeHoursSince(new Date('2026-10-21T15:00:00Z'), new Date('2026-10-21T12:00:00Z')),
    ).toBe(0);
  });

  it('refuses a Date that holds no instant, naming the field', () => {
    expect(() => wholeHoursSince(new Date(Number.NaN), new Date())).toThrow(
      expect.objectContaining({ name: 'TimeError', offendingField: 'from' }),
    );
    expect(() => wholeHoursSince(new Date(), new Date(Number.NaN))).toThrow(
      expect.objectContaining({ name: 'TimeError', offendingField: 'now' }),
    );
  });
});

describe('T067 startOfLocalDay and endOfLocalDay: a calendar day in a zone as the instants that bound it', () => {
  it('answers the first instant of the day and the first of the next, in the zone given', () => {
    expect(startOfLocalDay('2026-10-21', CAIRO)).toBe('2026-10-20T21:00:00Z');
    expect(endOfLocalDay('2026-10-21', CAIRO)).toBe('2026-10-21T21:00:00Z');
    expect(startOfLocalDay('2026-10-21', 'Asia/Riyadh')).toBe('2026-10-20T21:00:00Z');
    expect(endOfLocalDay('2026-12-31', 'Europe/London')).toBe('2027-01-01T00:00:00Z');
  });

  it('starts a day whose midnight a clock change skipped at the first instant that exists', () => {
    // Cairo moved its clocks from 00:00 to 01:00 on 2025-04-25 (Egypt's DST start, Law 24/2023).
    expect(startOfLocalDay('2025-04-25', CAIRO)).toBe('2025-04-24T22:00:00Z');
    expect(endOfLocalDay('2025-04-24', CAIRO)).toBe('2025-04-24T22:00:00Z');
  });

  it('refuses a date or a zone that is not one, naming the field', () => {
    expect(() => startOfLocalDay('2026-02-30', CAIRO)).toThrow(
      expect.objectContaining({ name: 'TimeError', offendingField: 'localDate' }),
    );
    expect(() => endOfLocalDay('2026-10-21', 'Mars/Olympus')).toThrow(
      expect.objectContaining({ name: 'TimeError', offendingField: 'timezone' }),
    );
  });
});

describe('T049 calendarDateOf: the calendar date a `date` column holds (R-TIME-6)', () => {
  it('answers the date of a value read as midnight UTC, whatever the host zone', () => {
    expect(calendarDateOf(new Date('1990-04-12'))).toBe('1990-04-12');
    expect(calendarDateOf(new Date('2000-02-29T00:00:00Z'))).toBe('2000-02-29');
  });

  it('refuses a value that is not an instant, naming the field', () => {
    expect(() => calendarDateOf(new Date('not a date'))).toThrow(
      expect.objectContaining({ name: 'TimeError', offendingField: 'date' }),
    );
  });
});
