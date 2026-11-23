// 006:T007 (FR-705; R-506, R-507; analyze K-5): an offer's amounts, as payments' entry hands them to
// booking. The arithmetic is `packages/money`'s (R-MONEY-5); booking computes no amount and imports
// nothing of payments (ARCHITECTURE §4's arrows, R-208), so `main.ts` hands this function to
// booking's programme services, as `CatalogUse` is handed to catalog.
import { type Piasters, type ProgrammeOfferAmounts, programmeOfferAmounts } from '@ijazah/money';

export type { ProgrammeOfferAmounts };

/**
 * The offer's total (the count × the package's price for the offer's length), that price, and its
 * months (⌈the count ÷ 4⌉), `packages/money`'s `programmeOfferAmounts`.
 */
export function programmeOfferAmountsOf(
  sessionPrice_piasters: Piasters,
  sessionCount: number,
): ProgrammeOfferAmounts {
  return programmeOfferAmounts(sessionPrice_piasters, sessionCount);
}
