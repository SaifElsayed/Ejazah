// T023 fixture — VIOLATION of R-MONEY-1: a declared money position typed as a plain `number`.
// The branded type is the guarantee; annotating the position `number` sidesteps it, which is
// why the linter has to refuse what the compiler can no longer catch (FR-072).
// The file sits inside `modules/payments`, where money-carrying records are legal, so
// `boundaries/no-money-vocabulary` (R-MONEY-6) has nothing to say about it.
// Refused by money/no-number-in-money-position.
export interface PackagePrice {
  readonly price_piasters: number;
}

export function packagePrice(price_piasters: number): PackagePrice {
  return { price_piasters };
}
