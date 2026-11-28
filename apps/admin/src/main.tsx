// T037: the panel's entry. It reads the language the browser keeps (T035), creates the one session
// store over the tab's sessionStorage and the one client for the administrator surface, and renders
// the router. It consumes only the administrator surface (`/admin/trpc`): an admin capability is
// unreachable from the phone and an app procedure from here (ADR 0014 D3).
//
// `VITE_API_URL` is the API's origin, read by Vite at build time; the panel refuses to start
// without it, rather than call a guessed host.
//
// R3 T183 (Q-5 (a)): crash reports start first, off unless the build carries `VITE_SENTRY_DSN`
// (lib/reporting.ts); they follow the tab's session for the administrator's id, and a render error
// anywhere in the App shows the crash page (pages/_layout/CrashBoundary.tsx).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './App';
import { loadStoredLocale } from './i18n';
import { createAdminClient } from './lib/client';
import { followReportingUser, initReporting } from './lib/reporting';
import { createSessionStore } from './lib/session';
import { CrashBoundary } from './pages/_layout/CrashBoundary';

initReporting();

const apiUrl = import.meta.env.VITE_API_URL;
if (apiUrl === undefined || apiUrl === '') {
  throw new Error('admin: VITE_API_URL is not set; it names the API the panel calls');
}

const root = document.getElementById('root');
if (root === null) throw new Error('admin: index.html has no #root');

loadStoredLocale();
const sessions = createSessionStore(() => window.sessionStorage);
const client = createAdminClient({ url: `${apiUrl.replace(/\/+$/, '')}/admin/trpc`, sessions });
followReportingUser(sessions, async () => (await client.api.auth.me.query()).adminId);

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <CrashBoundary>
        <App client={client} sessions={sessions} />
      </CrashBoundary>
    </BrowserRouter>
  </StrictMode>,
);
