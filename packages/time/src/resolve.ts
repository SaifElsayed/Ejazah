// T033: per-occurrence recurrence resolution. Each occurrence is resolved from its own local date and
// the slot's local time in the teacher's zone, never by adding intervals (FR-018, R-TIME-2).
// Nonexistent local time shifts forward; ambiguous local time takes the first (FR-019, R-TIME-7).
// T007: each occurrence also carries what was asked for, and `firstOccurrenceAfter` finds the
// first occurrence at least a lead after an instant (R-209, FR-368). T019: `weeklyIntervalIn`, a
// slot as another zone reads it in the week of a save (R-206).
import { Temporal } from '@js-temporal/polyfill';

import type { WeeklyInterval } from './calendar.js';
import {
  assertLocalDate,
  localDateIn,
  resolveLocalDateTime,
  TimeError,
  type DayOfWeek,
  type LocalDate,
  type Occurrence,
  type RecurringSlot,
  type TimeZoneId,
  type UtcInstant,
} from './index.js';

const DAYS_IN_WEEK = 7;

function assertDayOfWeek(value: number): DayOfWeek {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new TimeError('dayOfWeek', String(value), 'expected 0–6, with 0 = Sunday (Postgres DOW)');
  }
  return value as DayOfWeek;
}

/**
 * A lesson lasts a whole number of minutes and lasts at all: `duration_minutes` is an `int` column
 * and a session of zero or negative length is not a session. Refused rather than clamped, because a
 * silent zero would write a `sessions` row whose end is its start.
 */
function assertDurationMinutes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TimeError('durationMinutes', String(value), 'expected a whole number of minutes ≥ 1');
  }
  return value;
}

/**
 * Refused rather than answered with an empty list. The caller of this function is session
 * generation for a paid enrollment (FR-BOOK-5); a zero that quietly produced no sessions would be
 * exactly the kind of state that looks successful and is not.
 */
function assertCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TimeError('count', String(value), 'expected a whole number of occurrences ≥ 1');
  }
  return value;
}

/** The earliest `dayOfWeek` on or after `fromLocalDate`, as a local date and nothing more. */
function firstOnOrAfter(fromLocalDate: LocalDate, dayOfWeek: DayOfWeek): Temporal.PlainDate {
  const from = Temporal.PlainDate.from(assertLocalDate('fromLocalDate', fromLocalDate));
  // Temporal counts Monday 1 … Sunday 7; the ERD counts Sunday 0 … Saturday 6, matching Postgres
  // `EXTRACT(DOW)`, which is what a query will eventually compare `day_of_week` against.
  const fromDayOfWeek = from.dayOfWeek % DAYS_IN_WEEK;
  return from.add({ days: (dayOfWeek - fromDayOfWeek + DAYS_IN_WEEK) % DAYS_IN_WEEK });
}

/**
 * Elapsed time added to an instant, which is the one addition R-TIME-2 does not forbid: a lesson's
 * length is a duration, not a calendar step, so an hour is an hour whatever the clocks do under it.
 */
function addElapsedMinutes(startsAt: UtcInstant, minutes: number): UtcInstant {
  return Temporal.Instant.from(startsAt).add({ minutes }).toString({ smallestUnit: 'second' });
}

/**
 * `count` occurrences of `slot`, the first being the earliest `slot.dayOfWeek` on or after
 * `fromLocalDate` (FR-018, R-TIME-2).
 *
 * The loop below is the rule. Every occurrence's local date comes from the anchor plus that many
 * calendar weeks — a step taken on a wall calendar, where a week is seven days by definition — and
 * is then resolved on its own, from that date and the slot's local time in the slot's zone. No
 * iteration reads the instant, the offset or the date of the one before it, so nothing an earlier
 * occurrence resolved to can propagate into a later one. Advancing the *instant* by 7 × 24h is the
 * bug this shape exists to make unwritable: across Egypt's April transition it moves a 09:00 lesson
 * to 10:00 and leaves it there for good.
 */
