// T003 (research R-305, R-TIME-1): the interval operations the attendance rules (T013) are built on.
// Examples first, one per rule the owner decided on 2026-11-06 (a normaliser, whole seconds by
// flooring, half-open, touching intervals merged, zero length dropped, an inverted interval or
// bound refused); then fast-check properties: no operation depends on the order of its intervals
// or on a duplicate, `clip` never reaches past its bounds, and every measure is the count of the
// distinct seconds covered, checked against a brute-force oracle over a small range.
//
// Seeds are fixed (3003 and up), so a run is reproducible; a failure prints its seed and path.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  clip,
  intersect,
  intervalsOf,
  measureSeconds,
  TimeError,
  union,
  type Interval,
} from './index.js';

const BASE = Date.parse('2026-11-08T17:00:00Z');
const MILLISECONDS_PER_SECOND = 1_000;

/** An interval `from` to `to` seconds after BASE; fractions of a second allowed. */
function span(from: number, to: number): Interval {
  return {
    startsAt: new Date(BASE + from * MILLISECONDS_PER_SECOND),
    endsAt: new Date(BASE + to * MILLISECONDS_PER_SECOND),
  };
}

/** The intervals as `[from, to]` seconds after BASE, so a failure reads as numbers. */
function seconds(intervals: readonly Interval[]): [number, number][] {
  return intervals.map((interval) => [
    (interval.startsAt.getTime() - BASE) / MILLISECONDS_PER_SECOND,
    (interval.endsAt.getTime() - BASE) / MILLISECONDS_PER_SECOND,
  ]);
}

describe('intervalsOf', () => {
  it('returns nothing for nothing', () => {
    expect(intervalsOf([])).toEqual([]);
  });

  it('floors both ends to the second', () => {
    expect(seconds(intervalsOf([span(10.999, 20.999)]))).toEqual([[10, 20]]);
  });

  it('drops an interval of zero length, and one that floors to zero length', () => {
    expect(intervalsOf([span(10, 10)])).toEqual([]);
    expect(intervalsOf([span(10.2, 10.9)])).toEqual([]);
  });

  it('sorts by start', () => {
    expect(seconds(intervalsOf([span(50, 60), span(10, 20)]))).toEqual([
      [10, 20],
      [50, 60],
    ]);
  });

  it('merges overlapping intervals and one inside another', () => {
    expect(seconds(intervalsOf([span(10, 30), span(20, 40), span(22, 25)]))).toEqual([[10, 40]]);
  });

  it('merges touching half-open intervals: [a, b) and [b, c) become [a, c)', () => {
    expect(seconds(intervalsOf([span(10, 20), span(20, 30)]))).toEqual([[10, 30]]);
  });

  it('keeps intervals a second apart separate', () => {
    expect(seconds(intervalsOf([span(10, 20), span(21, 30)]))).toEqual([
      [10, 20],
      [21, 30],
    ]);
  });

  it('merges intervals that touch only once floored', () => {
    expect(seconds(intervalsOf([span(10, 20.6), span(20.1, 30)]))).toEqual([[10, 30]]);
  });

  it('hands back new Date objects, never the caller’s', () => {
    const given = span(10, 20);
    const [result] = intervalsOf([given]);
    expect(result?.startsAt).not.toBe(given.startsAt);
    expect(result?.endsAt).not.toBe(given.endsAt);
  });
});

describe('union', () => {
  it('counts a reconnection overlapping its old connection once (R-305 step 2)', () => {
    expect(seconds(union([span(0, 600), span(590, 1_200)]))).toEqual([[0, 1_200]]);
  });

  it('is the canonical set of its intervals', () => {
    const connections = [span(300, 400.5), span(0.7, 100), span(100, 150), span(500, 500)];
    expect(union(connections)).toEqual(intervalsOf(connections));
  });
});

describe('intersect', () => {
  it('keeps the time both sets cover (R-305 step 4)', () => {
    const student = [span(0, 600), span(900, 3_600)];
    const teacher = [span(300, 1_000), span(1_500, 2_000)];
    expect(seconds(intersect(student, teacher))).toEqual([
      [300, 600],
      [900, 1_000],
      [1_500, 2_000],
    ]);
  });

  it('finds nothing between intervals that only touch, being half-open', () => {
    expect(intersect([span(0, 10)], [span(10, 20)])).toEqual([]);
  });

  it('finds nothing with an empty set', () => {
    expect(intersect([span(0, 10)], [])).toEqual([]);
    expect(intersect([], [span(0, 10)])).toEqual([]);
  });

  it('merges what its intersection touches into one interval', () => {
    expect(seconds(intersect([span(0, 10), span(10, 20)], [span(5, 15)]))).toEqual([[5, 15]]);
  });
});

describe('clip', () => {
  it('trims the intervals crossing a bound and drops those outside', () => {
    const intervals = [span(-100, -50), span(-10, 10), span(20, 30), span(50, 120), span(200, 300)];
    expect(seconds(clip(intervals, span(0, 100)))).toEqual([
      [0, 10],
      [20, 30],
      [50, 100],
    ]);
  });

  it('floors the bounds as it floors an interval', () => {
    expect(seconds(clip([span(0, 200)], span(10.8, 100.8)))).toEqual([[10, 100]]);
  });

  it('keeps nothing within bounds of zero length', () => {
    expect(clip([span(0, 200)], span(50, 50))).toEqual([]);
  });
});

