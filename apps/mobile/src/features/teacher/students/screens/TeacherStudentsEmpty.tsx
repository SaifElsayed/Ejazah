// T034 (FR-202): the students tab before the first booking (`TeacherStudentsEmpty`), leading to
// the packages. The active and ended tabs arrive with the students list in Phase 2.
import { router } from 'expo-router';

import { AppHeader, EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';

export function TeacherStudentsEmpty() {
  const t = useT();
  return (
    <TabScreen header={<AppHeader title={t('teacher.students.title')} />}>
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
