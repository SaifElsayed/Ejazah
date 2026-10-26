// T078 (FR-191, FR-PAYG-15, FR-PAYG-16, FR-145): the gateway rejected the account
// (PayoutRejected). The reason is the gateway's, shown as the plain text it sent, with a generic
// line when none came (B15 check, decision 2; open-items 8, so no reason is mapped to a key). The
// two tips as drawn; «المحاولة مرة أخرى» registers again (`start`); the support line writes to the
// address the public configuration serves, read once per launch, and is drawn once it is known.
import type { PayoutGetOutput } from '@ijazah/contracts';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  Icon,
  IconTile,
  PageIntro,
  Text,
  TextLink,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { StackScreen } from '../../../shared/screen';
import { useSupportEmail } from '../api';
import { PayoutHeader } from '../components/PayoutHeader';
import { PAYOUT_START_ROUTE } from '../navigation';

const TIPS = [
  'teacher.payout.rejected.tipName',
  'teacher.payout.rejected.tipNumber',
] as const satisfies readonly MessageKey[];

export function PayoutRejected({ payout }: { readonly payout: PayoutGetOutput }) {
  const t = useT();
  const supportEmail = useSupportEmail();
  return (
    <StackScreen
      header={<PayoutHeader title={t('teacher.payout.rejected.title')} />}
      footer={
        <ActionBar>
          <Button
            label={t('teacher.payout.rejected.tryAgain')}
            icon={{ name: 'rotate-ccw' }}
            layout="block"
            onPress={() => router.push(PAYOUT_START_ROUTE)}
          />
          {supportEmail === undefined ? null : (
            <View style={{ alignItems: 'center' }}>
              <TextLink
                label={t('teacher.payout.rejected.supportNote', { email: supportEmail })}
                variant="muted"
                onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
              />
            </View>
          )}
        </ActionBar>
      }
    >
      <IconTile icon={{ name: 'circle-x' }} tone="danger" size="2xl" />
      <PageIntro
        title={t('teacher.payout.rejected.heading')}
        lede={t('teacher.payout.rejected.lede')}
      />
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        <View style={{ gap: tokens.space.half }}>
          <Text variant="callout" weight="bold">
            {t('teacher.payout.rejected.reasonLabel')}
          </Text>
          <Text variant="callout">
            {payout.rejectedReason ?? t('teacher.payout.rejected.reasonNone')}
          </Text>
        </View>
      </Banner>
      <View style={{ gap: tokens.space['2'] }}>
        {TIPS.map((tip) => (
          <View
            key={tip}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space['3'] }}
          >
            <Icon name="check" tone="primary" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="callout">{t(tip)}</Text>
            </View>
          </View>
        ))}
      </View>
    </StackScreen>
  );
}