export function resolveOccurrences(
  slot: RecurringSlot,
  options: { readonly fromLocalDate: LocalDate; readonly count: number },
): readonly Occurrence[] {
  const dayOfWeek = assertDayOfWeek(slot.dayOfWeek);
  const durationMinutes = assertDurationMinutes(slot.durationMinutes);
  const count = assertCount(options.count);
  const anchor = firstOnOrAfter(options.fromLocalDate, dayOfWeek);

  const occurrences: Occurrence[] = [];
  for (let week = 0; week < count; week += 1) {
    const requestedLocalDate = anchor.add({ weeks: week }).toString();
    const resolved = resolveLocalDateTime({
      localDate: requestedLocalDate,
      localTime: slot.startTimeLocal,
      timezone: slot.timezone,
    });
    occurrences.push({
      ...resolved,
      endsAt: addElapsedMinutes(resolved.startsAt, durationMinutes),
      requestedLocalDate,
      requestedStartTimeLocal: slot.startTimeLocal,
    });
  }
  return occurrences;
}

/** A lead is a whole number of hours, zero included (the setting `first_session_lead_hours`). */
function assertLeadHours(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TimeError('leadHours', String(value), 'expected a whole number of hours ≥ 0');
  }
  return value;
}

/**
 * The first occurrence of `slot` whose resolved start is at least `leadHours` after `instant`
 * (T007, R-209, FR-368: the first session after a confirmation, and the date a student is shown
 * before paying).
 *
 * The lead is elapsed time, so it is added to the instant; the slot's weeks are not. The candidates
 * are the slot's day on or after the local date the lead ends on, and the week after it, each
 * resolved from its own local date by `resolveOccurrences`; the first whose resolved instant is not
 * before the lead's end is the answer. Comparing instants, never wall clocks, is what makes a Friday
 * 00:30 that a gap moves to 01:30, or a Thursday 23:30 that happens twice, count as the instant it
 * resolves to (R-TIME-7). The second candidate always qualifies: it starts six days or more after
 * the lead's end.
 */
export function firstOccurrenceAfter(
  slot: RecurringSlot,
  instant: Date,
  leadHours: number,
): Occurrence {
  const epochMilliseconds = instant.getTime();
  if (Number.isNaN(epochMilliseconds)) {
    throw new TimeError('instant', String(instant), 'not an instant');
  }
  const notBefore = Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).add({
    hours: assertLeadHours(leadHours),
  });
  const fromLocalDate = localDateIn(new Date(notBefore.epochMilliseconds), slot.timezone);
  const [candidate, weekAfter] = resolveOccurrences(slot, { fromLocalDate, count: 2 });
  if (candidate === undefined || weekAfter === undefined) {
    throw new Error('resolveOccurrences returned fewer occurrences than asked for');
  }
  return Temporal.Instant.compare(Temporal.Instant.from(candidate.startsAt), notBefore) >= 0
    ? candidate
    : weekAfter;
}

/**
 * `slot` as `timezone` reads it in the week `weekOf` falls in there (T019, R-206, FR-317): the
 * teacher's slots of two zones are compared in the newer slot's zone for the week of the save, so
 * `weeklyIntervalsOverlap` (`./calendar.ts`) reads both in one zone. The week runs Sunday to
 * Saturday in `timezone`; the slot's occurrence that week is resolved in its own zone from that
 * week's local date (`resolveOccurrences`), and the instant is read on `timezone`'s clock. A slot of
 * `timezone` itself is answered as it is: one zone compares wall clocks, whatever a gap does to one
 * week's occurrence.
 */
export function weeklyIntervalIn(
  slot: WeeklyInterval & { readonly timezone: TimeZoneId },
  timezone: TimeZoneId,
  weekOf: Date,
): WeeklyInterval {
  const dayOfWeek = assertDayOfWeek(slot.dayOfWeek);
  const { startTimeLocal, durationMinutes } = slot;
  const today = Temporal.PlainDate.from(localDateIn(weekOf, timezone));
  if (slot.timezone === timezone) return { dayOfWeek, startTimeLocal, durationMinutes };
  const sunday = today.subtract({ days: today.dayOfWeek % DAYS_IN_WEEK });
  const [occurrence] = resolveOccurrences(
    { dayOfWeek, startTimeLocal, durationMinutes, timezone: slot.timezone },
    { fromLocalDate: sunday.toString(), count: 1 },
  );
  if (occurrence === undefined) throw new Error('resolveOccurrences returned no occurrence');
  const there = Temporal.Instant.from(occurrence.startsAt).toZonedDateTimeISO(timezone);
  return {
    dayOfWeek: there.dayOfWeek % DAYS_IN_WEEK,
    startTimeLocal: there.toPlainTime().toString({ smallestUnit: 'second' }),
    durationMinutes,
  };
}
