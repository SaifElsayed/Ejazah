// T037: the router, the guard and AdminNav. The paths are screens.md's for this phase; the guard
// sends an absent or unverified session to `/sign-in`, `/mfa` or `/mfa/setup` by the code the server
// refused it with; the navigation renders this phase's entries only (FR-176).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { setLocale, translate } from './i18n';
import type { AdminClient } from './lib/client';
import { type AdminSession, createSessionStore, type SessionStore } from './lib/session';

afterEach(() => setLocale('ar'));

function fakeClient(sessions: SessionStore): AdminClient & { signOut: ReturnType<typeof vi.fn> } {
  return {
    api: {} as AdminClient['api'],
    untyped: {} as AdminClient['untyped'],
    signOut: vi.fn(async () => {
      sessions.clear();
    }),
  };
}

function renderAt(path: string, session: AdminSession | null = null) {
  const sessions = createSessionStore(() => window.sessionStorage);
  if (session !== null) sessions.write(session);
  const client = fakeClient(sessions);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App client={client} sessions={sessions} />
    </MemoryRouter>,
  );
  return { view, sessions, client };
}

const heading = (key: Parameters<typeof translate>[1]) =>
  screen.getByRole('heading', { level: 1, name: translate('ar', key) });

const verified = { token: 't', step: 'verified' } as const;

describe('the guard', () => {
  it('sends a visitor with no session to the sign-in page', () => {
    renderAt('/applications');
    expect(heading('admin.signIn.title')).toBeTruthy();
  });

  it('sends a session that owes its second factor to /mfa', () => {
    renderAt('/', { token: 't', step: 'mfa' });
    expect(heading('admin.mfa.title')).toBeTruthy();
  });

  it('sends a session never set up to the setup page', () => {
    renderAt('/audit', { token: 't', step: 'setup' });
    expect(heading('admin.mfaSetup.title')).toBeTruthy();
  });

  it('lets the second-factor session reach the recovery-code page', () => {
    renderAt('/mfa/recovery', { token: 't', step: 'mfa' });
    expect(heading('admin.mfaRecovery.title')).toBeTruthy();
  });

  it('takes a verified session from the sign-in page home', () => {
    renderAt('/sign-in', verified);
    expect(heading('admin.home.title')).toBeTruthy();
  });

  it('follows the session as the server moves it: refused, then owed a second factor', () => {
    const { sessions } = renderAt('/audit', verified);
    expect(heading('admin.audit.title')).toBeTruthy();
    act(() => sessions.setStep('mfa'));
    expect(heading('admin.mfa.title')).toBeTruthy();
    act(() => sessions.clear());
    expect(heading('admin.signIn.title')).toBeTruthy();
  });

  it('sends an unknown path home', () => {
    renderAt('/disputes', verified);
    expect(heading('admin.home.title')).toBeTruthy();
  });
});

describe('the pages of this phase', () => {
  it.each([
    ['/', 'admin.home.title'],
    ['/applications', 'admin.applications.title'],
    ['/credentials', 'admin.credentials.title'],
    ['/settings/admins', 'admin.admins.title'],
    ['/audit', 'admin.audit.title'],
  ] as const)('%s is in the console with its title', (path, title) => {
    const { view } = renderAt(path, verified);
    expect(heading(title)).toBeTruthy();
    expect(view.container.querySelector('.console > .sidebar + main.page')).not.toBeNull();
  });

  it.each([
    ['/sign-in', null, 'admin.signIn.title'],
    ['/mfa', { token: 't', step: 'mfa' }, 'admin.mfa.title'],
  ] as const)('%s is the centred card, with the language switch', (path, session, title) => {
    const { view } = renderAt(path, session);
    const card = view.container.querySelector('.console main.page .auth-card');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByRole('heading', { level: 1 }).textContent).toBe(
      translate('ar', title),
    );
    expect(
      screen.getByRole('group', { name: translate('ar', 'admin.nav.a11y.language') }),
    ).toBeTruthy();
  });
});

describe('AdminNav', () => {
  it('renders this phase’s entries only, in the drawn order and groups (FR-176)', () => {
    renderAt('/applications', verified);
    const sidebar = screen.getByRole('complementary', {
      name: translate('ar', 'admin.nav.a11y.panel'),
    });
    const groups = [...sidebar.querySelectorAll('.sidebar__group')].map((node) => node.textContent);
    expect(groups).toEqual([
      translate('ar', 'admin.nav.groups.queues'),
      translate('ar', 'admin.nav.groups.records'),
    ]);
    const entries = within(sidebar)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(entries).toEqual([
      [translate('ar', 'admin.nav.items.home'), '/'],
      [translate('ar', 'admin.nav.items.applications'), '/applications'],
      [translate('ar', 'admin.nav.items.credentials'), '/credentials'],
      // T053: the payments monitor, before the settings as the board orders the group.
      [translate('ar', 'admin.nav.items.payments'), '/payments'],
      [translate('ar', 'admin.nav.items.settings'), '/settings/admins'],
      [translate('ar', 'admin.nav.items.audit'), '/audit'],
    ]);
  });

  it('marks the current page, home only on its own path', () => {
    renderAt('/settings/admins', verified);
    const current = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current'));
    expect(current.map((link) => link.getAttribute('href'))).toEqual(['/settings/admins']);
  });

  it('navigates in place on a click', () => {
    renderAt('/', verified);
    fireEvent.click(screen.getByRole('link', { name: translate('ar', 'admin.nav.items.audit') }));
    expect(heading('admin.audit.title')).toBeTruthy();
  });

  it('switches the language and keeps the session and the page', () => {
    const { sessions, view } = renderAt('/audit', verified);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(
      screen.getByRole('heading', { level: 1, name: translate('en', 'admin.audit.title') }),
    ).toBeTruthy();
    expect(view.container.querySelector('.console')?.getAttribute('dir')).toBe('ltr');
    expect(sessions.read()).toEqual(verified);
  });

  it('signs out through the client and lands on the sign-in page', async () => {
    const { client } = renderAt('/audit', verified);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: translate('ar', 'admin.nav.a11y.signOut') }),
      );
    });
    expect(client.signOut).toHaveBeenCalledTimes(1);
    expect(heading('admin.signIn.title')).toBeTruthy();
  });
});
