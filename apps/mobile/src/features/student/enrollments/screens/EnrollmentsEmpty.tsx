// T034 (FR-202): the enrollments tab before the first booking (`EnrollmentsEmpty`), leading to discovery.
import { router } from 'expo-router';

import { AppHeader, EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';

export function EnrollmentsEmpty() {
  const t = useT();
  return (
    <TabScreen header={<AppHeader title={t('student.enrollments.title')} />}>
      <EmptyState
        icon={{ name: 'book' }}
        title={t('student.enrollments.empty.title')}
        text={t('student.enrollments.empty.text')}
        action={{
          label: t('student.enrollments.empty.action'),
          onPress: () => router.navigate('/(student)/(tabs)/discovery'),
        }}
      />
    </TabScreen>
  );
}