describe('measureSeconds', () => {
  it('measures nothing as zero', () => {
    expect(measureSeconds([])).toBe(0);
  });

  it('sums disjoint intervals', () => {
    expect(measureSeconds([span(0, 10), span(20, 25)])).toBe(15);
  });

  it('counts an overlap and a duplicate once, uniting before it sums', () => {
    expect(measureSeconds([span(0, 10), span(5, 15), span(0, 10)])).toBe(15);
  });

  it('measures whole seconds, floored at both ends', () => {
    expect(measureSeconds([span(0.9, 10.9)])).toBe(10);
  });
});

describe('a disconnect and a reconnection (SC-402, R-SESS-4)', () => {
  it('yields the sum of the overlaps within the scheduled window', () => {
    // A one-hour session. The student drops at 10:00 and is back at 15:00, on a new connection
    // that the provider reported before the old one's leave; the teacher stays from 00:30 to 60:30.
    const window = span(0, 3_600);
    const student = union([span(-120, 600), span(900, 3_700)]);
    const teacher = union([span(30, 3_630)]);
    const together = clip(intersect(student, teacher), window);
    expect(seconds(together)).toEqual([
      [30, 600],
      [900, 3_600],
    ]);
    expect(measureSeconds(together)).toBe(570 + 2_700);
  });
});

describe('refusals', () => {
  it('refuses an interval that ends before it starts', () => {
    expect(() => intervalsOf([span(20, 10)])).toThrow(TimeError);
    expect(() => intervalsOf([span(10.7, 10.2)])).toThrow(TimeError);
    try {
      intervalsOf([span(20, 10)]);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(TimeError);
      expect((error as TimeError).offendingField).toBe('endsAt');
    }
  });

  it('refuses an instant that is not one', () => {
    const invalid = new Date(Number.NaN);
    expect(() => intervalsOf([{ startsAt: invalid, endsAt: new Date(BASE) }])).toThrow(TimeError);
    expect(() => intervalsOf([{ startsAt: new Date(BASE), endsAt: invalid }])).toThrow(TimeError);
  });

  it('refuses an inverted interval in every operation', () => {
    const inverted = [span(20, 10)];
    expect(() => union(inverted)).toThrow(TimeError);
    expect(() => intersect(inverted, [span(0, 30)])).toThrow(TimeError);
    expect(() => intersect([span(0, 30)], inverted)).toThrow(TimeError);
    expect(() => clip(inverted, span(0, 30))).toThrow(TimeError);
    expect(() => measureSeconds(inverted)).toThrow(TimeError);
  });

  it('refuses inverted clip bounds, naming them', () => {
    try {
      clip([span(0, 30)], span(20, 10));
      expect.unreachable('clip accepted inverted bounds');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(TimeError);
      expect((error as TimeError).offendingField).toBe('bounds.endsAt');
    }
  });

  it('refuses clip bounds that are not instants', () => {
    const bounds = { startsAt: new Date(Number.NaN), endsAt: new Date(BASE) };
    expect(() => clip([span(0, 30)], bounds)).toThrow(TimeError);
  });
});

// ---------------------------------------------------------------------------------------------
// Properties. Instants within a 200-second range at millisecond precision, so intervals overlap,
// touch and repeat often, fractions of a second come up, and the oracle can count every second.

const RANGE_SECONDS = 200;
const RANGE_MILLISECONDS = RANGE_SECONDS * MILLISECONDS_PER_SECOND;
const MAX_LENGTH_MILLISECONDS = 60 * MILLISECONDS_PER_SECOND;
const NUM_RUNS = 500;

const intervalArbitrary: fc.Arbitrary<Interval> = fc
  .tuple(
    fc.integer({ min: 0, max: RANGE_MILLISECONDS }),
    fc.integer({ min: 0, max: MAX_LENGTH_MILLISECONDS }),
  )
  .map(([start, length]) => ({
    startsAt: new Date(BASE + start),
    endsAt: new Date(BASE + start + length),
  }));

const setArbitrary = fc.array(intervalArbitrary, { maxLength: 12 });

/** The intervals and the same intervals in another order. */
const permutedArbitrary = setArbitrary.chain((intervals) =>
  fc.tuple(
    fc.constant(intervals),
    fc.shuffledSubarray(intervals, { minLength: intervals.length, maxLength: intervals.length }),
  ),
);

/** The intervals and the same intervals with one of them repeated, inserted anywhere. */
const duplicatedArbitrary = fc
  .array(intervalArbitrary, { minLength: 1, maxLength: 12 })
  .chain((intervals) =>
    fc
      .tuple(fc.nat({ max: intervals.length - 1 }), fc.nat({ max: intervals.length }))
      .map(([which, where]) => {
        const repeated = intervals[which] as Interval;
        const copy = { startsAt: new Date(repeated.startsAt), endsAt: new Date(repeated.endsAt) };
        return [
          intervals,
          [...intervals.slice(0, where), copy, ...intervals.slice(where)],
        ] as const;
      }),
  );

