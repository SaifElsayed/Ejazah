// T034 (FR-202), T051: the students tab before the first booking (`TeacherStudentsEmpty`), leading to
// the packages. No search field; the two tabs without counts, «منتهية» opening the ended ones.
import { router } from 'expo-router';

import { AppHeader, EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';
import { StudentTabs } from '../components/StudentList';

export function TeacherStudentsEmpty() {
  const t = useT();
  return (
    <TabScreen header={<AppHeader title={t('teacher.students.title')} />}>
      <StudentTabs tab="active" />
      <EmptyState
        icon={{ name: 'users' }}
        title={t('teacher.students.empty.title')}
        text={t('teacher.students.empty.text')}
        action={{
          label: t('teacher.students.empty.packages'),
          onPress: () => router.navigate('/(teacher)/(tabs)/packages'),
        }}
      />
    </TabScreen>
  );
}
