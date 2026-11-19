// T037: the router and the session guard. The paths are screens.md's for this phase (§17 the
// sign-in pages, §18 the home and the queues, the admins and the audit pages). Every route but
// `/set-password` passes the guard, which sends a
// session where `destinationFor` says (lib/session.ts) and follows the session as the client moves
// it on the server's refusals: cleared on UNAUTHENTICATED, to `/mfa` on MFA_REQUIRED, to
// `/mfa/setup` on MFA_SETUP_REQUIRED. An unknown path leads home, through the guard.
//
// T070: the sign-in pages are drawn. `/set-password`, the invite link's page, works by the token the
// link carries and not by a session, so it sits outside the guard, in the sign-in frame.
//
// T053: `/payments`, the read-only payments monitor, behind the same guard as every console page.
// 003:T105: `/payouts`, «تحويلات المعلمين», beside it; `?teacher=` opens one teacher's detail.
// 005:T022 (B49, Q-X2 (a)): `/ijazah-requests` (`?request=` opens one) and `/ijazahs` (`?ijazah=`).
// 005:T023 (B49): `/reports` (`?report=` opens one) and `/gender` (`?flag=`).
// 005:T024 (B49, Q-X2 (a)): `/settings`, every setting by group, beside `/settings/admins`.
//
// T071: the pages read through TanStack Query over the client (research R-113). One cache per App;
// a session that ends empties it, so what one administrator read is never shown to the next.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import { AdminAdmins } from './pages/settings/admins/AdminAdmins';
import { AdminApplications } from './pages/applications/AdminApplications';
import { AdminAudit } from './pages/audit/AdminAudit';
import { AdminCases } from './pages/cases/AdminCases';
import { AdminCredentials } from './pages/credentials/AdminCredentials';
import { AdminDisputes } from './pages/disputes/AdminDisputes';
import { AdminGender } from './pages/gender/AdminGender';
import { AdminHome } from './pages/home/AdminHome';
import { AdminIjazahRequests } from './pages/ijazah-requests/AdminIjazahRequests';
import { AdminIjazahs } from './pages/ijazahs/AdminIjazahs';
import { AdminMfa } from './pages/mfa/AdminMfa';
import { AdminMfaRecovery } from './pages/mfa/AdminMfaRecovery';
import { AdminMfaSetup } from './pages/mfa/AdminMfaSetup';
import { AdminOutages } from './pages/outages/AdminOutages';
import { AdminPayments } from './pages/payments/AdminPayments';
import { AdminPayouts } from './pages/payouts/AdminPayouts';
import { AdminReports } from './pages/reports/AdminReports';
import { AdminReview } from './pages/review/AdminReview';
import { AdminSessions } from './pages/sessions/AdminSessions';
import { AdminSetPassword, SET_PASSWORD_PATH } from './pages/set-password/AdminSetPassword';
import { AdminSettings } from './pages/settings/AdminSettings';
import { AdminSignIn } from './pages/sign-in/AdminSignIn';
import { AdminUsers } from './pages/users/AdminUsers';

function Guard({
  sessions,
  queries,
}: {
  readonly sessions: SessionStore;
  readonly queries: QueryClient;
}) {
  const session = useSession(sessions);
  useEffect(() => {
    if (session === null) queries.clear();
  }, [session, queries]);
  const { pathname } = useLocation();
  const destination = destinationFor(session, pathname);
  return destination === null ? <Outlet /> : <Navigate to={destination} replace />;
}

export interface AppProps {
  readonly client: AdminClient;
  readonly sessions: SessionStore;
  /** The query cache; one of the App's own unless a test hands one in. */
  readonly queries?: QueryClient;
}

/** The panel's cache: a read is not repeated on a refocus, and is retried once. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });
}

export function App({ client, sessions, queries: given }: AppProps) {
  const [own] = useState(createQueryClient);
  const queries = given ?? own;
  return (
    <QueryClientProvider client={queries}>
      <AdminProvider services={{ client, sessions }}>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path={SET_PASSWORD_PATH} element={<AdminSetPassword />} />
          </Route>
          <Route element={<Guard sessions={sessions} queries={queries} />}>
            <Route element={<AuthLayout />}>
              <Route path={AUTH_PATHS.signIn} element={<AdminSignIn />} />
              <Route path={AUTH_PATHS.mfa} element={<AdminMfa />} />
              <Route path={AUTH_PATHS.recovery} element={<AdminMfaRecovery />} />
            </Route>
            <Route element={<SetupLayout />}>
              <Route path={AUTH_PATHS.setup} element={<AdminMfaSetup />} />
            </Route>
            <Route element={<ConsoleLayout />}>
              <Route path={HOME_PATH} element={<AdminHome />} />
              <Route path="/applications" element={<AdminApplications />} />
              <Route path="/credentials" element={<AdminCredentials />} />
              {/* 005:T022 (B49): the ijazah requests and the ijazahs. */}
              <Route path="/ijazah-requests" element={<AdminIjazahRequests />} />
              <Route path="/ijazahs" element={<AdminIjazahs />} />
              <Route path="/payments" element={<AdminPayments />} />
              <Route path="/payouts" element={<AdminPayouts />} />
              <Route path="/sessions" element={<AdminSessions />} />
              <Route path="/review" element={<AdminReview />} />
              <Route path="/outages" element={<AdminOutages />} />
              <Route path="/disputes" element={<AdminDisputes />} />
              <Route path="/cases" element={<AdminCases />} />
              {/* 005:T023 (B49): the reports and the gender flags. */}
              <Route path="/reports" element={<AdminReports />} />
              <Route path="/gender" element={<AdminGender />} />
              <Route path="/users" element={<AdminUsers />} />
              {/* 005:T024 (B49): the settings page, which leads to the administrators. */}
              <Route path="/settings" element={<AdminSettings />} />
              <Route path="/settings/admins" element={<AdminAdmins />} />
              <Route path="/audit" element={<AdminAudit />} />
            </Route>
            <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
          </Route>
        </Routes>
      </AdminProvider>
    </QueryClientProvider>
  );
}
