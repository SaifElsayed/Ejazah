// T045 (FR-358, FR-354, FR-382, R-217; screens.md §5 `Checkout`): the order before Pay. The one
// payment summary `checkout.current` gives, the track's caption (recitation only: the ijazah
// track's variant is not drawn) and the gateway's, and in the action bar the countdown and «ادفع».
//
// THE COUNTDOWN runs to `payBy`, the instant Pay stops being accepted (the hold's expiry minus the
// grace, the expiry of the order Pay would create: FR-355, FR-358), read every second from the
// phone's clock, so it continues offline; at zero the screen is `CheckoutExpired` in place.
//
// PAY sends the summary the screen shows. `SUMMARY_CHANGED` reads `checkout.current` again, draws
// the package as it now is with a line saying so, and pays nothing until a new press, which sends
// the new summary under a new key. `HOLD_EXPIRED` is `CheckoutExpired`. On success the hosted page
// opens, and whatever its session answers the phone goes to `processing`. A hold Pay already
// linked to an enrollment (the student came back) goes straight to `processing` for it.
import type { CheckoutCurrentHold } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  NavHeader,
  Skeleton,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { formatPounds } from '../../../../lib/formatters';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { quotedOf, useCheckoutCurrent, usePay } from '../api';
import { OrderSummary } from '../components/OrderSummary';
import { PayWithin } from '../components/PayWithin';
import { useSecondsLeft } from '../countdown';
import { CHECKOUT_PROCESSING_ROUTE, openHostedCheckout } from '../hosted';
import { CheckoutExpired } from './CheckoutExpired';

export function Checkout() {
  const current = useCheckoutCurrent();
  const retry = () => void current.refetch();
  const hold = current.data?.hold;
  const enrollmentId = hold?.enrollmentId;
  useEffect(() => {
    if (enrollmentId !== undefined) {
      router.replace({ pathname: CHECKOUT_PROCESSING_ROUTE, params: { enrollmentId } });
    }
  }, [enrollmentId]);
  if (current.data !== undefined && hold === undefined) return <CheckoutExpired />;
  if (hold === undefined || enrollmentId !== undefined) {
    return (
      <StackScreen header={<CheckoutHeader />}>
        <NotLoaded failed={current.isError} onRetry={retry} loading={<Skeleton shape="block" />} />
      </StackScreen>
    );
  }
  return (
    <OpenCheckout key={hold.holdId} hold={hold} refreshing={current.isFetching} onRefresh={retry} />
  );
}

function CheckoutHeader() {
  const t = useT();
  return (
    <NavHeader
      title={t('student.checkout.title')}
      back={{ kind: 'back', onPress: () => router.back() }}
    />
  );
}

function OpenCheckout({
  hold,
  refreshing,
  onRefresh,
}: {
  readonly hold: CheckoutCurrentHold;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const seconds = useSecondsLeft(hold.payBy);
  const pay = usePay(hold.holdId);
  const [refused, setRefused] = useState<'changed' | 'expired' | 'failed' | null>(null);
  const { summary } = hold;
  const amount = formatPounds(piasters(summary.price_piasters), locale);

  if (seconds === 0 || refused === 'expired') return <CheckoutExpired summary={summary} />;

  const onPay = () => {
    setRefused(null);
    pay.mutate(quotedOf(summary), {
      onSuccess: (handover) =>
        openHostedCheckout(handover.checkoutUrl, handover.enrollmentId).catch(() =>
          setRefused('failed'),
        ),
      onError: (error) => {
        const code = errorCodeOf(error);
        if (code === 'HOLD_EXPIRED') setRefused('expired');
        else if (code === 'SUMMARY_CHANGED') {
          setRefused('changed');
          onRefresh();
        } else setRefused('failed');
      },
    });
  };

  return (
    <StackScreen
      header={<CheckoutHeader />}
      footer={
        <ActionBar>
          <PayWithin seconds={seconds} />
          <Button
            label={t('student.checkout.pay', { amount })}
            layout="block"
            loading={pay.isPending}
            disabled={refreshing}
            onPress={onPay}
          />
        </ActionBar>
      }
    >
      <OfflineNotice onRetry={onRefresh} />
      {refused === 'changed' ? (
        <Banner icon={{ name: 'triangle-alert' }} tone="warning">
          {t('student.checkout.summaryChanged')}
        </Banner>
      ) : null}
      {refused === 'failed' ? (
        <Banner icon={{ name: 'triangle-alert' }} tone="danger">
          {t('common.state.actionError')}
        </Banner>
      ) : null}
      <OrderSummary
        summary={summary}
        label={t('student.checkout.a11y.order')}
        rows={[{ label: t('student.checkout.total'), value: amount, kind: 'total' }]}
      />
      <View style={{ gap: tokens.space['2'] }}>
        {summary.track === 'recitation' ? (
          <Text variant="caption" tone="muted">
            {t('student.checkout.note.recitation')}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted">
          {t('student.checkout.note.gateway')}
        </Text>
      </View>
    </StackScreen>
  );
}
