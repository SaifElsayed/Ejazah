// T021 (FR-311, FR-315): what every state of the packages tab shares (screens.md §13): the header
// with «باقة جديدة», its one primary action; over cached data the offline banner (002:T138); and
// while the teacher is not published the warning to the payout (`UnpublishedBanner`, which the
// availability tab draws too since T069).
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import { AppHeader, Button } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';
import { OfflineNotice } from '../../../shared/states';
import { UnpublishedBanner } from './Unpublished';

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
      {published ? null : <UnpublishedBanner text={t('teacher.packages.lockedBanner')} />}
      {children}
    </TabScreen>
  );
}
