// T019 of specs/004-sessions (FR-435; research R-316; the note under T019, Q4, and its R-325
// arithmetic): when a lost room is asked of `sessions.join` again. A dropped connection is the SDK's
// to rejoin; a room the SDK gave up on is asked again after 2, 4, 8 and 16 s, then every 30 s, so
// the worst minute after a loss holds six joins, under the signed-in default's 150 per 60 s. The
// numbers are named constants on the phone (R-MONEY-12 as amended, constitution 2.6.1: the phone
// reads no setting before it connects). A final refusal ends the tries; anything else (no answer, a
// throttle, a failure of the server) is tried again.

/** The waits before the first four tries after a loss. */
export const REJOIN_FIRST_DELAYS_MS = [2_000, 4_000, 8_000, 16_000] as const;
/** The wait before every later try. */
export const REJOIN_EVERY_MS = 30_000;

/** The refusals after which no try can succeed (contracts/app-surface.md, `sessions.join`). */
const FINAL_REFUSALS: ReadonlySet<string> = new Set([
  'NOT_FOUND',
  'ACCOUNT_RESTRICTED',
  'JOIN_CLOSED',
  'SESSION_NOT_SCHEDULED',
]);

/** The wait before the next try, after `failures` tries since the loss. */
export function rejoinDelayMs(failures: number): number {
  return REJOIN_FIRST_DELAYS_MS[failures] ?? REJOIN_EVERY_MS;
}

/** Whether a refusal of `sessions.join` ends the tries. */
export function isFinalRefusal(code: string | undefined): boolean {
  return code !== undefined && FINAL_REFUSALS.has(code);
}
