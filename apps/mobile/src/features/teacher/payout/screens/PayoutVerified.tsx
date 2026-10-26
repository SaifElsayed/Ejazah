// T078 (FR-191, FR-PAYG-15): the gateway verified the account (PayoutVerified), also the account
// row's target while verified. No header, as drawn. The board's «ما نُشر» list holds the packages,
// the weekly slots and the payout account; the first two and «مراجعة باقاتي» arrive with their
// screens in Phase 2 (T052's rule on rows), so the payout account is listed alone, with the day it
// was verified in the account's zone, and leads to `start` to replace it (FR-193).
// The board's lede says students can now enroll, which no screen of this phase lets them do; the
// honest lede is shown (R-HONEST, B15 integration) and the board's waits in the catalogue.
import type { PayoutGetOutput } from '@ijazah/contracts';
import { router } from 'expo-router';
import { View } from 'react-native';

import {
  ActionBar,
  Button,
  Icon,
  IconTile,
  List,
  ListRow,
  PageIntro,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useFormatters } from '../../../../lib/formatters';
import { StackScreen } from '../../../shared/screen';
import { PAYOUT_START_ROUTE } from '../navigation';

export function PayoutVerified({ payout }: { readonly payout: PayoutGetOutput }) {
  const t = useT();
  const me = useMe();
  const format = useFormatters();
  const zone = me.data?.timezone;
  return (
    <StackScreen
      header={<View style={{ height: tokens.space['6'] }} />}
      footer={
        <ActionBar>
          <Button
            label={t('teacher.payout.verified.toToday')}
            layout="block"
            onPress={() => router.navigate('/(teacher)/(tabs)')}
          />
        </ActionBar>
      }
    >
      <IconTile icon={{ name: 'shield-check' }} size="2xl" />
      <PageIntro
        title={t('teacher.payout.verified.title')}
        lede={t('teacher.payout.honest.verifiedLede')}
      />
      <View accessibilityLabel={t('teacher.payout.verified.a11y.published')}>
        <List>
          <ListRow
            leading={<Icon name="landmark" />}
            label={t('teacher.payout.verified.payoutAccount')}
            {...(payout.verifiedAt === undefined || zone === undefined
              ? {}
              : {
                  value: t('teacher.payout.verified.verifiedOn', {
                    date: format.date(payout.verifiedAt, zone),
                  }),
                })}
            onPress={() => router.push(PAYOUT_START_ROUTE)}
          />
        </List>
      </View>
    </StackScreen>
  );
}
