// T034: the root layout. The file tree is the navigation tree; the route groups are the guard's
// boundaries (plan.md). Providers, outermost first: theme, direction (from the locale, i18n/), the
// query cache, the API client; then the session guard, which lands the person by the session's
// `landing` (lib/session.ts) and lets a route the session allows render.
//
// T052 (B10b): a stored or new session lands where `account.me` says (`landing`, the server's rule,
// and the application's status for an applicant), and the device's zone is reported once per
// launch when it is one a person lives by and differs from the account's (FR-131, FR-AUTH-10; the
// server keeps a zone chosen by hand). The routes are a stack: `time-zone` and `terms` are modals
// whose back arrow dismisses (screens.md "Routing"); the sign-in screens and the two modals take the
// device's insets here, the tab groups in their own layouts.
//
// T074: `restricted` and `verify-identity` sit outside the role groups and take the insets here.
//
// T136: a session that ends (a sign-out, the account's deletion) leaves nothing typed behind on the
// phone: the teacher's application draft (its `reapply` mode with it), the onboarding draft and the
// pending address with its password are cleared with the query cache.
//
// T138 (FR-205): NetInfo drives the query cache's connection (lib/online.ts), once per process as
// TanStack's React Native guide does; with no connection `account.me` waits, so the launch says it
// cannot load rather than waiting on a blank screen.
//
// T015 (R-217, FR-383): AppState drives the query cache's focus (lib/focus.ts), once per process
// beside NetInfo, so stale queries read again when the app comes back to the foreground.
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useSegments } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Button } from '../design/primitives';
import { DirectionProvider, ThemeProvider, useTheme } from '../design/theme';
import { tokens } from '../design/tokens';
import { clearPendingEmail } from '../features/shared/auth/pending';
import { clearDraft as clearOnboardingDraft } from '../features/shared/onboarding/draft';
import { clearApplication } from '../features/teacher/application/draft';
import { useT } from '../i18n';
import { ME_QUERY_KEY, useMe } from '../lib/account';
import { ApiProvider, useApi } from '../lib/api';
import { followAppState } from '../lib/focus';
import { followNetInfo } from '../lib/online';
import {
  allows,
  destinationFor,
  getSession,
  type SessionState,
  setSession,
  signedInAs,
  useSession,
} from '../lib/session';
import { deviceTimeZone } from '../lib/time-zone';

followNetInfo();
followAppState();

export default function RootLayout() {
  const [queries] = useState(() => new QueryClient());
  return (
    <ThemeProvider>
      <DirectionProvider>
        <QueryClientProvider client={queries}>
          <ApiProvider>
            <SessionGuard queries={queries} />
          </ApiProvider>
        </QueryClientProvider>
      </DirectionProvider>
    </ThemeProvider>
  );
}

function SessionGuard({ queries }: { readonly queries: QueryClient }) {
  const session = useSession();
  const segments = useSegments();
  useRestoreSession();
  const me = useLanding();
  // What one account read is never shown to the next on a shared device (review of B6, finding 4),
  // nor what one person typed: every draft, and the pending address with its password (T136).
  useEffect(() => {
    if (session.kind !== 'signed-out') return;
    queries.clear();
    clearApplication();
    clearOnboardingDraft();
    clearPendingEmail();
  }, [session.kind, queries]);
  const destination = destinationFor(session);
  if (destination === null) {
    return me.isError || me.isPaused ? (
      <LaunchFailed onRetry={() => void me.refetch()} />
    ) : (
      <Waiting />
    );
  }
  if (!allows(session, segments)) return <Redirect href={destination as never} />;
  return <Routes />;
}

/** The stack of every route; the modals and the sign-in screens take the device's insets. */
function Routes() {
  const insets = useSafeAreaInsets();
  const { color } = useTheme();
  const framed = {
    contentStyle: {
      paddingTop: insets.top,
      paddingBottom: insets.bottom,
      backgroundColor: color.bg,
    },
  };
  // An iOS modal is a sheet below the status bar, so it needs no top inset of its own.
  const modal = {
    presentation: 'modal' as const,
    contentStyle: {
      ...framed.contentStyle,
      paddingTop: Platform.OS === 'ios' ? 0 : insets.top,
    },
  };
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" options={framed} />
      <Stack.Screen name="restricted" options={framed} />
      <Stack.Screen name="verify-identity" options={framed} />
      <Stack.Screen name="time-zone" options={modal} />
      <Stack.Screen name="terms" options={modal} />
    </Stack>
  );
}

/**
 * At launch, from the stored tokens: none is a signed-out person; tokens are a session whose
 * landing `account.me` answers, so the guard waits meanwhile.
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

/** Lands a session by `account.me`, and reports the device's zone once per launch (T052). */
function useLanding() {
  const session = useSession();
  const me = useMe();
  const { client } = useApi();
  const queries = useQueryClient();
  const reported = useRef(false);
  const account = me.data;

  useEffect(() => {
    if (account === undefined) return;
    if (session.kind !== 'restoring' && session.kind !== 'signed-in') return;
    const next = signedInAs(account);
    if (!sameState(getSession(), next)) setSession(next);
  }, [account, session.kind]);

  useEffect(() => {
    if (session.kind === 'signed-out') reported.current = false;
    if (account === undefined || reported.current || account.landing === 'restricted') return;
    reported.current = true;
    const device = deviceTimeZone();
    if (device === null || device === account.timezone) return;
    void client.api.account.reportDeviceTimezone
      .mutate({ timezone: device })
      .then(() => queries.invalidateQueries({ queryKey: ME_QUERY_KEY }))
      .catch(() => undefined);
  }, [account, session.kind, client, queries]);

  return me;
}

function sameState(a: SessionState, b: SessionState): boolean {
  if (a.kind !== 'signed-in' || b.kind !== 'signed-in') return a.kind === b.kind;
  if (a.landing === 'teacher_application' && b.landing === 'teacher_application') {
    return a.applicationStatus === b.applicationStatus;
  }
  return a.landing === b.landing;
}

/** The launch surface while the session is not known: the background, nothing to press. */
function Waiting() {
  const { color } = useTheme();
  return <View style={{ flex: 1, backgroundColor: color.bg }} />;
}

/** The launch when `account.me` could not be read (offline, the server down): say so, retry. */
function LaunchFailed({ onRetry }: { readonly onRetry: () => void }) {
  const t = useT();
  const { color } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        gap: tokens.space['3'],
        paddingHorizontal: tokens.layout.gutter,
        backgroundColor: color.bg,
      }}
    >
      <Banner icon={{ name: 'wifi-off' }} tone="danger">
        {t('common.state.loadError')}
      </Banner>
      <Button label={t('common.action.retry')} variant="secondary" onPress={onRetry} />
    </View>
  );
}
