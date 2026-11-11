// T046 (FR-362, FR-PAYG-19, FR-DISPUTE-5; screens.md §5 `PaymentSlotUnavailable`): drawn only when
// the server reports the enrollment cancelled although its order was paid, the slot no longer
// available to it. The student is told only that the booking was cancelled and that they will be
// contacted about the amount paid; the compensation case is the administration's, never shown. The
// summary: the enrollment (no track badge, as the board draws it), the order reference, the amount
// paid and the enrollment's status.
import { piasters } from '@ijazah/money';
import { router } from 'expo-router';

import {
  ActionBar,
  Badge,
  Button,
  IconTile,
  PageIntro,
  Summary,
} from '../../../../design/primitives';
import { useLocale, useT } from '../../../../i18n';
import { formatPounds } from '../../../../lib/formatters';
import {
  EnrollmentValue,
  OrderReference,
  OutcomeLoading,
  OutcomeScreen,
  useEnrollmentParam,
  useLeaveFor,
} from '../components/OutcomeParts';
import { ENROLLMENTS_ROUTE, outcomeOf } from '../outcome';
import { useCheckoutStatus } from '../outcome-api';

export function PaymentSlotUnavailable() {
  const t = useT();
  const locale = useLocale();
  const enrollmentId = useEnrollmentParam();
  const status = useCheckoutStatus(enrollmentId);
  const outcome = status.data === undefined ? undefined : outcomeOf(status.data);
  useLeaveFor(outcome, 'slotUnavailable', enrollmentId);

  if (status.data === undefined || outcome !== 'slotUnavailable') {
    return (
      <OutcomeLoading
        failed={status.isError}
        error={status.error}
        onRetry={() => void status.refetch()}
      />
    );
  }
  const { summary, lastOrder } = status.data;
  return (
    <OutcomeScreen
      footer={
        <ActionBar>
          <Button
            label={t('student.checkout.toEnrollments')}
            layout="block"
            onPress={() => router.replace(ENROLLMENTS_ROUTE)}
          />
        </ActionBar>
      }
    >
      <IconTile icon={{ name: 'triangle-alert' }} tone="warning" size="xl" round />
      <PageIntro
        title={t('student.checkoutSlotUnavailable.title')}
        lede={t('student.checkoutSlotUnavailable.lede')}
      />
      <Summary
        rows={[
          { label: t('student.checkout.enrollment'), value: <EnrollmentValue summary={summary} /> },
          {
            label: t('student.checkout.orderNumber'),
            value: <OrderReference reference={lastOrder.reference} />,
          },
          {
            label: t('student.checkout.amountPaid'),
            value: formatPounds(piasters(summary.price_piasters), locale),
          },
          {
            label: t('student.checkoutSlotUnavailable.enrollmentStatus'),
            value: <Badge label={t('status.enrollment.cancelled')} tone="neutral" />,
          },
        ]}
      />
    </OutcomeScreen>
  );
}
