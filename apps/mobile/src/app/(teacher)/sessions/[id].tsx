// T018 of specs/004-sessions (FR-434): the `(teacher)/sessions/[id]` route, the pre-session screen.
// The screen takes the device's insets here, as the group's other pushed screens take them in
// `(teacher)/_layout.tsx`.
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TeacherPreSession } from '../../../features/teacher/sessions';

export default function Route() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <TeacherPreSession />
    </View>
  );
}
