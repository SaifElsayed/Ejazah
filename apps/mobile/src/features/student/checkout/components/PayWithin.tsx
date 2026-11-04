// T045 (FR-358; the note under T045 of 2026-11-02): the checkout's countdown line in the action bar,
// «أكمل الدفع خلال 8:12» after a clock (`.action-bar__note` on the Checkout board), composed of the
// Icon and Text primitives with no contract of its own. The seconds are `useSecondsLeft`'s.
import { View } from 'react-native';

import { Icon, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';

export function PayWithin({ seconds }: { readonly seconds: number }) {
  const t = useT();
  const format = useFormatters();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space['1'],
      }}
    >
      <Icon name="clock" size="xs" tone="muted" />
      <Text variant="caption" tone="muted">
        {t('student.checkout.payWithin', { time: format.countdown(seconds) })}
      </Text>
    </View>
  );
}
