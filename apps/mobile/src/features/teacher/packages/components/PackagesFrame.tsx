// T021 (FR-311, FR-315): what every state of the packages tab shares (screens.md §13): the header
// with «باقة جديدة», its one primary action; over cached data the offline banner (002:T138); and
// while the teacher is not published the warning to the payout. Since B15 (T078) the warning leads
// to the payout, which draws the screen of its state (pending or rejected alike); a tappable warning
// is a warning card, as the application's request for a document is (R-MOBILE-6).
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { AppHeader, Button, Card, Icon, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';
import { OfflineNotice } from '../../../shared/states';
import { PAYOUT_ROUTE } from '../../payout';

/** The editor of package `id`, or of a new one (`new`). */
export function openPackageEditor(id: string): void {
  router.push({ pathname: '/(teacher)/packages/[id]', params: { id } });
}

export function PackagesFrame({
  published,
  onRetry,
  children,
}: {
  /** Whether students see the teacher's packages; the warning shows while they do not (FR-315). */
  readonly published: boolean;
  /** With cached data, the offline banner's retry. */
  readonly onRetry?: () => void;
  readonly children: ReactNode;
}) {
  const t = useT();
  return (
    <TabScreen
      header={
        <AppHeader
          title={t('teacher.packages.title')}
          actions={
            <Button
              label={t('teacher.packages.new')}
              size="md"
              icon={{ name: 'plus' }}
              onPress={() => openPackageEditor('new')}
            />
          }
        />
      }
    >
      {onRetry === undefined ? null : <OfflineNotice onRetry={onRetry} />}
      {published ? null : (
        <Card variant="warning" onPress={() => router.push(PAYOUT_ROUTE)}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space['3'] }}>
            <Icon name="lock" size="sm" tone="warning" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="caption">{t('teacher.packages.lockedBanner')}</Text>
            </View>
          </View>
        </Card>
      )}
      {children}
    </TabScreen>
  );
}
