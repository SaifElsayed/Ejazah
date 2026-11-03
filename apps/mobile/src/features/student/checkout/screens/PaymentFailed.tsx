// T046 (FR-356, FR-365, FR-PAYG-18; screens.md §5 `PaymentFailed`): drawn only when the server
// reports the enrollment's last order failed, its hold kept for a Retry. Retry asks for a new order
// on the same hold, opens its hosted page and goes on to Processing whatever the page ends with;
// past the last moment an order can be created on the hold (`ORDER_NOT_PAYABLE`) the checkout is
// over (`CheckoutExpired`). Another slot opens the teacher's page, where the booking sheet starts a
// new checkout (FR-BOOK-12). The summary carries no track badge, as the board draws it.
import { router } from 'expo-router';
import { useState } from 'react';

import {
  ActionBar,
  Banner,
  Button,
  IconTile,
  PageIntro,
  Summary,
} from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import {
  OutcomeLoading,
  OutcomeScreen,
  useEnrollmentParam,
  useLeaveFor,
  usePackageLine,
} from '../components/OutcomeParts';
import { outcomeOf, outcomeRoute } from '../outcome';
import { useCheckoutStatus, useRetryCheckout } from '../outcome-api';

export function PaymentFailed() {
  const t = useT();
  const enrollmentId = useEnrollmentParam();
  const status = useCheckoutStatus(enrollmentId);
  const retryOrder = useRetryCheckout(enrollmentId);
  const packageLine = usePackageLine();
  const [retrying, setRetrying] = useState(false);
  const [refused, setRefused] = useState(false);
  const outcome = status.data === undefined ? undefined : outcomeOf(status.data);
  useLeaveFor(outcome, 'failed', enrollmentId);

  if (status.data === undefined || outcome !== 'failed') {
    return <OutcomeLoading failed={status.isError} onRetry={() => void status.refetch()} />;
  }
  const { summary } = status.data;

  async function retry(): Promise<void> {
    setRetrying(true);
    setRefused(false);
    // The screen stays busy once it leaves: the route it goes to replaces it.
    try {
      await retryOrder();
      router.replace(outcomeRoute('pending', enrollmentId));
    } catch (error) {
      if (errorCodeOf(error) === 'ORDER_NOT_PAYABLE') {
        router.replace(outcomeRoute('expired', enrollmentId));
        return;
      }
      setRefused(true);
      setRetrying(false);
    }
  }

  return (
    <OutcomeScreen
      footer={
        <ActionBar>
          <Button
            label={t('common.action.retry')}
            layout="block"
            loading={retrying}
            disabled={retrying}
            onPress={() => void retry()}
          />
          <Button
            label={t('student.checkoutFailed.chooseAnotherSlot')}
            variant="secondary"
            layout="block"
            disabled={retrying}
            onPress={() =>
              router.push({
                pathname: '/(student)/discovery/[teacherId]',
                params: { teacherId: summary.teacher.teacherId },
              })
            }
          />
        </ActionBar>
      }
    >
      <IconTile icon={{ name: 'alert-circle' }} tone="neutral" size="xl" round />
      <PageIntro
        title={t('student.checkoutFailed.title')}
        lede={t('student.checkoutFailed.lede')}
      />
      <Summary
        rows={[
          { label: t('student.checkout.package'), value: packageLine(summary) },
          { label: t('student.checkout.teacher'), value: summary.teacher.displayName },
        ]}
      />
      {refused ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('common.state.actionError')}
        </Banner>
      ) : null}
    </OutcomeScreen>
  );
}
