// T037: the router and the session guard. The paths are screens.md's for this phase (§17 the
// sign-in pages, §18 the home and the queues, the admins and the audit pages). Every route but
// `/set-password` passes the guard, which sends a
// session where `destinationFor` says (lib/session.ts) and follows the session as the client moves
// it on the server's refusals: cleared on UNAUTHENTICATED, to `/mfa` on MFA_REQUIRED, to
// `/mfa/setup` on MFA_SETUP_REQUIRED. An unknown path leads home, through the guard.
//
// T070: the sign-in pages are drawn. `/set-password`, the invite link's page, works by the token the
// link carries and not by a session, so it sits outside the guard, in the sign-in frame.
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
import { AuthLayout, ConsoleLayout, SetupLayout } from './pages/_layout/layouts';
import { ConsolePageShell } from './pages/_layout/shells';
import { AdminMfa } from './pages/mfa/AdminMfa';
import { AdminMfaRecovery } from './pages/mfa/AdminMfaRecovery';
import { AdminMfaSetup } from './pages/mfa/AdminMfaSetup';
import { AdminSetPassword, SET_PASSWORD_PATH } from './pages/set-password/AdminSetPassword';
import { AdminSignIn } from './pages/sign-in/AdminSignIn';

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
        <Route element={<AuthLayout />}>
          <Route path={SET_PASSWORD_PATH} element={<AdminSetPassword />} />
        </Route>
        <Route element={<Guard sessions={sessions} />}>
          <Route element={<AuthLayout />}>
            <Route path={AUTH_PATHS.signIn} element={<AdminSignIn />} />
            <Route path={AUTH_PATHS.mfa} element={<AdminMfa />} />
            <Route path={AUTH_PATHS.recovery} element={<AdminMfaRecovery />} />
          </Route>
          <Route element={<SetupLayout />}>
            <Route path={AUTH_PATHS.setup} element={<AdminMfaSetup />} />
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
