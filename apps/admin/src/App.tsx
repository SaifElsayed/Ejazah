// T037: the router and the session guard. The paths are screens.md's for this phase (§17 the
// sign-in pages, §18 the home and the queues, the admins and the audit pages); `/set-password`, the
// invite link's page, lands with its page (T070). Every route passes the guard, which sends a
// session where `destinationFor` says (lib/session.ts) and follows the session as the client moves
// it on the server's refusals: cleared on UNAUTHENTICATED, to `/mfa` on MFA_REQUIRED, to
// `/mfa/setup` on MFA_SETUP_REQUIRED. An unknown path leads home, through the guard.
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';

import { AdminProvider } from './lib/admin-context';
import type { AdminClient } from './lib/client';
import {
  AUTH_PATHS,
  destinationFor,
  HOME_PATH,
  type SessionStore,
  useSession,
} from './lib/session';
import { AuthLayout, ConsoleLayout } from './pages/_layout/layouts';
import { AuthPageShell, ConsolePageShell } from './pages/_layout/shells';

function Guard({ sessions }: { readonly sessions: SessionStore }) {
  const session = useSession(sessions);
  const { pathname } = useLocation();
  const destination = destinationFor(session, pathname);
  return destination === null ? <Outlet /> : <Navigate to={destination} replace />;
}

export interface AppProps {
  readonly client: AdminClient;
  readonly sessions: SessionStore;
}

export function App({ client, sessions }: AppProps) {
  return (
    <AdminProvider services={{ client, sessions }}>
      <Routes>
        <Route element={<Guard sessions={sessions} />}>
          <Route element={<AuthLayout />}>
            <Route
              path={AUTH_PATHS.signIn}
              element={<AuthPageShell title="admin.signIn.title" />}
            />
            <Route path={AUTH_PATHS.mfa} element={<AuthPageShell title="admin.mfa.title" />} />
            <Route
              path={AUTH_PATHS.recovery}
              element={<AuthPageShell title="admin.mfaRecovery.title" />}
            />
            <Route
              path={AUTH_PATHS.setup}
              element={<AuthPageShell title="admin.mfaSetup.title" />}
            />
          </Route>
          <Route element={<ConsoleLayout />}>
            <Route path={HOME_PATH} element={<ConsolePageShell title="admin.home.title" />} />
            <Route
              path="/applications"
              element={<ConsolePageShell title="admin.applications.title" />}
            />
            <Route
              path="/credentials"
              element={<ConsolePageShell title="admin.credentials.title" />}
            />
            <Route
              path="/settings/admins"
              element={<ConsolePageShell title="admin.admins.title" />}
            />
            <Route path="/audit" element={<ConsolePageShell title="admin.audit.title" />} />
          </Route>
          <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
        </Route>
      </Routes>
    </AdminProvider>
  );
}
