// T033: per-occurrence recurrence resolution. Each occurrence is resolved from its own local date and
// the slot's local time in the teacher's zone, never by adding intervals (FR-018, R-TIME-2).
// Nonexistent local time shifts forward; ambiguous local time takes the first (FR-019, R-TIME-7).
import { Temporal } from '@js-temporal/polyfill';

import {
  assertLocalDate,
  resolveLocalDateTime,
  TimeError,
  type DayOfWeek,
  type LocalDate,
  type Occurrence,
  type RecurringSlot,
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
    const resolved = resolveLocalDateTime({
      localDate: anchor.add({ weeks: week }).toString(),
      localTime: slot.startTimeLocal,
      timezone: slot.timezone,
    });
    occurrences.push({
      ...resolved,
      endsAt: addElapsedMinutes(resolved.startsAt, durationMinutes),
    });
  }
  return occurrences;
}
