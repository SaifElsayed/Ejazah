// T034 (FR-202): discovery before any teacher is available to the student (`DiscoveryNoTeachers`):
// no search and no section tabs, there is nothing to filter. The refresh is a data path and arrives
// with discovery in Phase 2.
import { AppHeader, EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';

export function DiscoveryNoTeachers() {
  const t = useT();
  return (
    <TabScreen header={<AppHeader title={t('student.discovery.title')} />}>
      <EmptyState
        icon={{ name: 'users' }}
        title={t('student.discovery.noTeachers.title')}
        text={t('student.discovery.noTeachers.text')}
      />
    </TabScreen>
  );
}
