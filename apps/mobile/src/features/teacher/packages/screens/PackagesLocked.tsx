// T034 (FR-202, FR-PROFILE-10): the packages tab before the payout account is verified
// (`PackagesLocked`): the locked banner over the empty list. The banner leads to the payout setup
// once B15 lands it; the package editor behind «باقة جديدة» arrives in Phase 2.
import { AppHeader, EmptyState, Banner } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';

export function PackagesLocked() {
  const t = useT();
  return (
    <TabScreen header={<AppHeader title={t('teacher.packages.title')} />}>
      <Banner icon={{ name: 'lock' }} tone="warning">
        {t('teacher.packages.lockedBanner')}
      </Banner>
      <EmptyState
        icon={{ name: 'layers' }}
        title={t('teacher.packages.empty.title')}
        text={t('teacher.packages.empty.text')}
      />
    </TabScreen>
  );
}
