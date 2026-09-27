// T029 — the DST proof for R-TIME-2 and R-TIME-7, against real Cairo transitions (FR-018, FR-019).
//
// Written red, against a `src/resolve.ts` that was still `export {}`, and green since T032 and T033
// implemented the package over `@js-temporal/polyfill`. Do not weaken an assertion and do not mark
// a case skipped to make the suite green — `proc/no-focused-or-skipped-test` (R-PROC-10) exists so
// that route stays closed.
//
// The API these cases fix was declared locally at the time and the module namespace was cast to it,
// because a named import from a module that exported nothing would have been a build error rather
// than a failing test. The implementation has landed, so the declaration and the cast are gone
// (T032/T033 follow-up): the imports below are the real exports, and this file now fails to compile
// if the implementation drifts from the shape asserted here, which `as unknown as` could not do.
//
// Why these dates. Egypt reinstated summer time in 2023: forward on the last Friday of April at
// 00:00 local, back on the last Thursday of October at 24:00 local, with the rule suspended over
// Ramadan. In 2025 Ramadan ran 1–30 March, so neither transition fell inside the suspension window
// and both follow the plain rule. The instants below were not taken from memory — they were read
// out of the IANA database shipped with the runtime (Node 24, ICU 77.1) by scanning `Africa/Cairo`
// at 15-minute steps across 2025 and recording where the UTC offset changed:
//
//   gap     2025-04-24T22:00:00Z — local 2025-04-25 00:00 (+02:00) becomes 01:00 (+03:00)
//   overlap 2025-10-30T21:00:00Z — local 2025-10-31 00:00 (+03:00) becomes 2025-10-30 23:00 (+02:00)
//
// So local 2025-04-25 00:00:00–00:59:59 never happens, and local 2025-10-30 23:00:00–23:59:59
// happens twice. The polyfill was not a dependency when these were written — adding it was T032 —
// so the expected UTC instants are written literally, each one derived from an offset stated above.

import { describe, expect, it } from 'vitest';

// The public API T032 and T033 had to satisfy. Project types only, never a Temporal object
// (FR-017). Canonical string forms, so a value is comparable without a parser: `LocalDate` is
// `YYYY-MM-DD`, `LocalTime` is `HH:MM:SS` (the render of `availability_slots.start_time_local`),
// `UtcInstant` is `YYYY-MM-DDTHH:MM:SSZ` (the render of a `timestamptz` in UTC).
import {
  resolveLocalDateTime,
  resolveOccurrences,
  type RecurringSlot,
  type TimeZoneId,
} from './index.js';

const CAIRO: TimeZoneId = 'Africa/Cairo';
const EET = 120; // +02:00, Egypt standard time
const EEST = 180; // +03:00, Egypt summer time

// A Friday 09:00 class, sixty minutes. Friday because both 2025 Cairo transitions land on the
// night into a Friday, so a Friday slot has the transition inside its own week rather than beside
// it, and 09:00 because it is far from both the gap and the overlap — the wall-clock time is
// perfectly ordinary and only the offset moves under it.
const fridayMorning: RecurringSlot = {
  dayOfWeek: 5,
  startTimeLocal: '09:00:00',
  durationMinutes: 60,
  timezone: CAIRO,
};

