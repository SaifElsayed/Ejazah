// T034: the teacher's tab bar (screens.md `TeacherTabs`): the active tab root above one TabBar of five
// items. The teacher bar navigates. The tab roots of this phase hold no state, so the active one renders in a Slot;
// the top inset is drawn here once for every tab root. T058: an approved teacher who has not yet
// seen `ApplicationApproved` is sent to it once (FR-152), from here, where an approval lands.
import { Slot, useSegments } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar } from '../../../design/primitives';
import { useTheme } from '../../../design/theme';
import { ApprovedOnce } from '../../../features/teacher/application';
import { useT } from '../../../i18n';

export default function TabsLayout() {
  const t = useT();
  const { color } = useTheme();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const items = [
    {
      route: '/(teacher)/(tabs)',
      label: t('teacher.tabs.today'),
      icon: { name: 'calendar' as const },
    },
    {
      route: '/(teacher)/(tabs)/students',
      label: t('teacher.tabs.students'),
      icon: { name: 'users' as const },
    },
    {
      route: '/(teacher)/(tabs)/availability',
      label: t('teacher.tabs.availability'),
      icon: { name: 'clock' as const },
    },
    {
      route: '/(teacher)/(tabs)/packages',
      label: t('teacher.tabs.packages'),
      icon: { name: 'layers' as const },
    },
    {
      route: '/(teacher)/(tabs)/account',
      label: t('teacher.tabs.account'),
      icon: { name: 'user' as const },
    },
  ];
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: color.bg }}>
      <View style={{ flex: 1 }}>
        <Slot />
      </View>
      <TabBar items={items} activeRoute={`/${segments.join('/')}`} />
      <ApprovedOnce />
    </View>
  );
}
