// T030: branded money type. A `unique symbol` declared here and never exported makes
// plain numbers and piasters mutually unassignable (FR-012, research R-3).
// Money values are package prices and the gross/fee/net a gateway reports on a payment record (ADR 0007).
// There is no wallet, ledger, balance or share splitting; the platform never holds money. Every value was constructed here.
declare const piastersBrand: unique symbol;

export type Piasters = number & { readonly [piastersBrand]: true };

// The package exposes no `add`, `subtract`, `multiply` or `split`. R-MONEY-5 makes this the only
// legal place for piaster arithmetic, and under ADR 0007 the domain has none to do: a teacher sets
// `packages.price_piasters`, an enrollment snapshots it, and the gateway reports gross, fee and net
// (`net = gross − fee`, "as reported, never computed here" — ERD §7). Share splitting and the
// rounding remainder that needed it are retired (FR-015, DEC-14). An operation added before a task
// names the requirement that needs it is an invitation for feature code to do money maths.

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

function refusalReason(value: number): string {
  if (Number.isNaN(value)) return 'not a number';
  if (!Number.isFinite(value)) return 'not finite';
  if (!Number.isInteger(value))
    return 'not an integer; money is integer piasters, never a fraction';
  if (!Number.isSafeInteger(value))
    return 'beyond Number.MAX_SAFE_INTEGER, so not exactly representable';
  return 'negative; there is no money column that can go below zero';
}
