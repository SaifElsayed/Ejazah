// T045 (FR-BOOK-12 (c), FR-382; screens.md §5 `CheckoutPrevious`): a new checkout was refused
// because an earlier payment is still payable. The message, the earlier order as `checkout.current`
// gives it (the teacher, the package with its track, the amount) and the time left on its order,
// counted by `secondsUntil`; «أكمل الدفع السابق» reopens that order's hosted page
// (`checkout.continue`) and then goes to `processing`, «سأنتظر» back to the teacher. The board's
// lede names the earlier and the new slot, which no answer carries, so it is not drawn.
//
// FR-BOOK-12 (b): an earlier payment that can no longer be continued (paid, or being processed)
// goes to its `processing`. With no earlier checkout left (it ended meanwhile) the screen goes back,
// where the new checkout can be started again. At zero the order has expired: `CheckoutExpired`.
import type { CheckoutCurrentHold } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  IconTile,
  NavHeader,
  Skeleton,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { formatPounds, useFormatters } from '../../../../lib/formatters';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { useCheckoutCurrent, useContinue } from '../api';
import { OrderSummary } from '../components/OrderSummary';
import { useSecondsLeft } from '../countdown';
import { CHECKOUT_PROCESSING_ROUTE, openHostedCheckout } from '../hosted';
import { CheckoutExpired } from './CheckoutExpired';

/** The earlier order's enrollment and its expiry, when it can still be continued. */
interface Payable {
  readonly hold: CheckoutCurrentHold;
  readonly enrollmentId: string;
  readonly expiresAt: string;
}

type Next =
  | { readonly kind: 'loading' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'processing'; readonly enrollmentId: string }
  | ({ readonly kind: 'payable' } & Payable);

function nextOf(hold: CheckoutCurrentHold | undefined, loaded: boolean): Next {
  if (!loaded) return { kind: 'loading' };
  if (hold?.enrollmentId === undefined) return { kind: 'gone' };
  const { enrollmentId, lastOrder } = hold;
  if (lastOrder?.canContinue !== true) return { kind: 'processing', enrollmentId };
  return { kind: 'payable', hold, enrollmentId, expiresAt: lastOrder.expiresAt };
}

export function CheckoutPrevious() {
  const current = useCheckoutCurrent();
  const retry = () => void current.refetch();
  const next = nextOf(current.data?.hold, current.data !== undefined);
  const leaving = next.kind === 'gone' || next.kind === 'processing';
  const processingId = next.kind === 'processing' ? next.enrollmentId : undefined;
  useEffect(() => {
    if (processingId !== undefined) {
      router.replace({
        pathname: CHECKOUT_PROCESSING_ROUTE,
        params: { enrollmentId: processingId },
      });
    }
  }, [processingId]);
  useEffect(() => {
    if (next.kind === 'gone') router.back();
  }, [next.kind]);
  if (next.kind !== 'payable') {
    return (
      <StackScreen header={<PreviousHeader />}>
        {leaving ? null : (
          <NotLoaded
            failed={current.isError}
            onRetry={retry}
            loading={<Skeleton shape="block" />}
          />
        )}
      </StackScreen>
    );
  }
  return (
    <PreviousOrder
      key={`${next.enrollmentId}:${next.expiresAt}`}
      payable={next}
      onRefresh={retry}
    />
  );
}

function PreviousHeader() {
  const t = useT();
  return (
    <NavHeader
      title={t('student.checkout.title')}
      back={{ kind: 'back', onPress: () => router.back() }}
    />
  );
}

function PreviousOrder({
  payable,
  onRefresh,
}: {
  readonly payable: Payable;
  readonly onRefresh: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const seconds = useSecondsLeft(payable.expiresAt);
  const resume = useContinue();
  const [failed, setFailed] = useState(false);
  const { summary } = payable.hold;
  if (seconds === 0) return <CheckoutExpired summary={summary} />;

  const onContinue = () => {
    setFailed(false);
    resume.mutate(payable.enrollmentId, {
      onSuccess: (handover) =>
        openHostedCheckout(handover.checkoutUrl, payable.enrollmentId).catch(() => setFailed(true)),
      onError: (error) => {
        if (errorCodeOf(error) === 'ORDER_NOT_PAYABLE') onRefresh();
        else setFailed(true);
      },
    });
  };

  return (
    <StackScreen
      header={<PreviousHeader />}
      footer={
        <ActionBar>
          <Button
            label={t('student.checkoutPrevious.continuePrevious')}
            layout="block"
            loading={resume.isPending}
            onPress={onContinue}
          />
          <Button
            label={t('student.checkoutPrevious.wait')}
            variant="ghost"
            layout="block"
            onPress={() => router.back()}
          />
        </ActionBar>
      }
    >
      <OfflineNotice onRetry={onRefresh} />
      <View style={{ alignItems: 'center', gap: tokens.space['3'] }}>
        <IconTile icon={{ name: 'hourglass', size: 'xl' }} tone="warning" size="2xl" />
        <Text variant="title-2" align="center">
          {t('student.checkoutPrevious.title')}
        </Text>
      </View>
      {failed ? (
        <Banner icon={{ name: 'triangle-alert' }} tone="danger">
          {t('common.state.actionError')}
        </Banner>
      ) : null}
      <OrderSummary
        summary={summary}
        label={t('student.checkoutPrevious.a11y.previousOrder')}
        rows={[
          {
            label: t('student.checkout.amount'),
            value: formatPounds(piasters(summary.price_piasters), locale),
          },
          {
            label: t('student.checkoutPrevious.payWithin'),
            value: (
              <Text variant="body" weight="medium" ltr>
                {format.countdown(seconds)}
              </Text>
            ),
          },
        ]}
      />
    </StackScreen>
  );
}
