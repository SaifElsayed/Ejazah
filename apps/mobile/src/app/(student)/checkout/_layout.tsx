// T045: the checkout's routes in one stack: T045's `index`, `expired` and `previous` and T046's
// `processing`, `confirmed`, `failed` and `slot-unavailable`. Each screen draws its own header and
// takes the device's insets here, as the (student) group's pushed screens do.
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Layout() {
  const insets = useSafeAreaInsets();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { paddingTop: insets.top, paddingBottom: insets.bottom },
      }}
    />
  );
}
