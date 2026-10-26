// T034: the (teacher) route group, the teacher's application, tabs and the screens they push. A guard boundary: the root layout lets a session in
// only where `allows` says (lib/session.ts). Each screen draws its own header. The tabs draw the
// device's top inset in their own layout; the application's steps and status (T058), the
// credentials pages (T059), the payout screens (T078) and the deletion (T084) take the device's
// insets here.
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const FRAMED = [
  'application/subjects',
  'application/documents',
  'application/ijazahs',
  'application/status',
  'application/more-info',
  'credentials/index',
  'credentials/[id]',
  'credentials/add',
  'payout/index',
  'payout/start',
  'account/delete',
] as const;

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
