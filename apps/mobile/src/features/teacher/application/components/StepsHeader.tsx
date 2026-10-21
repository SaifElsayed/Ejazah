// T058: the head of the three application steps (`ApplySubjects`, `ApplyDocuments`, `ApplyIjazah`):
// the back arrow where there is a screen to go back to (a first application starts here after the
// onboarding, with none), and the three-step indicator.
import { router } from 'expo-router';
import { View } from 'react-native';

import { Steps } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { BackBar } from '../../../shared/screen';

export function StepsHeader({ current }: { readonly current: 0 | 1 | 2 }) {
  const t = useT();
  const steps = [
    t('teacher.application.steps.subjects'),
    t('teacher.application.steps.documents'),
    t('teacher.application.steps.ijazahs'),
  ];
  return (
    <View style={{ gap: tokens.space['3'], paddingBottom: tokens.space['2'] }}>
      {router.canGoBack() ? (
        <BackBar onPress={() => router.back()} />
      ) : (
        <View style={{ height: tokens.space['4'] }} />
      )}
      <View
        accessibilityLabel={t('teacher.application.steps.a11y')}
        style={{ paddingHorizontal: tokens.layout.gutter }}
      >
        <Steps steps={steps} current={current} />
      </View>
    </View>
  );
}