/** The whole seconds `intervals` cover, by brute force: second s is covered by [⌊a⌋, ⌊b⌋) when ⌊a⌋ ≤ s < ⌊b⌋. */
function coveredSeconds(intervals: readonly Interval[]): Set<number> {
  const covered = new Set<number>();
  for (const interval of intervals) {
    const from = Math.floor((interval.startsAt.getTime() - BASE) / MILLISECONDS_PER_SECOND);
    const to = Math.floor((interval.endsAt.getTime() - BASE) / MILLISECONDS_PER_SECOND);
    for (let second = from; second < to; second += 1) covered.add(second);
  }
  return covered;
}

function bothCover(a: Set<number>, b: Set<number>): Set<number> {
  return new Set([...a].filter((second) => b.has(second)));
}

function settings(seed: number) {
  return { seed, numRuns: NUM_RUNS };
}

describe('properties', () => {
  it('intervalsOf returns the canonical set: whole seconds, sorted, non-empty, apart', () => {
    fc.assert(
      fc.property(setArbitrary, (intervals) => {
        const result = intervalsOf(intervals);
        result.forEach((interval, index) => {
          expect(interval.startsAt.getTime() % MILLISECONDS_PER_SECOND).toBe(0);
          expect(interval.endsAt.getTime() % MILLISECONDS_PER_SECOND).toBe(0);
          expect(interval.endsAt.getTime()).toBeGreaterThan(interval.startsAt.getTime());
          const next = result[index + 1];
          if (next !== undefined) {
            expect(next.startsAt.getTime()).toBeGreaterThan(interval.endsAt.getTime());
          }
        });
      }),
      settings(3003),
    );
  });

  it('no operation depends on the order of its intervals', () => {
    fc.assert(
      fc.property(permutedArbitrary, permutedArbitrary, intervalArbitrary, (a, b, bounds) => {
        const [given, reordered] = a;
        const [other, otherReordered] = b;
        expect(intervalsOf(reordered)).toEqual(intervalsOf(given));
        expect(union(reordered)).toEqual(union(given));
        expect(intersect(reordered, otherReordered)).toEqual(intersect(given, other));
        expect(clip(reordered, bounds)).toEqual(clip(given, bounds));
        expect(measureSeconds(reordered)).toBe(measureSeconds(given));
      }),
      settings(3004),
    );
  });

  it('no operation depends on a duplicate', () => {
    fc.assert(
      fc.property(duplicatedArbitrary, duplicatedArbitrary, intervalArbitrary, (a, b, bounds) => {
        const [given, withDuplicate] = a;
        const [other, otherWithDuplicate] = b;
        expect(intervalsOf(withDuplicate)).toEqual(intervalsOf(given));
        expect(union(withDuplicate)).toEqual(union(given));
        expect(intersect(withDuplicate, otherWithDuplicate)).toEqual(intersect(given, other));
        expect(clip(withDuplicate, bounds)).toEqual(clip(given, bounds));
        expect(measureSeconds(withDuplicate)).toBe(measureSeconds(given));
      }),
      settings(3005),
    );
  });

  it('clip never reaches past its bounds, nor measures more than the bounds or the input', () => {
    fc.assert(
      fc.property(setArbitrary, intervalArbitrary, (intervals, bounds) => {
        const result = clip(intervals, bounds);
        // The bounds floored, as every instant here is (the owner's decision 3).
        const lower =
          Math.floor(bounds.startsAt.getTime() / MILLISECONDS_PER_SECOND) * MILLISECONDS_PER_SECOND;
        const upper =
          Math.floor(bounds.endsAt.getTime() / MILLISECONDS_PER_SECOND) * MILLISECONDS_PER_SECOND;
        for (const interval of result) {
          expect(interval.startsAt.getTime()).toBeGreaterThanOrEqual(lower);
          expect(interval.endsAt.getTime()).toBeLessThanOrEqual(upper);
        }
        expect(measureSeconds(result)).toBeLessThanOrEqual(measureSeconds([bounds]));
        expect(measureSeconds(result)).toBeLessThanOrEqual(measureSeconds(intervals));
      }),
      settings(3006),
    );
  });

  it('every measure is the count of distinct seconds covered (the oracle)', () => {
    fc.assert(
      fc.property(setArbitrary, setArbitrary, intervalArbitrary, (a, b, bounds) => {
        const coveredA = coveredSeconds(a);
        expect(measureSeconds(a)).toBe(coveredA.size);
        expect(measureSeconds(union(a))).toBe(coveredA.size);
        expect(coveredSeconds(union(a))).toEqual(coveredA);
        const together = bothCover(coveredA, coveredSeconds(b));
        expect(coveredSeconds(intersect(a, b))).toEqual(together);
        expect(measureSeconds(intersect(a, b))).toBe(together.size);
        expect(coveredSeconds(clip(a, bounds))).toEqual(
          bothCover(coveredA, coveredSeconds([bounds])),
        );
      }),
      settings(3007),
    );
  });
});
