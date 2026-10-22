// T037: the frames a page sits in. A console page: the sidebar at the start and the page beside it
// (AdminHome and every queue board). A sign-in page: the language switch at the top and the centred
// card (AdminSignIn, AdminMfa, AdminMfaRecovery, and the invite link's page). T070: the setup page
// is wider than a card, so its frame is a page whose header holds the brand and the language switch
// (AdminMfaSetup).
import { Outlet } from 'react-router';

import { Brand, Console, LanguageSwitch } from '../../design/components';
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

export function SetupLayout() {
  const locale = useLocale();
  return (
    <Console>
      <main className="page">
        <header className="page-header">
          <Brand />
          <LanguageSwitch locale={locale} inline />
        </header>
        <div className="page-body">
          <Outlet />
        </div>
      </main>
    </Console>
  );
}
