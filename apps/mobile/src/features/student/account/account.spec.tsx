// T052 (FR-131, FR-AUTH-5, FR-AUTH-10, FR-GENDER-5, FR-AUTH-7): the student's account tab against
// the board, from `account.me`. The language switches in place and on the account, the zone row
// says the city (and «من الجهاز» while it follows the device), the gender is read only, and sign-out
// asks first, then revokes the device's session and lands on the welcome screen. Since B16 (T084)
// the profile row opens the profile editor and the danger row the deletion; the notifications wait
// for their phase.
import type { MeOutput } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { getLocale, type MessageKey, setLocale, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { getSession, setSession } from '../../../lib/session';
import { apiError, fakeApi, tokens } from '../../shared/__tests__/api-double';
import { StudentAccount } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (route: unknown) => mockNavigate(route) },
}));

// The tab leads to the deletion, whose proof loads the providers' native modules (T084).
jest.mock('../../shared/auth/providers', () => ({ nativeIdentity: jest.fn() }));

let mockDeviceZone: string | null = 'Africa/Cairo';
jest.mock('../../../lib/time-zone', () => ({ deviceTimeZone: () => mockDeviceZone }));

const me: MeOutput = {
  userId: '0193a6f0-0000-7000-8000-000000000001',
  role: 'student',
  displayName: 'أمل حسن',
  email: 'amal@example.com',
  gender: 'female',
  dateOfBirth: '2004-03-12',
  preferredLanguage: 'ar',
  timezone: 'Africa/Cairo',
  signInMethod: 'google',
  memberSince: '2026-02-02T09:00:00Z',
  accountStatus: 'active',
  landing: 'student_home',
};

const said = (direction: 'rtl' | 'ltr', key: MessageKey, values?: Record<string, string>) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const ar = (key: MessageKey, values?: Record<string, string>) => translate('ar', key, values);

function withAccount(account: MeOutput | null = me) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (account !== null) {
    queries.setQueryData(ME_QUERY_KEY, account);
    mockApi.api.account.me.query.mockResolvedValue(account);
  }
  return () => (
    <QueryClientProvider client={queries}>
      <StudentAccount />
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  mockApi = fakeApi();
  mockApi.api.account.me.query.mockResolvedValue(me);
  await mockApi.sessions.store.write(tokens);
  mockNavigate.mockReset();
  mockDeviceZone = 'Africa/Cairo';
  setSession({ kind: 'signed-in', landing: 'student_home' });
});

describe('StudentAccount', () => {
  it('draws the profile row and the settings from the account, in both languages', async () => {
    await inBothDirections(withAccount(), (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'account.title'))).toBeTruthy();
      expect(screen.getByText('أمل حسن')).toBeTruthy();
      // An address is an isolated left-to-right run inside the sentence's direction.
      expect(screen.getByText(/amal@example.com/)).toBeTruthy();
      const date = direction === 'rtl' ? '2 فبراير 2026' : 'February 2, 2026';
      expect(
        screen.getByText(said(direction, 'account.memberSince', { gender: 'female', date })),
      ).toBeTruthy();
      const city = direction === 'rtl' ? 'القاهرة' : 'Cairo';
      expect(
        screen.getByText(said(direction, 'account.timeZoneFromDevice', { city })),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.providers.google'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.genders.female'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.terms'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.signOut'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.profile'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.profileValue'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.deleteAccount'))).toBeTruthy();
      // The notifications row lands with its phase, so it is not drawn yet.
      expect(screen.queryByText(said(direction, 'account.notifications'))).toBeNull();
    });
  });

  it('opens the profile editor and the deletion (T084)', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(ar('account.profile')) }));
    await fireEvent.press(
      screen.getByRole('button', { name: new RegExp(ar('account.deleteAccount')) }),
    );
    expect(mockNavigate.mock.calls).toEqual([
      ['/(student)/account/profile'],
      ['/(student)/account/delete'],
    ]);
  });

  it('names a zone chosen by hand without «من الجهاز»', async () => {
    await renderIn('rtl', withAccount({ ...me, timezone: 'Asia/Riyadh' })());
    expect(screen.getByText('الرياض')).toBeTruthy();
    expect(screen.queryByText(ar('account.timeZoneFromDevice', { city: 'الرياض' }))).toBeNull();
  });

  it('switches the language in place and stores it on the account (FR-131)', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    await waitFor(() =>
      expect(mockApi.api.account.setLanguage.mutate).toHaveBeenCalledWith({ language: 'en' }),
    );
    expect(getLocale()).toBe('en');
    setLocale('ar');
  });

  it('opens the time-zone picker and the Terms', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(ar('account.timeZone')) }));
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(ar('account.terms')) }));
    expect(mockNavigate.mock.calls).toEqual([['/time-zone'], ['/terms']]);
  });

  it('asks before signing out, then revokes the session and lands on the welcome screen', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(ar('account.signOut')) }));
    expect(await screen.findByText(ar('account.signOutSheet.title'))).toBeTruthy();
    expect(screen.getByText(ar('account.signOutSheet.text'))).toBeTruthy();
    await fireEvent.press(
      screen.getAllByRole('button', { name: ar('account.signOutSheet.confirm') }).at(-1)!,
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'signed-out' }));
    expect(mockApi.api.auth.signOut.mutate).toHaveBeenCalled();
    expect(mockApi.sessions.current()).toBeNull();
  });

  it('signs the device out even when the server cannot be reached', async () => {
    mockApi.api.auth.signOut.mutate.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(ar('account.signOut')) }));
    await fireEvent.press(
      (await screen.findAllByRole('button', { name: ar('account.signOutSheet.confirm') })).at(-1)!,
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'signed-out' }));
    expect(mockApi.sessions.current()).toBeNull();
  });

  it('says the sentence of the method the account signs in with', async () => {
    await renderIn('rtl', withAccount({ ...me, signInMethod: 'email' })());
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(ar('account.signOut')) }));
    expect(await screen.findByText(ar('account.signOutSheet.textEmail'))).toBeTruthy();
  });

  it('says a failed read with a retry', async () => {
    mockApi.api.account.me.query.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', withAccount(null)());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    mockApi.api.account.me.query.mockResolvedValue(me);
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await screen.findByText('أمل حسن')).toBeTruthy();
  });
});
