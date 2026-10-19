// T034 (FR-202): the teacher's day with no session (`TeacherHomeEmpty`), leading to the
// availability. The day's summary, its navigation and the next session's sentence are data and
// arrive with the teacher's home in Phase 2.
import { router } from 'expo-router';

import { AppHeader, EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';

export function TeacherHomeEmpty() {
  const t = useT();
  return (
    <TabScreen header={<AppHeader title={t('teacher.today.title')} />}>
      <EmptyState
        icon={{ name: 'calendar' }}
        title={t('teacher.today.empty.title')}
        action={{
          label: t('teacher.today.empty.availability'),
          onPress: () => router.navigate('/(teacher)/(tabs)/availability'),
        }}
      />
    </TabScreen>
  );
}
