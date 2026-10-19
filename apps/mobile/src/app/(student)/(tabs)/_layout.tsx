// T034: the student's tab bar (screens.md `StudentTabs`): the active tab root above one TabBar of five
// items. The student bar guides. The tab roots of this phase hold no state, so the active one renders in a Slot;
// the top inset is drawn here once for every tab root.
import { Slot, useSegments } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar } from '../../../design/primitives';
import { useTheme } from '../../../design/theme';
import { useT } from '../../../i18n';

export default function TabsLayout() {
  const t = useT();
  const { color } = useTheme();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const items = [
    { route: '/(student)/(tabs)', label: t('student.tabs.home'), icon: { name: 'house' as const } },
    {
      route: '/(student)/(tabs)/discovery',
      label: t('student.tabs.explore'),
      icon: { name: 'search' as const },
    },
    {
      route: '/(student)/(tabs)/enrollments',
      label: t('student.tabs.enrollments'),
      icon: { name: 'book' as const },
    },
    {
      route: '/(student)/(tabs)/credentials',
      label: t('student.tabs.credentials'),
      icon: { name: 'award' as const },
    },
    {
      route: '/(student)/(tabs)/account',
      label: t('student.tabs.account'),
      icon: { name: 'user' as const },
    },
  ];
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: color.bg }}>
      <View style={{ flex: 1 }}>
        <Slot />
      </View>
      <TabBar items={items} activeRoute={`/${segments.join('/')}`} />
    </View>
  );
}
