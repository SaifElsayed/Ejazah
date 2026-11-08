// T019 of specs/004-sessions (FR-433, FR-435): the `(student)/sessions/room` route, the room of the
// session the pre-session screen names in `id`. The screen takes the device's insets here, as the
// pre-session route does.
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Room } from '../../../features/student/sessions';

export default function Route() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <Room />
    </View>
  );
}
