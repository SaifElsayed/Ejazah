// T023 fixture — VIOLATION of R-MONEY-2: an identifier whose resolved type carries the money
// brand but whose name lacks the `_piasters` suffix. The suffix is what makes a money value
// visible at every call site; `price` alone reads as any other number.
// No arithmetic happens here, so `money/no-arithmetic-outside-package` (R-MONEY-5) stays silent.
// Refused by money/require-piaster-suffix.
import type { Piasters } from '@ijazah/money';

export function packagePriceLabel(price: Piasters): string {
  return String(price);
}
