// T034: the (auth) route group, the sign-in and onboarding screens (T050, T051). A guard boundary: the root layout lets a session in
// only where `allows` says (lib/session.ts). Each screen draws its own header.
//
// T103: the group starts at Welcome. The guard's Redirect unmounts the navigator, and expo-router 58
// reseeds a group at its anchor, else at its first route by name length (`otp`); a sign-out or a
// deletion then lands on Welcome with nothing behind it, and a deep link has Welcome below it.
import { Stack } from 'expo-router';

// The route `WELCOME` in lib/session.ts names; the two must stay the same.
export const unstable_settings = { anchor: 'welcome' };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
