// T034: the (student) route group, the student's tabs and the screens they push. A guard boundary: the root layout lets a session in
// only where `allows` says (lib/session.ts). Each screen draws its own header. The tabs draw the
// device's top inset in their own layout; the account's pushed screens (T084) and the teacher's
// profile (T030) take the device's insets here.
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const FRAMED = ['account/profile', 'account/delete', 'discovery/[teacherId]'] as const;

export default function Layout() {
  const insets = useSafeAreaInsets();
  const framed = { contentStyle: { paddingTop: insets.top, paddingBottom: insets.bottom } };
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {FRAMED.map((name) => (
        <Stack.Screen key={name} name={name} options={framed} />
      ))}
    </Stack>
  );
}
