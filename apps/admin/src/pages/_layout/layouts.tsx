// T037: the frames a page sits in. A console page: the sidebar at the start and the page beside it
// (AdminHome and every queue board). A sign-in page: the language switch at the top and the centred
// card (AdminSignIn, AdminMfa, AdminMfaRecovery, and the invite link's page). T070: the setup page
// is wider than a card, so its frame is a page whose header holds the brand and the language switch
// (AdminMfaSetup).
//
// 003:T109 (SRS DEC-87; Q-B4 (a)): a console page draws «نسخة تجريبية» at its top while the server's
// payment mode is `test`, read from `home.summary`, the one read the sidebar already makes; nothing in
// `live` or while unread. It never takes a click.
import { Outlet } from 'react-router';

import { Badge, Brand, Console, LanguageSwitch } from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { useHomeSummary } from '../home/queries';
import { AdminNav } from './AdminNav';

export function ConsoleLayout() {
  return (
    <Console>
      <AdminNav />
      <Outlet />
      <TestModeStrip />
    </Console>
  );
}

/** 003:T109: over the console's top, centred; the console frame is `position: relative`. */
function TestModeStrip() {
  const t = useT();
  const mode = useHomeSummary().data?.paymentMode;
  if (mode !== 'test') return null;
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        // 003:T116, nit 2 (c'): the spacing token; the z-index waits for the design revision (T119).
        insetBlockStart: 'var(--space-2)',
        insetInline: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <Badge label={t('admin.money.testMode')} tone="warning" />
    </div>
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
