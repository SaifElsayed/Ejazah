// T050 (FR-384, R-HONEST-1, ADR 0021 D4): what a screen says once FR-383's schedule ends with the
// enrollment still Confirming. Plainly: the gateway has not reported the payment yet; a payment
// made is confirmed when it does and appears on this screen; the order reference (from
// `checkout.status`: a screen draws this notice only once that read, answered since the screen
// opened, says the order is Confirming, so an earlier order's never shows), the support address
// (`platform.publicConfig`) and «تحقق مرة أخرى», which reads the enrollment again. It never says the
// payment failed: only the server's report of a failed order or a cancelled enrollment could.
import { View } from 'react-native';

import { Banner, Button, Summary, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { OrderReference } from '../../checkout/components/OutcomeParts';
import { useCheckoutStatus, usePublicConfig } from '../../checkout/outcome-api';

export function ConfirmingNotice({
  enrollmentId,
  onCheckAgain,
}: {
  readonly enrollmentId: string;
  readonly onCheckAgain: () => void;
}) {
  const t = useT();
  const status = useCheckoutStatus(enrollmentId);
  const config = usePublicConfig();
  const reference = status.data?.lastOrder.reference;
  const supportEmail = config.data?.supportEmail;
  const rows = [
    ...(reference === undefined
      ? []
      : [
          {
            label: t('student.checkout.orderNumber'),
            value: <OrderReference reference={reference} />,
          },
        ]),
    ...(supportEmail === undefined
      ? []
      : [
          {
            label: t('student.enrollments.confirming.support'),
            value: (
              <View style={{ flexShrink: 1 }}>
                <Text weight="medium" ltr>
                  {supportEmail}
                </Text>
              </View>
            ),
          },
        ]),
  ];
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: tokens.space['3'] }}>
      <Banner icon={{ name: 'clock' }} tone="warning">
        {t('student.enrollments.confirming.title')}
      </Banner>
      <Text tone="muted">{t('student.enrollments.confirming.text')}</Text>
      {rows.length === 0 ? null : <Summary rows={rows} />}
      <Button
        label={t('student.enrollments.confirming.checkAgain')}
        variant="secondary"
        size="md"
        onPress={() => {
          onCheckAgain();
          void status.refetch();
          if (config.isError) void config.refetch();
        }}
      />
    </View>
  );
}
