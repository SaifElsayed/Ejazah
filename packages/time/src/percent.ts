// B35, T013's threshold (FR-443; research R-305; the owner's decision of 2026-11-08 on the
// magic-number gate, R-MONEY-12): a percent of a length in whole seconds. The conversion lives here,
// outside the gate's root (`apps/api/src/modules`), as the gate's head asks of a unit conversion, so
// the attendance rules write no `100`.
//
// Rounded up to the next whole second, as `evaluateAttendance` rounds its threshold: a percent
// reached only by a fraction of a second asks for that whole second.
import { TimeError } from './index.js';

/** What a percent is a part of. */
const PERCENT = 100;

/** `pct` percent of `seconds` whole seconds, a fraction rounded up to the next whole second. */
export function percentOfSeconds(seconds: number, pct: number): number {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new TimeError('seconds', String(seconds), 'not a whole, non-negative number of seconds');
  }
  if (!Number.isFinite(pct) || pct < 0) {
    throw new TimeError('percent', String(pct), 'not a finite, non-negative percent');
  }
  return Math.ceil((pct * seconds) / PERCENT);
}
