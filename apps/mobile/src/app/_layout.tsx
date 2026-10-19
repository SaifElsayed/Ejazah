// T034: the root layout. The file tree is the navigation tree; the route groups are the guard's
// boundaries (plan.md). Providers, outermost first: theme, direction (from the locale, i18n/), the
// query cache, the API client; then the session guard, which lands the person by the session's
// `landing` (lib/session.ts) and lets a route the session allows render.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Redirect, Slot, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { DirectionProvider, ThemeProvider, useTheme } from '../design/theme';
import { ApiProvider, useApi } from '../lib/api';
import { allows, destinationFor, getSession, setSession, useSession } from '../lib/session';

export default function RootLayout() {
  const [queries] = useState(() => new QueryClient());
  return (
    <ThemeProvider>
      <DirectionProvider>
        <QueryClientProvider client={queries}>
          <ApiProvider>
            <SessionGuard />
          </ApiProvider>
        </QueryClientProvider>
      </DirectionProvider>
    </ThemeProvider>
  );
}

function SessionGuard() {
  const session = useSession();
  const segments = useSegments();
  useRestoreSession();
  const destination = destinationFor(session);
  if (destination === null) return <Waiting />;
  if (!allows(session, segments)) return <Redirect href={destination as never} />;
  return <Slot />;
}

/**
 * At launch, from the stored tokens: none is a signed-out person; tokens are a session whose
 * landing `account.me` answers (wired in B10, T049/T052), so the guard waits meanwhile.
 */
function useRestoreSession(): void {
  const { sessions } = useApi();
  useEffect(() => {
    if (getSession().kind !== 'unknown') return;
    let cancelled = false;
    void sessions.read().then((tokens) => {
      if (!cancelled) setSession(tokens === null ? { kind: 'signed-out' } : { kind: 'restoring' });
    });
    return () => {
      cancelled = true;
    };
  }, [sessions]);
}

/** The launch surface while the session is not known: the background, nothing to press. */
function Waiting() {
  const { color } = useTheme();
  return <View style={{ flex: 1, backgroundColor: color.bg }} />;
}
