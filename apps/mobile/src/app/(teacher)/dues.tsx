// 003:T105 (DEC-89): the `(teacher)/dues` route, «مستحقاتي». The screen takes the device's insets
// here, as `(teacher)/sessions/[id].tsx` does, beside the group's framed screens.
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TeacherDues } from '../../features/teacher/dues';

export default function Route() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <TeacherDues />
    </View>
  );
}
