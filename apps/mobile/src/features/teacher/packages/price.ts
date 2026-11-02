// T021 (FR-311, R-MONEY-1): the package editor's two typed numbers. The price is typed in pounds,
// with at most two decimals, and sent in whole piasters (the price's only conversion, done on the
// typed digits so no float ever holds an amount); the count is a whole number of one to 52. The
// digits and decimal mark an Arabic keyboard types are read as the Western ones.
import { MAX_SESSION_COUNT } from '@ijazah/contracts';
import { isPiasters, type Piasters, piasters, toPlainNumber } from '@ijazah/money';

const PIASTERS_PER_POUND = 100;
const POUNDS = /^(\d+)(?:\.(\d{1,2}))?$/;
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
  const match = POUNDS.exec(western(text));
  if (match === null) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const count = whole * PIASTERS_PER_POUND + fraction;
  return isPiasters(count) && count > 0 ? piasters(count) : null;
}

/** A price as the editor shows it to be edited: «1200», «1200.50», no grouping. */
export function poundsOf(amount_piasters: Piasters): string {
  const count = toPlainNumber(amount_piasters);
  const fraction = count % PIASTERS_PER_POUND;
  const whole = (count - fraction) / PIASTERS_PER_POUND;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}

/** The count typed, or null while it is not a whole number of one to 52 (FR-311). */
export function sessionCountOf(text: string): number | null {
  const typed = western(text);
  if (!WHOLE.test(typed)) return null;
  const count = Number(typed);
  return count >= 1 && count <= MAX_SESSION_COUNT ? count : null;
}
