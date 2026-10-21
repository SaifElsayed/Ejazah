// T034: the (auth) route group, the sign-in and onboarding screens (T050, T051). A guard boundary: the root layout lets a session in
// only where `allows` says (lib/session.ts). Each screen draws its own header.
import { Stack } from 'expo-router';

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
