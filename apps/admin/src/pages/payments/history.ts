// T053 (FR-400, FR-ADMIN-18): how the monitor says an order's amounts and its history. An amount is
// what the gateway reported, two decimals (`formatPounds`); one not reported is a dash, whatever the
// order's status, a paid one included, and never 0 (the owner's decision of 2026-11-04: a gateway
// may report neither fee nor net on its paid event). The history is the order's creation, its signed
// events and the enrollment's outcomes that concern it, oldest first, each in plain language with
// its day and time in the panel's zone. B42, T047: Phase 3's three outcomes of an enrollment, and the
// release reasons of its holds (R-323 GAP-8).
import type { Piasters } from '@ijazah/money';

import type { TimelineProps } from '../../design/components';
import type { Locale, MessageKey, useT } from '../../i18n';
import { dayMonth, formatPounds, timeOfDay } from '../../lib/format';
import type { PaymentDetail } from './queries';

type Translate = ReturnType<typeof useT>;

/** A reported amount, or a dash where the gateway reported none. */
export function amountOrDash(
  amount_piasters: Piasters | undefined,
  locale: Locale,
  t: Translate,
): string {
  return amount_piasters === undefined
    ? t('admin.payments.dash')
    : formatPounds(amount_piasters, locale);
}

type CancellationReason = NonNullable<
  NonNullable<PaymentDetail['enrollment']>['cancellationReason']
>;

/** Why an enrollment was cancelled, as the monitor names it. */
export const CANCELLATION_REASONS: Readonly<Record<CancellationReason, MessageKey>> = {
  payment_expired: 'admin.payments.cancellationReasons.paymentExpired',
  payment_failed: 'admin.payments.cancellationReasons.paymentFailed',
  admin: 'admin.payments.cancellationReasons.admin',
  gender_correction: 'admin.payments.cancellationReasons.genderCorrection',
  teacher_suspended: 'admin.payments.cancellationReasons.teacherSuspended',
  slot_unavailable: 'admin.payments.cancellationReasons.slotUnavailable',
  checkout_abandoned: 'admin.payments.cancellationReasons.checkoutAbandoned',
  account_deleted: 'admin.payments.cancellationReasons.accountDeleted',
};

type HoldReleaseReason = NonNullable<
  NonNullable<PaymentDetail['enrollment']>['holds'][number]['releaseReason']
>;

/** Why a hold was released (B42, T047; R-323 GAP-8). */
export const HOLD_RELEASE_REASONS: Readonly<Record<HoldReleaseReason, MessageKey>> = {
  converted: 'admin.payments.holdReasons.converted',
  expired: 'admin.payments.holdReasons.expired',
  checkout_abandoned: 'admin.payments.holdReasons.checkoutAbandoned',
  slot_unavailable: 'admin.payments.holdReasons.slotUnavailable',
  admin: 'admin.payments.holdReasons.admin',
  teacher_suspended: 'admin.payments.holdReasons.teacherSuspended',
  account_deleted: 'admin.payments.holdReasons.accountDeleted',
};

const EVENTS: Readonly<Record<PaymentDetail['events'][number]['eventType'], MessageKey>> = {
  paid: 'admin.payments.detail.events.paid',
  failed: 'admin.payments.detail.events.failed',
  expired: 'admin.payments.detail.events.expired',
  refunded: 'admin.payments.detail.events.refunded',
};

/** One step of the history and the instant it happened, as the server wrote it (ISO 8601, UTC). */
interface Step {
  readonly title: string;
  readonly at: string;
}

function outcomeTitle(outcome: PaymentDetail['outcomes'][number], t: Translate): string {
  switch (outcome.kind) {
    case 'confirmed':
      return t('admin.payments.detail.events.enrollmentConfirmed');
    case 'order_failed':
      return t('admin.payments.detail.events.orderFailed');
    case 'cancelled':
      return t('admin.payments.detail.events.enrollmentCancelled', {
        reason:
          outcome.cancellationReason === undefined
            ? t('admin.payments.dash')
            : t(CANCELLATION_REASONS[outcome.cancellationReason]),
      });
    case 'completed':
      return t('admin.payments.detail.events.enrollmentCompleted');
    case 'terminated_no_show':
      return t('admin.payments.detail.events.enrollmentTerminatedNoShow');
    case 'restored':
      return t('admin.payments.detail.events.enrollmentRestored');
    // B42a, Q-B2 (a): T069's two outcomes, a held slot's release and a hold's end.
    case 'slot_released':
      return t('admin.payments.detail.events.enrollmentSlotReleased');
    case 'slot_hold_ended':
      return t('admin.payments.detail.events.enrollmentSlotHoldEnded');
  }
}

/** The order's history, oldest first; a creation, then its events and outcomes as they came. */
export function orderHistory(
  detail: PaymentDetail,
  t: Translate,
  locale: Locale,
  zone: string,
): TimelineProps['items'] {
  const steps: Step[] = [
    { title: t('admin.payments.detail.events.created'), at: detail.createdAt },
    ...detail.events.map(({ eventType, receivedAt }) => ({
      title: t(EVENTS[eventType]),
      at: receivedAt,
    })),
    ...detail.outcomes.map((outcome) => ({
      title: outcomeTitle(outcome, t),
      at: outcome.occurredAt,
    })),
  ];
  // Every instant is the server's ISO string in UTC, so their order is their text's; the sort is
  // stable, so a tie keeps the creation, then the events, then the outcomes.
  return steps
    .toSorted((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map(({ title, at }) => ({
      title,
      meta: t('admin.common.dateTime', {
        date: dayMonth(at, locale, zone),
        time: timeOfDay(at, locale, zone),
      }),
      state: 'done' as const,
    }));
}
