// T045 (FR-PAYG-6, FR-BOOK-9, FR-382; screens.md §5 `CheckoutExpired`): the time to pay ran out.
// The order was cancelled and nothing was charged; the summary, when the screen has it, with the
// status «ملغى» only: the enrollment's reason (`payment_expired`, `payment_failed`) is the
// server's and never shown. «ابدأ من جديد» goes back to the teacher's profile (to discovery when
// the screen has no teacher), «الرئيسية» to the home. The checkout and `CheckoutPrevious` draw it
// in place when their countdown ends; the route draws it for an enrollment it is given.
import type { CheckoutSummary } from '@ijazah/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { ActionBar, Badge, Button, IconTile, Skeleton, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded } from '../../../shared/states';
import { isEnrollmentId, useCheckoutStatus } from '../api';
import { OrderSummary } from '../components/OrderSummary';

export function CheckoutExpired({ summary }: { readonly summary?: CheckoutSummary }) {
  const t = useT();
  const startOver = () => {
    if (summary === undefined) router.dismissTo('/(student)/(tabs)/discovery');
    else {
      router.dismissTo({
        pathname: '/(student)/discovery/[teacherId]',
        params: { teacherId: summary.teacher.teacherId },
      });
    }
  };
  return (
    <StackScreen
      header={null}
      footer={
        <ActionBar>
          <Button
            label={t('student.checkoutExpired.startOver')}
            layout="block"
            onPress={startOver}
          />
          <Button
            label={t('common.action.home')}
            variant="ghost"
            layout="block"
            onPress={() => router.dismissTo('/')}
          />
        </ActionBar>
      }
    >
      <View style={{ alignItems: 'center', gap: tokens.space['3'] }}>
        <IconTile icon={{ name: 'hourglass', size: 'xl' }} tone="neutral" size="2xl" />
        <View style={{ gap: tokens.space['1'] }}>
          <Text variant="title-2" align="center">
            {t('student.checkoutExpired.title')}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {t('student.checkoutExpired.lede')}
          </Text>
        </View>
      </View>
      {summary === undefined ? null : (
        <OrderSummary
          summary={summary}
          label={t('student.checkout.a11y.order')}
          rows={[
            {
              label: t('student.checkoutExpired.status'),
              value: <Badge label={t('status.enrollment.cancelled')} tone="neutral" />,
            },
          ]}
        />
      )}
    </StackScreen>
  );
}

/** The `expired` route: the enrollment named by `enrollmentId`, when one is given. */
export function CheckoutExpiredRoute() {
  const params = useLocalSearchParams<{ enrollmentId?: string }>();
  const enrollmentId = typeof params.enrollmentId === 'string' ? params.enrollmentId : '';
  const status = useCheckoutStatus(enrollmentId);
  if (!isEnrollmentId(enrollmentId)) return <CheckoutExpired />;
  if (status.data === undefined) {
    return (
      <StackScreen header={null}>
        <NotLoaded
          failed={status.isError}
          error={status.error}
          onRetry={() => void status.refetch()}
          loading={<Skeleton shape="block" />}
        />
      </StackScreen>
    );
  }
  return <CheckoutExpired summary={status.data.summary} />;
}
