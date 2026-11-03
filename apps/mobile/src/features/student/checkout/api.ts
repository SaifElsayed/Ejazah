// T045 (FR-354, FR-358, FR-BOOK-12 (c); app-surface.md "`checkout` — payments"): what the checkout
// screens read and send. `checkout.current` is the student's unexpired hold with the one payment
// summary; Pay sends the summary the screen shows (`checkoutQuotedSummary`, the owner's decisions of
// 2026-11-03) under a key drawn once per summary, so a repeat of the same press answers the first
// outcome (FR-357) and a press on a summary read again is a new request. `checkout.continue`
// reopens the previous payable order; `checkout.status` gives `CheckoutExpired` its enrollment.
import type {
  CheckoutCurrentOutput,
  CheckoutQuotedSummary,
  CheckoutSummary,
} from '@ijazah/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRef } from 'react';

import { useApi } from '../../../lib/api';

import { CHECKOUT_CURRENT_QUERY_KEY } from './keys';

export { CHECKOUT_CURRENT_QUERY_KEY };

// `checkout.status`, read by `CheckoutExpired` too, is T046's (`outcome-api.ts`): one key, one hook.
export { checkoutStatusQueryKey, isEnrollmentId, useCheckoutStatus } from './outcome-api';

export function useCheckoutCurrent() {
  const { client } = useApi();
  return useQuery<CheckoutCurrentOutput>({
    queryKey: CHECKOUT_CURRENT_QUERY_KEY,
    queryFn: () => client.api.checkout.current.query({}),
  });
}

/** The summary as Pay quotes it: the price, the session count, the length and the track. */
export function quotedOf(summary: CheckoutSummary): CheckoutQuotedSummary {
  return {
    price_piasters: summary.price_piasters,
    sessionCount: summary.sessionCount,
    sessionDurationMinutes: summary.sessionDurationMinutes,
    track: summary.track,
  };
}

/** `checkout.pay` on `holdId`, keyed once per quoted summary. */
export function usePay(holdId: string) {
  const { client } = useApi();
  const queries = useQueryClient();
  const keyed = useRef<{ readonly quoted: string; readonly key: string } | null>(null);
  const keyFor = (quoted: CheckoutQuotedSummary): string => {
    const written = JSON.stringify(quoted);
    if (keyed.current?.quoted !== written) {
      keyed.current = { quoted: written, key: Crypto.randomUUID() };
    }
    return keyed.current.key;
  };
  return useMutation({
    mutationFn: (quoted: CheckoutQuotedSummary) =>
      client.api.checkout.pay.mutate({ holdId, quoted, idempotencyKey: keyFor(quoted) }),
    // The hold now has an enrollment: `checkout.current` is stale (PR #121's review, round 1).
    onSuccess: () => queries.invalidateQueries({ queryKey: CHECKOUT_CURRENT_QUERY_KEY }),
  });
}

/**
 * `checkout.continue`: the previous payable order's hosted page again. The procedure is a read; it
 * runs on the press, never on its own, so it is the screen's action rather than a cached query.
 */
export function useContinue() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (enrollmentId: string) => client.api.checkout.continue.query({ enrollmentId }),
  });
}
