// T030: branded money type. A `unique symbol` declared here and never exported makes
// plain numbers and piasters mutually unassignable (FR-012, research R-3).
// Money values are package prices, the gross/fee/net a gateway reports on a payment record (ADR 0007),
// and the teacher's share of an order (ADR 0025). There is no wallet, ledger or balance; the platform
// never holds money. Every value was constructed here.
declare const piastersBrand: unique symbol;

export type Piasters = number & { readonly [piastersBrand]: true };

// The package exposes no `add`, `subtract`, `multiply` or `split`. R-MONEY-5 makes this the only
// legal place for piaster arithmetic, and under ADR 0007 the domain has none to do: a teacher sets
// `packages.price_piasters`, an enrollment snapshots it, and the gateway reports gross, fee and net
// (`net = gross − fee`, "as reported, never computed here" — ERD §7). Share splitting and the
// rounding remainder that needed it are retired (FR-015, DEC-14). An operation added before a task
// names the requirement that needs it is an invitation for feature code to do money maths.
// T009: FR-337 names the first, `perSession`, the price per session a card and a profile show
// (research R-212). It is for display only: nothing stores or charges it, the gateway charges the
// package price. `lowest` picks one of the amounts it is given and computes none.
// T104 (ADR 0025 D1, SRS DEC-80, amending ADR 0007 D1's 0% commission) names `teacherShare`: the
// teacher's share of an order, sent to the gateway as the split and kept on the order. T113 (SRS
// DEC-88) names `average`: the package editor's average price per session of other teachers'
// packages, for display only. 003:T102 (SRS DEC-82, ADR 0025 D3; the owner's «موافق (أ)» of
// 2026-11-18) names `refundedTotal`: an order's refunded total after one more refund, refused past
// the order's amount.

/**
 * Refusal of a value that is not a piaster amount. Named so a caller can identify it without
 * matching on message text, the same shape as the kernel's `ConfigError`.
 */
export class MoneyError extends Error {
  readonly offendingValue: number;

  constructor(offendingValue: number, detail: string) {
    super(
      `Not a piaster amount (FR-012, R-MONEY-1): ${detail} — received ${String(offendingValue)}`,
    );
    this.name = 'MoneyError';
    this.offendingValue = offendingValue;
  }
}

/**
 * Whether a plain number is a piaster amount: a non-negative safe integer.
 *
 * Non-negative because the only money the model holds is a price, its snapshot, and the gateway's
 * gross, fee and net — none of which is ever a debt (ERD §15 rule 36: `price_piasters` > 0). There is no
 * balance to go negative, by construction (ADR 0007).
 *
 * `Number.isSafeInteger` is the whole integer test in one call: it refuses NaN, both infinities,
 * every fractional value, and anything past `Number.MAX_SAFE_INTEGER`. That last one matters because
 * the ERD's money columns are `bigint` — wider than a JS number is exact — so a value the database
 * could hold but JavaScript could not represent exactly is refused at the boundary rather than
 * silently rounded into a wrong amount.
 */
