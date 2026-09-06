// Root layout. The file tree IS the navigation tree; route groups are guard boundaries (plan.md).
// Wraps the theme and direction providers from design/theme.tsx. Arrives with Phase 1.
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack />;
}
