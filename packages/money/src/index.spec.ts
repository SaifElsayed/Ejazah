import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  average,
  dropoutParts,
  isPiasters,
  lowest,
  perSession,
  piasters,
  piastersOfPoundsText,
  poundsText,
  RefundPastGrossError,
  refundedTotal,
  sessionValues,
  shareLeft,
  shareOfSessions,
  sumOf,
  teacherShare,
  toPlainNumber,
  type Piasters,
  untakenValue,
} from './index.js';

// `..` then `src` on purpose, so this resolves the same whether the spec runs from `src/` (root
// Vitest) or from the compiled copy in `dist/` (the package's own Vitest config).
const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts');

// True only when A and B are the same type. Two conditional types are mutually assignable only if
// their checked types are identical, which is what makes this stricter than assignability.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('piasters (T030, FR-012)', () => {
  it('accepts the amounts the ERD money columns actually hold', () => {
    expect(toPlainNumber(piasters(0))).toBe(0);
    expect(toPlainNumber(piasters(1))).toBe(1);
    // A plausible `packages.price_piasters`: EGP 1,500.00.
    expect(toPlainNumber(piasters(150_000))).toBe(150_000);
    expect(toPlainNumber(piasters(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses a fraction, because money is integer piasters and never a decimal (R-MONEY-1)', () => {
    expect(() => piasters(1.5)).toThrow(MoneyError);
    expect(() => piasters(0.1)).toThrow(MoneyError);
    expect(() => piasters(-0.5)).toThrow(MoneyError);
  });

  it('refuses a negative amount, because no money column can go below zero (ERD §7)', () => {
    expect(() => piasters(-1)).toThrow(MoneyError);
    expect(() => piasters(Number.MIN_SAFE_INTEGER)).toThrow(MoneyError);
  });

  it('refuses NaN and both infinities', () => {
    expect(() => piasters(Number.NaN)).toThrow(MoneyError);
    expect(() => piasters(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => piasters(Number.NEGATIVE_INFINITY)).toThrow(MoneyError);
  });

  it('refuses an integer past the exact range, because the columns are wider than a JS number', () => {
    expect(() => piasters(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(() => piasters(1e21)).toThrow(MoneyError);
  });

  it('normalises negative zero, which the wire can produce and the database stores as zero', () => {
    const zero_piasters = piasters(-0);

    expect(Object.is(toPlainNumber(zero_piasters), 0)).toBe(true);
    expect(Object.is(toPlainNumber(zero_piasters), -0)).toBe(false);
  });

  it('names the rule and the reason it refused, and carries the offending value', () => {
    let failure: unknown;
    try {
      piasters(12.5);
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(MoneyError);
    const refusal = failure as MoneyError;
    expect(refusal.name).toBe('MoneyError');
    expect(refusal.message).toContain('R-MONEY-1');
    expect(refusal.message).toContain('not an integer');
    expect(refusal.offendingValue).toBe(12.5);
  });
});

describe('isPiasters (T030)', () => {
  it('agrees with the constructor on every case the constructor decides', () => {
    const accepted = [0, 1, 150_000, Number.MAX_SAFE_INTEGER];
    const refused = [
      1.5,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ];

    for (const value of accepted) {
      expect(isPiasters(value)).toBe(true);
      expect(() => piasters(value)).not.toThrow();
    }

    for (const value of refused) {
      expect(isPiasters(value)).toBe(false);
      expect(() => piasters(value)).toThrow(MoneyError);
    }
  });

  it('narrows, so a checked number reaches a money position without a cast', () => {
    const candidate: number = 4_200;

    expect(isPiasters(candidate)).toBe(true);
    if (isPiasters(candidate)) {
      // Assignable only because the guard narrowed it; the line below the guard would not compile.
      const price_piasters: Piasters = candidate;
      expect(toPlainNumber(price_piasters)).toBe(4_200);
    }
  });
});

describe('perSession (T009, FR-337, R-212)', () => {
  it('divides a package price evenly over its sessions', () => {
    expect(toPlainNumber(perSession(piasters(120_000), 8))).toBe(15_000);
    expect(toPlainNumber(perSession(piasters(150_000), 1))).toBe(150_000);
    expect(toPlainNumber(perSession(piasters(0), 4))).toBe(0);
  });

  it('rounds a remainder below half a piaster down', () => {
    // 100 / 3 = 33.33…, 149 / 100 = 1.49.
    expect(toPlainNumber(perSession(piasters(100), 3))).toBe(33);
    expect(toPlainNumber(perSession(piasters(149), 100))).toBe(1);
  });

  it('rounds exactly half a piaster up', () => {
    // 1 / 2 = 0.5, 3 / 2 = 1.5, 150 / 100 = 1.5, 250 / 4 = 62.5: each is the tie R-212 names.
    expect(toPlainNumber(perSession(piasters(1), 2))).toBe(1);
    expect(toPlainNumber(perSession(piasters(3), 2))).toBe(2);
    expect(toPlainNumber(perSession(piasters(150), 100))).toBe(2);
    expect(toPlainNumber(perSession(piasters(250), 4))).toBe(63);
  });

  it('rounds a remainder above half a piaster up', () => {
    // 200 / 3 = 66.67, 151 / 100 = 1.51.
    expect(toPlainNumber(perSession(piasters(200), 3))).toBe(67);
    expect(toPlainNumber(perSession(piasters(151), 100))).toBe(2);
  });

  it('stays exact at the top of the safe range, where a floating division would not', () => {
    const total = Number.MAX_SAFE_INTEGER;
    for (const count of [2, 3, 7, 1_000_003]) {
      const quotient = BigInt(total) / BigInt(count);
      const remainder = BigInt(total) % BigInt(count);
      const expected = remainder * 2n >= BigInt(count) ? quotient + 1n : quotient;
      expect(BigInt(toPlainNumber(perSession(piasters(total), count)))).toBe(expected);
    }
  });

  it('returns an amount of its own brand, so it reaches a money position without a cast', () => {
    const per_session_piasters: Piasters = perSession(piasters(9_999), 4);

    expect(isPiasters(per_session_piasters)).toBe(true);
    expect(toPlainNumber(per_session_piasters)).toBe(2_500);
  });

  it('refuses a session count that is not a whole number of at least one (ERD §15 rule 36)', () => {
    for (const count of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => perSession(piasters(100), count)).toThrow(RangeError);
      expect(() => perSession(piasters(100), count)).toThrow(/perSession/);
    }
  });
});

describe('teacherShare (T104, ADR 0025 D1, SRS DEC-80)', () => {
  it('takes the rate of the price when it divides evenly', () => {
    expect(toPlainNumber(teacherShare(piasters(100_000), 70))).toBe(70_000);
    expect(toPlainNumber(teacherShare(piasters(1_000), 70))).toBe(700);
  });

  it('rounds a fraction of a piaster up, never down', () => {
    // 1001 × 70% = 700.7, 1 × 70% = 0.7, 999 × 33% = 329.67, 101 × 1% = 1.01.
    expect(toPlainNumber(teacherShare(piasters(1_001), 70))).toBe(701);
    expect(toPlainNumber(teacherShare(piasters(1), 70))).toBe(1);
    expect(toPlainNumber(teacherShare(piasters(999), 33))).toBe(330);
    expect(toPlainNumber(teacherShare(piasters(101), 1))).toBe(2);
  });

  it('gives nothing at 0% and the whole price at 100%', () => {
    expect(toPlainNumber(teacherShare(piasters(25_000), 0))).toBe(0);
    expect(toPlainNumber(teacherShare(piasters(25_000), 100))).toBe(25_000);
  });

  it('stays exact at the top of the safe range, where a floating product would not', () => {
    const price = Number.MAX_SAFE_INTEGER;
    for (const rate of [1, 33, 70, 99]) {
      const product = BigInt(price) * BigInt(rate);
      const expected = product / 100n + (product % 100n === 0n ? 0n : 1n);
      expect(BigInt(toPlainNumber(teacherShare(piasters(price), rate)))).toBe(expected);
    }
  });

  it('returns an amount of its own brand, never above the price', () => {
    const share_piasters: Piasters = teacherShare(piasters(9_999), 70);

    expect(isPiasters(share_piasters)).toBe(true);
    expect(toPlainNumber(share_piasters)).toBe(7_000);
    expect(toPlainNumber(share_piasters)).toBeLessThanOrEqual(9_999);
  });

  it('refuses a rate that is not a whole percent from 0 to 100 (SRS §3.14)', () => {
    for (const rate of [-1, 101, 70.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => teacherShare(piasters(100), rate)).toThrow(RangeError);
      expect(() => teacherShare(piasters(100), rate)).toThrow(/teacherShare/);
    }
  });
});

describe('refundedTotal (003:T102, ADR 0025 D3, SRS DEC-82)', () => {
  it('adds a refund to the order’s refunded total', () => {
    expect(toPlainNumber(refundedTotal(piasters(0), piasters(7_500), piasters(25_000)))).toBe(
      7_500,
    );
    expect(toPlainNumber(refundedTotal(piasters(7_500), piasters(5_000), piasters(25_000)))).toBe(
      12_500,
    );
  });

  it('reaches the gross exactly, which the caller reads as the whole order refunded', () => {
    expect(toPlainNumber(refundedTotal(piasters(10_000), piasters(15_000), piasters(25_000)))).toBe(
      25_000,
    );
  });

  it('refuses a refund that would pass the gross, naming the three amounts', () => {
    const refusal = (() => {
      try {
        refundedTotal(piasters(20_000), piasters(5_001), piasters(25_000));
      } catch (error: unknown) {
        return error;
      }
      return undefined;
    })();

    expect(refusal).toBeInstanceOf(RefundPastGrossError);
    expect(refusal).toMatchObject({
      name: 'RefundPastGrossError',
      total_piasters: 20_000,
      refund_piasters: 5_001,
      order_piasters: 25_000,
    });
  });

  it('stays exact at the top of the safe range, and refuses a sum past it as past the gross', () => {
    const top_piasters = piasters(Number.MAX_SAFE_INTEGER);
    expect(
      toPlainNumber(
        refundedTotal(piasters(Number.MAX_SAFE_INTEGER - 1), piasters(1), top_piasters),
      ),
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => refundedTotal(top_piasters, piasters(1), top_piasters)).toThrow(
      RefundPastGrossError,
    );
  });
});

const plain = (amounts: readonly Piasters[]): number[] => amounts.map(toPlainNumber);

describe('sessionValues (003:T105, ADR 0025 D2, D4)', () => {
  it('gives each session the total ÷ the count, the last taking the remainder', () => {
    expect(plain(sessionValues(piasters(1_000), 3))).toEqual([333, 333, 334]);
    expect(plain(sessionValues(piasters(10), 4))).toEqual([2, 2, 2, 4]);
    expect(plain(sessionValues(piasters(7_000), 10))).toEqual([
      700, 700, 700, 700, 700, 700, 700, 700, 700, 700,
    ]);
  });

  it('gives one session the whole total, and none of nothing', () => {
    expect(plain(sessionValues(piasters(25_000), 1))).toEqual([25_000]);
    expect(plain(sessionValues(piasters(0), 2))).toEqual([0, 0]);
  });

  it('sums back to the total exactly, at the top of the safe range too', () => {
    for (const [total, count] of [
      [1_001, 7],
      [Number.MAX_SAFE_INTEGER, 52],
      [Number.MAX_SAFE_INTEGER, 3],
    ] as const) {
      const values = sessionValues(piasters(total), count);
      expect(values).toHaveLength(count);
      expect(values.reduce((sum, value_piasters) => sum + BigInt(value_piasters), 0n)).toBe(
        BigInt(total),
      );
    }
  });

  it('refuses a count below one or not whole (ERD §15 rule 36)', () => {
    for (const count of [0, -1, 1.5, Number.NaN]) {
      expect(() => sessionValues(piasters(100), count)).toThrow(RangeError);
      expect(() => sessionValues(piasters(100), count)).toThrow(/sessionValues/);
    }
  });
});

describe('shareOfSessions (003:T105, ADR 0025 D2)', () => {
  it('sums the values of the sessions named by their sequence numbers', () => {
    expect(toPlainNumber(shareOfSessions(piasters(1_000), 3, [1, 2]))).toBe(666);
    expect(toPlainNumber(shareOfSessions(piasters(1_000), 3, [3]))).toBe(334);
    expect(toPlainNumber(shareOfSessions(piasters(1_000), 3, [1, 2, 3]))).toBe(1_000);
  });

  it('counts a sequence number named twice once', () => {
    expect(toPlainNumber(shareOfSessions(piasters(1_000), 3, [3, 3]))).toBe(334);
  });

  it('gives nothing for no session', () => {
    expect(toPlainNumber(shareOfSessions(piasters(1_000), 3, []))).toBe(0);
  });

  it('gives no value to a sequence number past the count (as written; Q-B1-4)', () => {
    expect(toPlainNumber(shareOfSessions(piasters(7_000), 10, [11]))).toBe(0);
    expect(toPlainNumber(shareOfSessions(piasters(7_000), 10, [1, 11, 0]))).toBe(700);
  });
});

describe('shareLeft (003:T105, ADR 0025 D2)', () => {
  it('is the share less what was released (the ijazah end as written)', () => {
    expect(toPlainNumber(shareLeft(piasters(7_000), [piasters(1_750)], piasters(0)))).toBe(5_250);
  });

  it('is the whole share when nothing was released or taken off (the recitation end)', () => {
    expect(toPlainNumber(shareLeft(piasters(7_000), [], piasters(0)))).toBe(7_000);
  });

  it('takes off what it is given too (Q-B1-1 (a): the teacher’s share of a refund)', () => {
    expect(toPlainNumber(shareLeft(piasters(7_000), [piasters(1_750)], piasters(701)))).toBe(4_549);
  });

  it('never goes below nothing', () => {
    expect(toPlainNumber(shareLeft(piasters(7_000), [piasters(7_000)], piasters(701)))).toBe(0);
    expect(
      toPlainNumber(shareLeft(piasters(7_000), [piasters(5_000), piasters(5_000)], piasters(0))),
    ).toBe(0);
  });
});

describe('sumOf (003:T105: the payouts page’s totals)', () => {
  it('adds the amounts, and none is nothing', () => {
    expect(toPlainNumber(sumOf([piasters(1), piasters(2), piasters(3)]))).toBe(6);
    expect(toPlainNumber(sumOf([]))).toBe(0);
  });

  it('refuses a sum past the safe range rather than rounding it', () => {
    expect(() => sumOf([piasters(Number.MAX_SAFE_INTEGER), piasters(1)])).toThrow(MoneyError);
  });
});

describe('untakenValue (003:T110, ADR 0025 D4: the sessions refunded at a close)', () => {
  it('is the value of the sessions not named: 10,000 over 10, four taken, is 6,000', () => {
    expect(toPlainNumber(untakenValue(piasters(10_000), 10, [1, 2, 3, 4]))).toBe(6_000);
  });

  it('gives the last session the remainder, as sessionValues does', () => {
    expect(toPlainNumber(untakenValue(piasters(1_000), 3, [1, 2]))).toBe(334);
    expect(toPlainNumber(untakenValue(piasters(1_000), 3, [3]))).toBe(666);
  });

  it('is the whole amount when none was taken, and nothing when all were', () => {
    expect(toPlainNumber(untakenValue(piasters(10_000), 10, []))).toBe(10_000);
    expect(toPlainNumber(untakenValue(piasters(1_000), 3, [1, 2, 3]))).toBe(0);
  });

  it('counts a sequence number named twice once', () => {
    expect(toPlainNumber(untakenValue(piasters(1_000), 3, [1, 1]))).toBe(667);
  });

  it('takes nothing for a sequence number outside 1 to the count', () => {
    expect(toPlainNumber(untakenValue(piasters(1_000), 3, [0, 4, 11, 1.5]))).toBe(1_000);
  });
});

describe('dropoutParts (003:T110, ADR 0025 D4, SRS DEC-85: an ijazah teacher’s dropout)', () => {
  it('splits 10,000 paid into 5,250 held + 3,000 the platform’s part + 1,750 released', () => {
    const parts = dropoutParts(
      [{ paid_piasters: piasters(10_000), share_piasters: piasters(7_000) }],
      [piasters(1_750)],
    );
    expect(parts).toEqual({
      total_piasters: 10_000,
      held_piasters: 5_250,
      platformPart_piasters: 3_000,
      released_piasters: 1_750,
    });
  });

  it('takes every order of the enrollment, the assessment fee’s included', () => {
    const parts = dropoutParts(
      [
        { paid_piasters: piasters(10_000), share_piasters: piasters(7_000) },
        { paid_piasters: piasters(2_001), share_piasters: piasters(1_401) },
      ],
      [piasters(1_750)],
    );
    expect(parts).toEqual({
      total_piasters: 12_001,
      held_piasters: 6_651,
      platformPart_piasters: 3_600,
      released_piasters: 1_750,
    });
  });

  it('holds the whole share when nothing was released', () => {
    expect(
      dropoutParts([{ paid_piasters: piasters(10_000), share_piasters: piasters(7_000) }], []),
    ).toEqual({
      total_piasters: 10_000,
      held_piasters: 7_000,
      platformPart_piasters: 3_000,
      released_piasters: 0,
    });
  });

  it('never holds below nothing', () => {
    expect(
      dropoutParts(
        [{ paid_piasters: piasters(1_000), share_piasters: piasters(700) }],
        [piasters(500), piasters(500)],
      ).held_piasters,
    ).toBe(0);
  });

  it('refuses a total past the safe range rather than rounding it', () => {
    expect(() =>
      dropoutParts(
        [
          { paid_piasters: piasters(Number.MAX_SAFE_INTEGER), share_piasters: piasters(0) },
          { paid_piasters: piasters(1), share_piasters: piasters(0) },
        ],
        [],
      ),
    ).toThrow(MoneyError);
  });
});

describe('average (T113, SRS DEC-88)', () => {
  it('averages amounts that divide evenly, and one amount is itself', () => {
    expect(toPlainNumber(average([piasters(100), piasters(200), piasters(300)]))).toBe(200);
    expect(toPlainNumber(average([piasters(15_000)]))).toBe(15_000);
  });

  it('rounds half a piaster up, less than half down', () => {
    // 1.5 → 2, 1.33… → 1, 1.67 → 2.
    expect(toPlainNumber(average([piasters(1), piasters(2)]))).toBe(2);
    expect(toPlainNumber(average([piasters(1), piasters(1), piasters(2)]))).toBe(1);
    expect(toPlainNumber(average([piasters(1), piasters(2), piasters(2)]))).toBe(2);
  });

  it('stays exact at the top of the safe range, where a floating sum would not', () => {
    const top = Number.MAX_SAFE_INTEGER;
    const sum = BigInt(top) + BigInt(top - 1) + BigInt(top - 4);
    const quotient = sum / 3n;
    const expected = (sum % 3n) * 2n >= 3n ? quotient + 1n : quotient;
    expect(
      BigInt(toPlainNumber(average([piasters(top), piasters(top - 1), piasters(top - 4)]))),
    ).toBe(expected);
  });

  it('refuses an empty list, which has no average', () => {
    expect(() => average([] as unknown as [Piasters])).toThrow(RangeError);
    expect(() => average([] as unknown as [Piasters])).toThrow(/average/);
  });
});

// 006:T002 (B-P1 Q-B1 (a), Q-6, the owner's «تظهر جنيه فقط»): an amount typed in pounds, read as
// whole piasters on its digits (never through a float), and written back as the pounds a field
// shows. Moved here from the phone's package editor (`apps/mobile/src/features/teacher/packages/
// price.ts`), which keeps its own «above zero» rule; the panel's settings page reads the
// assessment's fee with it, where 0 is «unset».
describe('piastersOfPoundsText (006:T002, Q-B1)', () => {
  it('reads whole pounds and up to two decimals as whole piasters', () => {
    expect(piastersOfPoundsText('200')).toBe(20_000);
    expect(piastersOfPoundsText('150')).toBe(15_000);
    expect(piastersOfPoundsText('150.5')).toBe(15_050);
    expect(piastersOfPoundsText(' 0.05 ')).toBe(5);
  });

  it('reads the digits and the decimal mark an Arabic keyboard types', () => {
    expect(piastersOfPoundsText('١٢٠٠٫٥٠')).toBe(120_050);
    expect(piastersOfPoundsText('۲۰۰')).toBe(20_000);
  });

  it('reads zero as zero piasters', () => {
    expect(piastersOfPoundsText('0')).toBe(0);
    expect(piastersOfPoundsText('0.00')).toBe(0);
  });

  it('refuses a third decimal', () => {
    expect(piastersOfPoundsText('150.555')).toBeNull();
    expect(piastersOfPoundsText('1.234')).toBeNull();
  });

  it('refuses a sign, grouping and anything not a number', () => {
    for (const text of ['', '-5', '+5', '1,200', '12a', '.5', '5.', 'مئتان']) {
      expect(piastersOfPoundsText(text)).toBeNull();
    }
  });

  it('refuses an amount past the safe range rather than rounding it', () => {
    expect(piastersOfPoundsText('900719925474099.93')).toBeNull();
  });
});

describe('poundsText (006:T002, Q-B1)', () => {
  it('writes piasters as the pounds a field shows: whole, or with two decimals', () => {
    expect(poundsText(piasters(20_000))).toBe('200');
    expect(poundsText(piasters(120_050))).toBe('1200.50');
    expect(poundsText(piasters(5))).toBe('0.05');
    expect(poundsText(piasters(0))).toBe('0');
  });

  it('reads back what it writes', () => {
    for (const amount of [0, 5, 15_050, 120_000, 99_999_999]) {
      expect(piastersOfPoundsText(poundsText(piasters(amount)))).toBe(amount);
    }
  });
});

describe('lowest (T009, FR-335, R-212)', () => {
  it('picks the lowest of the amounts, whatever their order', () => {
    expect(toPlainNumber(lowest([piasters(300), piasters(100), piasters(200)]))).toBe(100);
    expect(toPlainNumber(lowest([piasters(100), piasters(300)]))).toBe(100);
    expect(toPlainNumber(lowest([piasters(300), piasters(0)]))).toBe(0);
    expect(toPlainNumber(lowest([piasters(250), piasters(250)]))).toBe(250);
  });

  it('returns the one amount of a list of one', () => {
    expect(toPlainNumber(lowest([piasters(15_000)]))).toBe(15_000);
  });

  it('refuses an empty list, which has no lowest amount, at compile time and at run time', () => {
    // @ts-expect-error T009: an empty list is not a non-empty list of amounts.
    expect(() => lowest([])).toThrow(RangeError);

    const none: Piasters[] = [];
    expect(() => lowest(none as unknown as [Piasters])).toThrow(/lowest/);
  });
});

// The assertions below are checked by `pnpm typecheck`, not by running this file. `@ts-expect-error`
// is an assertion rather than a suppression: it fails the build when the line it guards *compiles*,
// so a refactor that exports the brand or aliases `Piasters` to `number` turns each one red instead
// of passing silently (T030, FR-012, research R-3).
describe('the brand makes a number and a piaster amount non-interchangeable (FR-012, FR-072)', () => {
  it('refuses a plain number where money is expected, in every position', () => {
    // @ts-expect-error T030/FR-012: a plain number is not assignable to Piasters.
    const from_literal_piasters: Piasters = 150_000;

    const plain: number = 150_000;
    // @ts-expect-error T030/FR-012: nor is a number-typed value, however it was obtained.
    const from_variable_piasters: Piasters = plain;

    // @ts-expect-error T030/FR-012: nor in an argument position.
    const unwrapped = toPlainNumber(150_000);

    expect([from_literal_piasters, from_variable_piasters, unwrapped]).toHaveLength(3);
  });

  it('is a distinct type from number, so aliasing it away fails the build', () => {
    const distinct: Equals<Piasters, number> = false;

    // @ts-expect-error T030/FR-012: if `Piasters` were ever `type Piasters = number`, `Equals`
    // would resolve to `true`, this line would compile, and this assertion would fail.
    const aliased: Equals<Piasters, number> = true;

    expect(distinct).toBe(false);
    // Widened on purpose: the declared type is `false`, the runtime value is `true`, and the gap
    // between them is exactly what the suppressed error above is asserting.
    expect<boolean>(aliased).toBe(true);
  });

  it('refuses a money consumer where a number consumer is expected', () => {
    // The contravariant half of FR-012: a branded intersection widens to `number` at a value
    // position by design — that is what keeps serialisation free (research R-3 rejected a wrapper
    // class for exactly this) — but a function that demands money can never stand in for one that
    // accepts any number, because that substitution would hand it an unconstructed amount.
    function consumeMoney(amount_piasters: Piasters): number {
      return toPlainNumber(amount_piasters);
    }

    // @ts-expect-error T030/FR-012: `number` is not assignable to `Piasters` in the parameter.
    const consumeNumber: (value: number) => number = consumeMoney;

    expect(consumeNumber(piasters(7))).toBe(7);
  });
});

// Exporting the brand moves nothing in the type system, so these read `index.ts` as a syntax tree.
// The tree makes them indifferent to formatting, comments and a rename of the symbol.
describe('the brand stays private to index.ts, which is the only thing holding FR-012 up', () => {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  function collect<T extends ts.Node>(test: (node: ts.Node) => node is T): T[] {
    const found: T[] = [];
    const visit = (node: ts.Node): void => {
      if (test(node)) found.push(node);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  }

  function isUniqueSymbolDeclaration(
    node: ts.Node,
  ): node is ts.VariableDeclaration & { name: ts.Identifier } {
    return (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.type !== undefined &&
      ts.isTypeOperatorNode(node.type) &&
      node.type.operator === ts.SyntaxKind.UniqueKeyword
    );
  }

  function theBrand(): ts.VariableDeclaration & { name: ts.Identifier } {
    const found = collect(isUniqueSymbolDeclaration);
    const [brand] = found;
    if (found.length !== 1 || brand === undefined) {
      throw new Error(
        `index.ts must declare exactly one \`unique symbol\` brand, found ${found.length}. The declaration is missing or duplicated; this is not an export.`,
      );
    }
    return brand;
  }

  function where(node: ts.Node): string {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return `line ${line + 1}: ${node.parent.getText(sourceFile)}`;
  }

  it('is declared exactly once, as a unique symbol', () => {
    expect(theBrand().name.text).not.toBe('');
  });

  it('is never exported, and never used except as a computed property key', () => {
    const declaration = theBrand();
    const brand = declaration.name.text;
    const statement = declaration.parent.parent;
    const exported = (
      ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    )?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

    // The one legal use is the key in `{ readonly [brand]: true }`. Any other reference — an export
    // list, `export default`, `typeof` in an exported type, an alias exported later — is a way for
    // code outside this file to mint a `Piasters` without the constructor.
    const leaks = collect(
      (node): node is ts.Identifier =>
        ts.isIdentifier(node) &&
        node.text === brand &&
        node !== declaration.name &&
        !ts.isComputedPropertyName(node.parent),
    ).map(where);
    if (exported === true) leaks.unshift(where(declaration.name));

    expect(leaks, `the brand "${brand}" escapes index.ts`).toEqual([]);
  });
});
