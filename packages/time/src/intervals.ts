// T003 (research R-305, R-TIME-1): the interval operations the attendance rules (T013) are built on.
// Instant arithmetic lives in this package, so the sessions module unites, intersects, clips and
// measures connected time through these five and never subtracts a Date itself. No Temporal: an
// interval is two instants compared and floored, which plain epoch milliseconds do exactly.
//
// The owner's decisions of 2026-11-06: half-open `[startsAt, endsAt)`; whole seconds, both ends
// floored, as `addSeconds` and `unixSeconds` drop a fraction; every result the canonical set
// (sorted, each of positive length, overlapping and touching intervals merged), so no operation
// depends on the order of its intervals or on a duplicate; a zero-length interval dropped; an
// inverted interval or inverted bounds refused.
import { TimeError } from './index.js';

/**
 * A stretch of time, `[startsAt, endsAt)`: it holds `startsAt` and stops just before `endsAt`.
 * Instants as `Date`, in and out, because this package already takes an instant as a `Date`
 * (`addSeconds`, `unixSeconds`) and the provider's event instants arrive as one from a
 * `timestamptz` column; a result's `Date` objects are always new, never the caller's.
 */
export interface Interval {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

const MILLISECONDS_PER_SECOND = 1_000;

/** An interval as whole epoch seconds, both ends floored. */
interface SecondSpan {
  readonly start: number;
  readonly end: number;
}

function epochMillisecondsOf(field: string, at: Date): number {
  const epochMilliseconds = at.getTime();
  if (Number.isNaN(epochMilliseconds)) throw new TimeError(field, String(at), 'not an instant');
  return epochMilliseconds;
}

/**
 * The interval in whole seconds, or a `TimeError` naming `field` when an end is not an instant or
 * comes before its start. An end before its start is refused on the instants as given, before any
 * flooring, so a fraction cannot turn a reversed pair into an empty one.
 */
function secondSpanOf(interval: Interval, field: string): SecondSpan {
  const start = epochMillisecondsOf(`${field}startsAt`, interval.startsAt);
  const end = epochMillisecondsOf(`${field}endsAt`, interval.endsAt);
  if (end < start) {
    throw new TimeError(
      `${field}endsAt`,
      interval.endsAt.toISOString(),
      `before its startsAt ${interval.startsAt.toISOString()}`,
    );
  }
  return {
    start: Math.floor(start / MILLISECONDS_PER_SECOND),
    end: Math.floor(end / MILLISECONDS_PER_SECOND),
  };
}

/** The canonical set: zero lengths dropped, sorted, overlapping and touching spans merged. */
function canonicalSpans(intervals: readonly Interval[]): SecondSpan[] {
  const spans = intervals
    .map((interval) => secondSpanOf(interval, ''))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    // Half-open: `[a, b)` and `[b, c)` leave no second between them, so they are one interval.
    if (last !== undefined && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ start: span.start, end: span.end });
  }
  return merged;
}

function intervalsFrom(spans: readonly SecondSpan[]): Interval[] {
  return spans.map((span) => ({
    startsAt: new Date(span.start * MILLISECONDS_PER_SECOND),
    endsAt: new Date(span.end * MILLISECONDS_PER_SECOND),
  }));
}

/** The time both canonical sets cover, itself canonical; a sweep over the two sorted lists. */
function intersectSpans(a: readonly SecondSpan[], b: readonly SecondSpan[]): SecondSpan[] {
  const both: { start: number; end: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a[i] as SecondSpan;
    const right = b[j] as SecondSpan;
    const start = Math.max(left.start, right.start);
    const end = Math.min(left.end, right.end);
    if (end > start) {
      // Within one canonical set the spans are apart, so pieces never touch; kept merged anyway.
      const last = both.at(-1);
      if (last !== undefined && start <= last.end) last.end = Math.max(last.end, end);
      else both.push({ start, end });
    }
    if (left.end <= right.end) i += 1;
    else j += 1;
  }
  return both;
}

/**
 * The canonical set of `intervals`: each floored to the second at both ends, a zero-length one
 * dropped, sorted by start, overlapping and touching ones merged. A `TimeError` when an end is not
 * an instant or comes before its start.
 */
export function intervalsOf(intervals: readonly Interval[]): Interval[] {
  return intervalsFrom(canonicalSpans(intervals));
}

/**
 * The time any of `intervals` covers, as a canonical set (R-305 step 2: a participant's
 * connections, a reconnection overlapping the old connection counted once).
 */
export function union(intervals: readonly Interval[]): Interval[] {
  return intervalsOf(intervals);
}

/**
 * The time both `a` and `b` cover, as a canonical set (R-305 step 4: the intersection of the two
 * participants' unions). Either set may be given in any order and with repeats.
 */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  return intervalsFrom(intersectSpans(canonicalSpans(a), canonicalSpans(b)));
}

/**
 * The part of `intervals` within `bounds`, as a canonical set: nothing before the bounds' start
 * and nothing at or after their end (FR-443: only between the scheduled start and end). The bounds
 * are floored as an interval is; inverted bounds are a `TimeError` naming `bounds`.
 */
export function clip(intervals: readonly Interval[], bounds: Interval): Interval[] {
  const window = secondSpanOf(bounds, 'bounds.');
  const windows = window.end > window.start ? [window] : [];
  return intervalsFrom(intersectSpans(canonicalSpans(intervals), windows));
}

/**
 * The whole seconds `intervals` cover, each second counted once however many intervals hold it:
 * the intervals are united before they are summed (SC-402: the sum of the overlaps).
 */
export function measureSeconds(intervals: readonly Interval[]): number {
  return canonicalSpans(intervals).reduce((total, span) => total + span.end - span.start, 0);
}
