// T037: the two frames a page sits in. A console page: the sidebar at the start and the page beside
// it (AdminHome and every queue board). A sign-in page: the language switch at the top and the
// centred card (AdminSignIn, AdminMfa, AdminMfaRecovery, AdminMfaSetup).
import { Outlet } from 'react-router';

import { Console, LanguageSwitch } from '../../design/components';
import { useLocale } from '../../i18n';
import { AdminNav } from './AdminNav';

export function ConsoleLayout() {
  return (
    <Console>
      <AdminNav />
      <Outlet />
    </Console>
  );
}

export function AuthLayout() {
  const locale = useLocale();
  return (
    <Console>
      <main className="page">
        <header className="page-header">
          <div className="stack grow items-end">
            <LanguageSwitch locale={locale} inline />
          </div>
        </header>
        <div className="grow row row--center items-center">
          <Outlet />
        </div>
      </main>
    </Console>
  );
}
