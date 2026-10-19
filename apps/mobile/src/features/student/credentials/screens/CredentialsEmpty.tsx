// T034 (FR-202): the ijazahs tab before the first ijazah (`CredentialsEmpty`), leading to the enrollments.
import { router } from 'expo-router';

import { AppHeader, EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';

export function CredentialsEmpty() {
  const t = useT();
  return (
    <TabScreen header={<AppHeader title={t('student.credentials.title')} />}>
      <EmptyState
        icon={{ name: 'award' }}
        title={t('student.credentials.empty.title')}
        text={t('student.credentials.empty.text')}
        action={{
          label: t('student.credentials.empty.action'),
          onPress: () => router.navigate('/(student)/(tabs)/enrollments'),
        }}
      />
    </TabScreen>
  );
}