export function isPiasters(value: number): value is Piasters {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * The constructor. Throws rather than returning a result type: every call site is either a
 * validated boundary (a zod schema has already checked the shape, so a throw here is a programming
 * error, not a user error) or a database row (a column that failed this test is corrupt data and
 * must stop the request loudly). The kernel maps a thrown domain error to one response shape
 * (R-API-8); a result type would have every caller re-deciding what to do, and a caller that wants
 * to decide for itself asks `isPiasters` first.
 */
export function piasters(value: number): Piasters {
  if (!isPiasters(value)) {
    throw new MoneyError(value, refusalReason(value));
  }

  // The one place the brand is minted (research R-3). The assertion is the technique itself, not an
  // escape hatch: the brand exists only in the type system, so no runtime value can carry it.
  // `-0` is a real value on the wire (`JSON.parse('-0')`) and stores as `0`; normalising it here
  // keeps two equal amounts from disagreeing under `Object.is`.
  return (Object.is(value, -0) ? 0 : value) as Piasters;
}

/**
 * Unwrap for a serialisation boundary — the wire and the database both hold a plain integer, which
 * is exactly why research R-3 rejected a wrapper class.
 *
 * This does not weaken FR-012. A branded intersection widens to `number` on its own; the type
 * system cannot stop that in either this function or a caller. What FR-012 buys is the other
 * direction — a plain number can never become money without passing `piasters` — and FR-072 closes
 * the remaining gap outside the type system, by refusing at build time any declared money position
 * annotated as `number`. This function's value is that the widening has one named, greppable call
 * site instead of happening silently wherever a `Piasters` meets a `number` parameter.
 */
export function toPlainNumber(amount_piasters: Piasters): number {
  return amount_piasters;
}

/**
 * A package's price per session, rounded half up to the piaster (T009, FR-337, R-212): 100 over 3
 * is 33, 3 over 2 is 2.
 *
 * Integers only, so no quotient is ever a float (R-MONEY-1). `%` of two safe integers is exact,
 * the remainder taken off leaves a multiple of the count, and the division of that multiple is
 * exact too; a rounded `total / count` is not, at the top of the safe range. Half up is the
 * remainder's comparison with the half: twice the remainder at least the count.
 *
 * A count below one or not whole is refused: `packages.session_count >= 1` (ERD §15 rule 36), so
 * such a count is a programming error, not a price.
 */
export function perSession(total_piasters: Piasters, sessionCount: number): Piasters {
  if (!Number.isSafeInteger(sessionCount) || sessionCount < 1) {
    throw new RangeError(
      `perSession: the session count must be a whole number of at least one — received ${String(sessionCount)}`,
    );
  }
  const remainder = total_piasters % sessionCount;
  const whole = (total_piasters - remainder) / sessionCount;
  return piasters(remainder * 2 >= sessionCount ? whole + 1 : whole);
}

/**
 * The teacher's share of an order's price at `ratePercent` (T104, ADR 0025 D1, SRS DEC-80): the
 * price times the rate, **rounded up** to the piaster, so the teacher's net share is never short of
 * the rate (the review session's decision of 2026-11-16). 1001 at 70% is 701; 1 at 70% is 1.
 *
 * Exact in `bigint`: a price near the top of the safe range times a rate passes it, where a
 * floating product would not be exact. The share never exceeds the price, so it converts back to a
 * safe integer.
 *
 * The rate is a whole percent from 0 to 100 (SRS §3.14); anything else is a programming error, not
 * a share, and is refused.
 */
export function teacherShare(price_piasters: Piasters, ratePercent: number): Piasters {
  if (!Number.isSafeInteger(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    throw new RangeError(
      `teacherShare: the rate must be a whole percent from 0 to 100 — received ${String(ratePercent)}`,
    );
  }
  const product = BigInt(price_piasters) * BigInt(ratePercent);
  const whole = product / 100n;
  return piasters(Number(product % 100n === 0n ? whole : whole + 1n));
}

/**
 * The lowest of `amounts_piasters` (T009, FR-335: a card's lowest price per session). The list is
 * non-empty by type, since an empty one has no lowest amount; one that reaches here empty anyway
 * is refused rather than answered with a made-up amount.
 */
export function lowest(amounts_piasters: readonly [Piasters, ...Piasters[]]): Piasters {
  if (amounts_piasters.length === 0) {
    throw new RangeError('lowest: an empty list has no lowest amount');
  }
  const [first_piasters, ...rest] = amounts_piasters;
  let lowest_piasters = first_piasters;
  for (const amount_piasters of rest) {
    if (amount_piasters < lowest_piasters) lowest_piasters = amount_piasters;
  }
  return lowest_piasters;
}

/**
 * The mean of `amounts_piasters`, rounded half up to the piaster (T113, SRS DEC-88: the package
 * editor's average price per session of other teachers' packages; FR-337's rounding). Exact in
 * `bigint`, since a sum of safe integers may pass the safe range; the mean of safe integers is one.
 * The list is non-empty by type; one that reaches here empty anyway is refused.
 */
export function average(amounts_piasters: readonly [Piasters, ...Piasters[]]): Piasters {
  if (amounts_piasters.length === 0) {
    throw new RangeError('average: an empty list has no average');
  }
  const count = BigInt(amounts_piasters.length);
  const sum = amounts_piasters.reduce(
    (total, amount_piasters) => total + BigInt(amount_piasters),
    0n,
  );
  const whole = sum / count;
  return piasters(Number((sum % count) * 2n >= count ? whole + 1n : whole));
}

/** A refund that would take an order's refunded total past its gross (003:T102, DEC-82). */
export class RefundPastGrossError extends Error {
  constructor(
    readonly total_piasters: Piasters,
    readonly refund_piasters: Piasters,
    readonly order_piasters: Piasters,
  ) {
    super(
      `refundedTotal: a refund of ${String(refund_piasters)} on a refunded total of ` +
        `${String(total_piasters)} passes the order's ${String(order_piasters)}`,
    );
    this.name = 'RefundPastGrossError';
  }
}

/**
 * An order's refunded total after one more refund (003:T102, ADR 0025 D3, SRS DEC-82): the total
 * plus the refund, which the caller compares with the order's amount (`order_piasters`, its gross)
 * to learn whether the whole order is refunded. A sum past the order's amount is refused with
 * `RefundPastGrossError`, so nothing is recorded (ERD §15 rule 61 holds it in the database too).
 * Exact in `bigint`, so a sum past the safe range is compared, never rounded.
 */
export function refundedTotal(
  total_piasters: Piasters,
  refund_piasters: Piasters,
  order_piasters: Piasters,
): Piasters {
  const sum = BigInt(total_piasters) + BigInt(refund_piasters);
  if (sum > BigInt(order_piasters)) {
    throw new RefundPastGrossError(total_piasters, refund_piasters, order_piasters);
  }
  return piasters(Number(sum));
}

function refusalReason(value: number): string {
  if (Number.isNaN(value)) return 'not a number';
  if (!Number.isFinite(value)) return 'not finite';
  if (!Number.isInteger(value))
    return 'not an integer; money is integer piasters, never a fraction';
  if (!Number.isSafeInteger(value))
    return 'beyond Number.MAX_SAFE_INTEGER, so not exactly representable';
  return 'negative; there is no money column that can go below zero';
}
