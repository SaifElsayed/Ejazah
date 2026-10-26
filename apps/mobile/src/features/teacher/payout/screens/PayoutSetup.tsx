// T078 (FR-193, FR-PAYG-14, FR-PAYG-16): the account registered and waiting for the gateway's
// verdict (PayoutSetup): «قيد التحقق», the day it was added in the account's zone, and that the
// teacher stays hidden meanwhile. The first setup and a replacement draw the same screen
// (open-items 17); «تغيير الحساب» registers another (`start`). No account detail is shown: the
// platform keeps only the gateway's reference (FR-190).
import type { PayoutGetOutput } from '@ijazah/contracts';
import { router } from 'expo-router';
import { View } from 'react-native';

import { ActionBar, Badge, Button, Card, IconTile, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useFormatters } from '../../../../lib/formatters';
import { StackScreen } from '../../../shared/screen';
import { PayoutHeader } from '../components/PayoutHeader';
import { PAYOUT_START_ROUTE } from '../navigation';

export function PayoutSetup({ payout }: { readonly payout: PayoutGetOutput }) {
  const t = useT();
  const me = useMe();
  const format = useFormatters();
  const zone = me.data?.timezone;
  return (
    <StackScreen
      header={<PayoutHeader title={t('teacher.payout.setup.title')} />}
      footer={
        <ActionBar>
          <Button
            label={t('teacher.payout.setup.change')}
            variant="secondary"
            layout="block"
            onPress={() => router.push(PAYOUT_START_ROUTE)}
          />
        </ActionBar>
      }
    >
      <Card variant="hero">
        <View style={{ alignSelf: 'flex-start' }}>
          <Badge label={t('status.payout.verifying')} tone="warning" icon={{ name: 'hourglass' }} />
        </View>
        <View style={{ gap: tokens.space['1'] }}>
          <Text variant="title-2">{t('teacher.payout.setup.verifyingTitle')}</Text>
          <Text tone="muted">{t('teacher.payout.setup.verifyingText')}</Text>
        </View>
      </Card>
      <Card variant="row">
        <IconTile icon={{ name: 'landmark' }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text weight="medium">{t('teacher.payout.setup.newBankAccount')}</Text>
          {payout.configuredAt === undefined || zone === undefined ? null : (
            <Text variant="caption" tone="muted">
              {t('teacher.payout.setup.addedOn', {
                date: format.weekdayDate(payout.configuredAt, zone),
              })}
            </Text>
          )}
        </View>
      </Card>
      <Text variant="callout" tone="muted">
        {t('teacher.payout.setup.note')}
      </Text>
    </StackScreen>
  );
}
