// T021 (FR-311, R-MONEY-1): the package editor's two typed numbers. The price is typed in pounds,
// with at most two decimals, and sent in whole piasters (the price's only conversion, done on the
// typed digits so no float ever holds an amount); the count is a whole number of one to 52. The
// digits and decimal mark an Arabic keyboard types are read as the Western ones. 006:T002 (B-P1
// Q-B1 (a)): the pounds' reading and writing are `packages/money`'s (`piastersOfPoundsText`,
// `poundsText`), shared with the panel; the price's «above zero» stays here.
import { MAX_SESSION_COUNT } from '@ijazah/contracts';
import { type Piasters, piastersOfPoundsText, poundsText, toPlainNumber } from '@ijazah/money';

const WHOLE = /^\d+$/;

/** `text` with Arabic-Indic and Persian digits as Western ones and «٫» as the decimal point. */
function western(text: string): string {
  return text
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace('٫', '.');
}

/** The price typed in pounds as piasters, or null while it is not a price above zero. */
export function piastersOfPounds(text: string): Piasters | null {
  const amount_piasters = piastersOfPoundsText(text);
  return amount_piasters !== null && toPlainNumber(amount_piasters) > 0 ? amount_piasters : null;
}

/** A price as the editor shows it to be edited: «1200», «1200.50», no grouping. */
export function poundsOf(amount_piasters: Piasters): string {
  return poundsText(amount_piasters);
}

/** The count typed, or null while it is not a whole number of one to 52 (FR-311). */
export function sessionCountOf(text: string): number | null {
  const typed = western(text);
  if (!WHOLE.test(typed)) return null;
  const count = Number(typed);
  return count >= 1 && count <= MAX_SESSION_COUNT ? count : null;
}