describe('T029 weekly recurrence across a Cairo DST transition (FR-018, R-TIME-2)', () => {
  it('preserves the local hour and moves the offset across the spring-forward', () => {
    const occurrences = resolveOccurrences(fridayMorning, {
      fromLocalDate: '2025-04-18',
      count: 3,
    });

    // The week before the transition is +02:00; the transition week and the one after are +03:00.
    // 09:00 − 02:00 = 07:00Z, then 09:00 − 03:00 = 06:00Z.
    expect(occurrences).toEqual([
      {
        localDate: '2025-04-18',
        startTimeLocal: '09:00:00',
        timezone: CAIRO,
        startsAt: '2025-04-18T07:00:00Z',
        endsAt: '2025-04-18T08:00:00Z',
        utcOffsetMinutes: EET,
        disambiguation: 'exact',
      },
      {
        localDate: '2025-04-25',
        startTimeLocal: '09:00:00',
        timezone: CAIRO,
        startsAt: '2025-04-25T06:00:00Z',
        endsAt: '2025-04-25T07:00:00Z',
        utcOffsetMinutes: EEST,
        disambiguation: 'exact',
      },
      {
        localDate: '2025-05-02',
        startTimeLocal: '09:00:00',
        timezone: CAIRO,
        startsAt: '2025-05-02T06:00:00Z',
        endsAt: '2025-05-02T07:00:00Z',
        utcOffsetMinutes: EEST,
        disambiguation: 'exact',
      },
    ]);

    // R-TIME-2 stated as two halves, so an implementation cannot satisfy one by breaking the other.
    // The student keeps their 09:00 lesson; the instant behind it is what moves.
    expect(occurrences.map((occurrence) => occurrence.startTimeLocal)).toEqual([
      '09:00:00',
      '09:00:00',
      '09:00:00',
    ]);
    expect(occurrences.map((occurrence) => occurrence.utcOffsetMinutes)).toEqual([EET, EEST, EEST]);

    // Adding 7 × 24h to the first instant yields 2025-04-25T07:00:00Z, which is 10:00 in Cairo —
    // the lesson an hour late, every week, forever. That instant must not appear anywhere here.
    expect(occurrences.map((occurrence) => occurrence.startsAt)).not.toContain(
      '2025-04-25T07:00:00Z',
    );
  });

  it('preserves the local hour and moves the offset across the fall-back', () => {
    const occurrences = resolveOccurrences(fridayMorning, {
      fromLocalDate: '2025-10-24',
      count: 3,
    });

    // Clocks go back late on Thursday 30 October, so Friday 31 October is already +02:00.
    // 09:00 − 03:00 = 06:00Z, then 09:00 − 02:00 = 07:00Z.
    expect(occurrences).toEqual([
      {
        localDate: '2025-10-24',
        startTimeLocal: '09:00:00',
        timezone: CAIRO,
        startsAt: '2025-10-24T06:00:00Z',
        endsAt: '2025-10-24T07:00:00Z',
        utcOffsetMinutes: EEST,
        disambiguation: 'exact',
      },
      {
        localDate: '2025-10-31',
        startTimeLocal: '09:00:00',
        timezone: CAIRO,
        startsAt: '2025-10-31T07:00:00Z',
        endsAt: '2025-10-31T08:00:00Z',
        utcOffsetMinutes: EET,
        disambiguation: 'exact',
      },
      {
        localDate: '2025-11-07',
        startTimeLocal: '09:00:00',
        timezone: CAIRO,
        startsAt: '2025-11-07T07:00:00Z',
        endsAt: '2025-11-07T08:00:00Z',
        utcOffsetMinutes: EET,
        disambiguation: 'exact',
      },
    ]);

    expect(occurrences.map((occurrence) => occurrence.startTimeLocal)).toEqual([
      '09:00:00',
      '09:00:00',
      '09:00:00',
    ]);
    expect(occurrences.map((occurrence) => occurrence.utcOffsetMinutes)).toEqual([EEST, EET, EET]);

    // Adding 7 × 24h to the first instant yields 2025-10-31T06:00:00Z, which is 08:00 in Cairo —
    // the lesson an hour early, with the teacher absent.
    expect(occurrences.map((occurrence) => occurrence.startsAt)).not.toContain(
      '2025-10-31T06:00:00Z',
    );
  });
});

describe('T029 Cairo gap and overlap (FR-019, R-TIME-7)', () => {
  it('shifts a local time that does not exist forward past the gap', () => {
    // 2025-04-25 00:30 in Cairo never happens: 00:00 (+02:00) becomes 01:00 (+03:00). Shifting
    // forward by the length of the gap gives 01:30 (+03:00), which is 2025-04-24T22:30:00Z.
    const resolved = resolveLocalDateTime({
      localDate: '2025-04-25',
      localTime: '00:30:00',
      timezone: CAIRO,
    });

    expect(resolved).toEqual({
      localDate: '2025-04-25',
      startTimeLocal: '01:30:00',
      timezone: CAIRO,
      startsAt: '2025-04-24T22:30:00Z',
      utcOffsetMinutes: EEST,
      disambiguation: 'shifted_forward',
    });
  });

  it('takes the first of a local time that happens twice', () => {
    // 2025-10-30 23:30 in Cairo happens twice: once at +03:00 (2025-10-30T20:30:00Z) and again an
    // hour later at +02:00 (2025-10-30T21:30:00Z). FR-019 takes the first.
    const resolved = resolveLocalDateTime({
      localDate: '2025-10-30',
      localTime: '23:30:00',
      timezone: CAIRO,
    });

    expect(resolved).toEqual({
      localDate: '2025-10-30',
      startTimeLocal: '23:30:00',
      timezone: CAIRO,
      startsAt: '2025-10-30T20:30:00Z',
      utcOffsetMinutes: EEST,
      disambiguation: 'first_of_two',
    });
    expect(resolved.startsAt).not.toBe('2025-10-30T21:30:00Z');
  });
});
