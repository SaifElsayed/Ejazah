// T034: the (student) route group, the student's tabs and the screens they push. A guard boundary: the root layout lets a session in
// only where `allows` says (lib/session.ts). Each screen draws its own header.
import { Stack } from 'expo-router';

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
