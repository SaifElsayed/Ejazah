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
//
// 006:T019 (Q-A2 (a), the owner, 2026-11-25; T009): the programme's own payable order
// (`checkout.current.programmeOrder`, `programme.pay`'s or `programme.renew`'s, which has no
// hold) is shown with the time left on it and continued the same way; its hosted page returns here
// and the screen goes back to the programme's page (`openProgrammeCheckout`, Q-A1 (a)), never to
// `processing`, which would report the programme's enrollment paid on its assessment. One that can
// no longer be continued goes back too; at zero the order is read again.
import type { CheckoutCurrentHold, CheckoutCurrentOutput } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  IconTile,
  NavHeader,
  Skeleton,
  Summary,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { formatPounds, useFormatters } from '../../../../lib/formatters';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { useCheckoutCurrent, useContinue } from '../api';
import { OrderSummary } from '../components/OrderSummary';
import { useSecondsLeft } from '../countdown';
import { CHECKOUT_PROCESSING_ROUTE, openHostedCheckout, openProgrammeCheckout } from '../hosted';
import { CheckoutExpired } from './CheckoutExpired';

/** The earlier order's enrollment and its expiry, when it can still be continued. */
interface Payable {
  readonly hold: CheckoutCurrentHold;
  readonly enrollmentId: string;
  readonly expiresAt: string;
}

/** The programme's own payable order (006:T019, Q-A2 (a)): its enrollment and its expiry. */
interface ProgrammePayable {
  readonly enrollmentId: string;
  readonly expiresAt: string;
}

type Next =
  | { readonly kind: 'loading' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'processing'; readonly enrollmentId: string }
  | ({ readonly kind: 'payable' } & Payable)
  | ({ readonly kind: 'programme' } & ProgrammePayable);

function nextOf(current: CheckoutCurrentOutput | undefined): Next {
  if (current === undefined) return { kind: 'loading' };
  const { hold, programmeOrder } = current;
  if (hold?.enrollmentId === undefined) {
    if (programmeOrder?.canContinue !== true) return { kind: 'gone' };
    const { enrollmentId, expiresAt } = programmeOrder;
    return { kind: 'programme', enrollmentId, expiresAt };
  }
  const { enrollmentId, lastOrder } = hold;
  if (lastOrder?.canContinue !== true) return { kind: 'processing', enrollmentId };
  return { kind: 'payable', hold, enrollmentId, expiresAt: lastOrder.expiresAt };
}

export function CheckoutPrevious() {
  const current = useCheckoutCurrent();
  const { refetch } = current;
  // Stable, so the programme order's read at zero runs once (006:T019).
  const retry = useCallback(() => void refetch(), [refetch]);
  // Only a read made since this screen mounted decides where it goes: the cache may hold an earlier
  // checkout's answer (PR #121's review, round 1, the note under T045).
  const fresh = current.isFetchedAfterMount ? current.data : undefined;
  const next = nextOf(fresh);
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
  if (next.kind === 'programme') {
    return (
      <ProgrammeOrder
        key={`${next.enrollmentId}:${next.expiresAt}`}
        payable={next}
        onRefresh={retry}
      />
    );
  }
  if (next.kind !== 'payable') {
    return (
      <StackScreen header={<PreviousHeader />}>
        {leaving ? null : (
          <NotLoaded
            failed={current.isError}
            error={current.error}
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
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const { summary } = payable.hold;
  if (seconds === 0) return <CheckoutExpired summary={summary} />;

  const onContinue = () => {
    setFailure(null);
    resume.mutate(payable.enrollmentId, {
      onSuccess: (handover) =>
        openHostedCheckout(handover.checkoutUrl, payable.enrollmentId).catch((caught: unknown) =>
          setFailure(genericErrorKey(caught, 'common.state.actionError')),
        ),
      onError: (error) => {
        if (errorCodeOf(error) === 'ORDER_NOT_PAYABLE') onRefresh();
        else setFailure(genericErrorKey(error, 'common.state.actionError'));
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
      {failure !== null ? (
        <Banner icon={{ name: 'triangle-alert' }} tone="danger">
          {t(failure.key, failure.values)}
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

/**
 * 006:T019 (Q-A2 (a)): the programme's own payable order. It has no hold, so no package summary:
 * the time left on it, continued through `checkout.continue`; once its hosted page closes the
 * student goes back to the programme's page (Q-A1 (a)). At zero the order is read again.
 */
function ProgrammeOrder({
  payable,
  onRefresh,
}: {
  readonly payable: ProgrammePayable;
  readonly onRefresh: () => void;
}) {
  const t = useT();
  const format = useFormatters();
  const seconds = useSecondsLeft(payable.expiresAt);
  const resume = useContinue();
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const expired = seconds === 0;
  useEffect(() => {
    if (expired) onRefresh();
  }, [expired, onRefresh]);

  const onContinue = () => {
    setFailure(null);
    resume.mutate(payable.enrollmentId, {
      onSuccess: (handover) =>
        openProgrammeCheckout(handover.checkoutUrl).then(
          () => router.back(),
          (caught: unknown) => setFailure(genericErrorKey(caught, 'common.state.actionError')),
        ),
      onError: (error) => {
        if (errorCodeOf(error) === 'ORDER_NOT_PAYABLE') onRefresh();
        else setFailure(genericErrorKey(error, 'common.state.actionError'));
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
            disabled={expired}
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
      {failure !== null ? (
        <Banner icon={{ name: 'triangle-alert' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      ) : null}
      <Summary
        rows={[
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
