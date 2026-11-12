// T058 of specs/004-sessions (plan.md decision 7; the owner's decisions of 2026-11-06 on the fifth
// analysis and on the sixth, item 6): the words a page shows for a failure with no message of its
// own. A refusal of `RATE_LIMITED` says when to try again when the server says it, from T062's
// `retryAfterSeconds` detail (contracts/README.md "Errors": a positive whole number of seconds, as
// text), in whole minutes rounded up, and to wait a little when it does not; every other failure, an
// API refusal or no answer at all, keeps the page's own generic key. The code is read through
// `errorCodeOf` and the time through `errorDetailsOf` (lib/client.ts), never from a message or a
// status, as the phone's `genericErrorKey` reads them (apps/mobile/src/lib/error-message.ts).
import type { MessageKey, MessageValues } from '../i18n';
import { errorCodeOf, errorDetailsOf } from './client';

/** A message of the catalogue, with the values its template interpolates. */
export interface ErrorMessage {
  readonly key: MessageKey;
  readonly values?: MessageValues;
}

const RATE_LIMITED = 'RATE_LIMITED';
const RETRY_AFTER_SECONDS = 'retryAfterSeconds';
const SECONDS_PER_MINUTE = 60;
const WHOLE_NUMBER = /^\d+$/;

/** The message for `error`: `RATE_LIMITED`'s, with its time when it gives one, else `fallback`. */
export function errorMessageKey(error: unknown, fallback: MessageKey): ErrorMessage {
  if (errorCodeOf(error) !== RATE_LIMITED) return { key: fallback };
  const seconds = retryAfterSecondsOf(error);
  if (seconds === undefined) return { key: 'admin.common.rateLimited' };
  const count = Math.max(1, Math.ceil(seconds / SECONDS_PER_MINUTE));
  return { key: 'admin.common.rateLimitedIn', values: { count } };
}

/**
 * The refusal's `retryAfterSeconds` when it is a positive whole number, else undefined: the one
 * reading of T062's detail, for this helper and for a page whose own words for `RATE_LIMITED` gain
 * the time (`pages/_shared/ManualCaseDialog.tsx`).
 */
export function retryAfterSecondsOf(error: unknown): number | undefined {
  const detail = errorDetailsOf(error).find(({ path }) => path === RETRY_AFTER_SECONDS);
  if (detail === undefined || !WHOLE_NUMBER.test(detail.code)) return undefined;
  const seconds = Number(detail.code);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
}
