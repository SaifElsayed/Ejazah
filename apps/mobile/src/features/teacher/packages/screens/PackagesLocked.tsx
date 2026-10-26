// T034 (FR-202, FR-PROFILE-10): the packages tab before the payout account is verified
// (`PackagesLocked`): the locked banner over the empty list. Since B15 (T078) the banner leads to
// the payout, which draws the screen of its state (pending or rejected alike); a tappable warning
// is a warning card, as the application's request for a document is (R-MOBILE-6). The package
// editor behind «باقة جديدة» arrives in Phase 2.
import { router } from 'expo-router';
import { View } from 'react-native';

import { AppHeader, Card, EmptyState, Icon, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';
import { PAYOUT_ROUTE } from '../../payout';

export function PackagesLocked() {
  const t = useT();
  return (
    <TabScreen header={<AppHeader title={t('teacher.packages.title')} />}>
      <Card variant="warning" onPress={() => router.push(PAYOUT_ROUTE)}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space['3'] }}>
          <Icon name="lock" size="sm" tone="warning" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="caption">{t('teacher.packages.lockedBanner')}</Text>
          </View>
        </View>
      </Card>
      <EmptyState
        icon={{ name: 'layers' }}
        title={t('teacher.packages.empty.title')}
        text={t('teacher.packages.empty.text')}
      />
    </TabScreen>
  );
}
