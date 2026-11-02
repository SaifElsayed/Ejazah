// T034 (FR-202): discovery before any teacher is available to the student (`DiscoveryNoTeachers`):
// no search and no section tabs, there is nothing to filter. T029: «تحديث» reads discovery again
// while the tab of all subjects counts none (FR-332).
import { AppHeader, EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';

export function DiscoveryNoTeachers({ onRefresh }: { readonly onRefresh?: () => void }) {
  const t = useT();
  return (
    <TabScreen header={<AppHeader title={t('student.discovery.title')} />}>
      <EmptyState
        icon={{ name: 'users' }}
        title={t('student.discovery.noTeachers.title')}
        text={t('student.discovery.noTeachers.text')}
        {...(onRefresh === undefined
          ? {}
          : { action: { label: t('student.discovery.noTeachers.refresh'), onPress: onRefresh } })}
      />
    </TabScreen>
  );
}
