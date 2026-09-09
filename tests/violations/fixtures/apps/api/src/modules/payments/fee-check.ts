// T023 fixture — VIOLATION of R-MONEY-5: arithmetic on branded money values outside
// `packages/money`. Every operand is named with the suffix and typed with the brand, so the only
// prohibition left is the arithmetic itself, which is what makes the rule type-aware: `a - b`
// looks identical whatever the operands are (research R-3, R-10).
// Refused by money/no-arithmetic-outside-package.
import type { Piasters } from '@ijazah/money';

export function isFeeWithinGross(gross_piasters: Piasters, fee_piasters: Piasters): boolean {
  return gross_piasters - fee_piasters > 0;
}
