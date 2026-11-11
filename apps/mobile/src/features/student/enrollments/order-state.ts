// T050 (FR-383, FR-384, R-HONEST-1; the owner's decision of 2026-11-04): what an enrollment awaiting
// payment says depends on its last order as the server reports it on `checkout.status`. An order
// created or paid is Confirming: the badge «قيد التأكيد», FR-383's schedule, then FR-384's message.
// An order the server reports failed or expired is not: «بانتظار الدفع», no schedule and no message.
// Until the order is read since the screen opened, nothing is claimed: no badge (a refunded order,
// which no pending enrollment should carry, claims nothing either). A screen gathers the states its
// cards report, so its schedule runs only while one of them is Confirming.
import type { PaymentStatus } from '@ijazah/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { BadgeProps } from '../../../design/primitives';
import type { MessageKey } from '../../../i18n';
import { useAnsweredSinceMount } from '../../shared/states/fresh';
import { checkoutStatusQueryKey, useCheckoutStatus } from '../checkout/outcome-api';

export type OrderState = 'unknown' | 'confirming' | 'awaitingPayment';

export interface OrderReport {
  readonly state: OrderState;
  /** The order's last read failed: the screen draws its retry state. */
  readonly failed: boolean;
  /** The failed read's error while `failed`, else null (T065 of specs/004-sessions). */
  readonly error: unknown;
}

export const ORDER_BADGE: Readonly<
  Record<Exclude<OrderState, 'unknown'>, { label: MessageKey; tone: BadgeProps['tone'] }>
> = {
  confirming: { label: 'status.enrollment.confirming', tone: 'warning' },
  awaitingPayment: { label: 'status.enrollment.pendingPayment', tone: 'neutral' },
};

export function orderStateOf(status: PaymentStatus): OrderState {
  switch (status) {
    case 'created':
    case 'paid':
      return 'confirming';
    case 'failed':
    case 'expired':
      return 'awaitingPayment';
    case 'refunded':
      return 'unknown';
  }
}

/** The enrollment's last order, read every `everyMs` while it is a number. */
export function usePendingOrder(enrollmentId: string, everyMs: number | false): OrderReport {
  const status = useCheckoutStatus(enrollmentId, everyMs);
  const answered = useAnsweredSinceMount(status, checkoutStatusQueryKey(enrollmentId));
  const read = answered ? status.data : undefined;
  return {
    state: read === undefined ? 'unknown' : orderStateOf(read.lastOrder.status),
    failed: status.isError,
    error: status.isError ? status.error : null,
  };
}

/** The order states a screen's cards report, by enrollment. */
export function useOrderStates() {
  const queries = useQueryClient();
  const [reports, setReports] = useState<Readonly<Record<string, OrderReport>>>({});
  const report = useCallback((enrollmentId: string, next: OrderReport) => {
    setReports((before) => {
      const was = before[enrollmentId];
      return was?.state === next.state && was.failed === next.failed && was.error === next.error
        ? before
        : { ...before, [enrollmentId]: next };
    });
  }, []);
  const stateOf = (enrollmentId: string): OrderState => reports[enrollmentId]?.state ?? 'unknown';
  return {
    report,
    stateOf,
    isConfirming: (enrollmentId: string) => stateOf(enrollmentId) === 'confirming',
    failed: (enrollmentIds: readonly string[]) =>
      enrollmentIds.some((id) => reports[id]?.failed === true),
    /** The first failed order's error, in the ids' order, else null (T065). */
    error: (enrollmentIds: readonly string[]): unknown =>
      enrollmentIds.map((id) => reports[id]).find((was) => was?.failed === true)?.error ?? null,
    /** Reads every order again (the screen's retry). */
    retry: () => void queries.refetchQueries({ queryKey: ['student', 'checkout', 'status'] }),
  };
}
