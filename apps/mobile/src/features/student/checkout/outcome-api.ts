// T046 (FR-380, FR-383, FR-356, FR-357): what the outcome screens read and do. `checkout.status`
// is the enrollment as the server holds it, read on a schedule while Processing waits; the schedule
// and its timeout are `platform.publicConfig`'s checkout numbers (T002), read with the support
// address under one key. Retry asks for a new order on the same hold with one idempotency key per
// attempt, kept until the order is handed over so that a repeated press after a lost answer
// returns the first outcome (FR-357), then opens the hosted page.
import {
  type CheckoutStatusOutput,
  checkoutStatusInput,
  type PublicConfig,
} from '@ijazah/contracts';
import { useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback, useRef } from 'react';

import { useApi } from '../../../lib/api';
import { openHostedCheckout } from './hosted';

/** A second, in the milliseconds the timers count. */
export const SECOND_MS = 1_000;

export const checkoutStatusQueryKey = (enrollmentId: string) =>
  ['student', 'checkout', 'status', enrollmentId] as const;

/** `platform.publicConfig`'s key, shared with the payout's support address. */
const PUBLIC_CONFIG_QUERY_KEY = ['platform', 'publicConfig'] as const;

/** Whether `enrollmentId` can name an enrollment at all (the procedure's own input). */
export function isEnrollmentId(enrollmentId: string): boolean {
  return checkoutStatusInput.safeParse({ enrollmentId }).success;
}

/** `checkout.status`, read again every `everyMs` while it is a number. */
export function useCheckoutStatus(enrollmentId: string, everyMs: number | false = false) {
  const { client } = useApi();
  return useQuery<CheckoutStatusOutput>({
    queryKey: checkoutStatusQueryKey(enrollmentId),
    queryFn: () => client.api.checkout.status.query({ enrollmentId }),
    enabled: isEnrollmentId(enrollmentId),
    refetchInterval: everyMs,
  });
}

/** The public configuration; Processing takes its `checkout` numbers (FR-383). */
export function usePublicConfig() {
  const { client } = useApi();
  return useQuery<PublicConfig>({
    queryKey: PUBLIC_CONFIG_QUERY_KEY,
    queryFn: () => client.publicConfig(),
  });
}

/**
 * Retry on the enrollment's hold (FR-356): the new order's hosted page is opened, and once it closes
 * the phone goes to `processing` (`hosted.ts`, shared with T045's Pay). A refusal throws.
 */
export function useRetryCheckout(enrollmentId: string): () => Promise<void> {
  const { client } = useApi();
  const key = useRef<string | null>(null);
  return useCallback(async () => {
    key.current ??= Crypto.randomUUID();
    const handover = await client.api.checkout.retry.mutate({
      enrollmentId,
      idempotencyKey: key.current,
    });
    key.current = null;
    await openHostedCheckout(handover.checkoutUrl, enrollmentId);
  }, [client, enrollmentId]);
}
