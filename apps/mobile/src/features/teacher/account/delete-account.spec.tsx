// T084 (FR-140, FR-141, ADR 0015 D1, D3, D4): the teacher's deletion against DeleteAccountTeacher
// and DeleteAccountTeacherSheet, in both languages. The screen says only what this phase makes true
// (no student, session, package, slot or signature exists yet, R-HONEST): the personal data and the
// documents and payout reference go, the activity log stays without them. The word gates the
// button; the sheet proves the teacher by their method and, once deleted, signs the device out.
import type { MeOutput } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { getSession, setSession } from '../../../lib/session';
import { apiError, fakeApi, tokens } from '../../shared/__tests__/api-double';
import { DeleteAccountTeacher } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    replace: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
    canGoBack: () => false,
  },
}));

const mockIdentity = jest.fn<(provider: string, nonce: string) => Promise<unknown>>();
jest.mock('../../shared/auth/providers', () => ({
  nativeIdentity: (provider: string, nonce: string) => mockIdentity(provider, nonce),
}));
jest.mock('../../shared/auth/dev-sign-in', () => ({
  ...jest.requireActual<typeof import('../../shared/auth/dev-sign-in')>(
    '../../shared/auth/dev-sign-in',
  ),
  devSignInEnabled: () => false,
}));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `deletion-key-${++mockKey}` }));

const me: MeOutput = {
  userId: '0193a6f0-0000-7000-8000-000000000002',
  role: 'teacher',
  displayName: 'أحمد سالم',
  email: 'ahmed@example.com',
  gender: 'male',
  dateOfBirth: '1980-01-01',
  preferredLanguage: 'ar',
  timezone: 'Africa/Cairo',
  signInMethod: 'google',
  memberSince: '2026-01-10T09:00:00Z',
  accountStatus: 'active',
  landing: 'teacher_home',
  teacher: {
    applicationStatus: 'approved',
    verificationStatus: 'approved',
    payout: { configured: true, verified: true },
  },
};

const said = (direction: 'rtl' | 'ltr', key: MessageKey) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);
const ar = (key: MessageKey) => translate('ar', key);

function withAccount(account: MeOutput = me) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, account);
  mockApi.api.account.me.query.mockResolvedValue(account);
  return () => (
    <QueryClientProvider client={queries}>
      <DeleteAccountTeacher />
    </QueryClientProvider>
  );
}

const submit = (direction: 'rtl' | 'ltr' = 'rtl') =>
  screen.getByRole('button', { name: said(direction, 'teacher.deleteAccount.delete') });

beforeEach(async () => {
  mockApi = fakeApi();
  await mockApi.sessions.store.write(tokens);
  mockNavigate.mockReset();
  mockIdentity.mockReset();
  mockKey = 0;
  mockApi.api.auth.providerNonce.mutate.mockResolvedValue({
    nonce: 'nonce-7',
    expiresAt: '2026-10-26T10:05:00Z',
  });
  mockIdentity.mockResolvedValue({ identityToken: 'id-token-7' });
  setSession({ kind: 'signed-in', landing: 'teacher_home' });
});

describe('DeleteAccountTeacher', () => {
  it('says what is deleted and kept as this phase makes it true, and no line of a later phase', async () => {
    await inBothDirections(withAccount(), (_rendered, direction) => {
      // The title and the danger button say the same words.
      expect(screen.getAllByText(said(direction, 'teacher.deleteAccount.title'))).toHaveLength(2);
      expect(
        screen.getByText(said(direction, 'teacher.deleteAccount.honest.warning')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.deleteAccount.deletedTitle'))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'account.delete.deletedItems.personal')),
      ).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'teacher.deleteAccount.honest.deletedDocuments')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.deleteAccount.keptTitle'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.delete.honest.kept'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.deleteAccount.confirmHint'))).toBeTruthy();
      for (const later of [
        'teacher.deleteAccount.warning',
        'teacher.deleteAccount.deletedIdentity',
        'teacher.deleteAccount.deletedProfile',
        'teacher.deleteAccount.keptIjazahs',
        'teacher.deleteAccount.keptRecords',
      ] as const) {
        expect(screen.queryByText(said(direction, later))).toBeNull();
      }
    });
  });

  it('keeps the button disabled until the word is typed', async () => {
    await renderIn('rtl', withAccount()());
    expect(submit().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(
      screen.getByLabelText(ar('teacher.deleteAccount.confirmLabel')),
      'حذف',
    );
    expect(submit().props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('goes back to the account tab on «إلغاء» when there is nothing to go back to', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByRole('button', { name: ar('account.delete.cancel') }));
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/(tabs)/account');
  });
});

describe('DeleteAccountTeacherSheet', () => {
  async function openSheet() {
    await fireEvent.changeText(
      screen.getByLabelText(ar('teacher.deleteAccount.confirmLabel')),
      'حذف',
    );
    await fireEvent.press(submit());
  }

  it('asks once more with the honest sentence and the button of the method', async () => {
    await renderIn('rtl', withAccount()());
    await openSheet();
    expect(await screen.findByText(ar('teacher.deleteAccount.sheet.title'))).toBeTruthy();
    expect(screen.getByText(ar('account.delete.honest.sheetText'))).toBeTruthy();
    expect(screen.queryByText(ar('teacher.deleteAccount.sheet.text'))).toBeNull();
    expect(
      screen.getByRole('button', { name: ar('teacher.deleteAccount.sheet.confirmGoogle') }),
    ).toBeTruthy();
  });

  it('proves the teacher through Google, deletes, and signs the device out', async () => {
    await renderIn('rtl', withAccount()());
    await openSheet();
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.deleteAccount.sheet.confirmGoogle') }),
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'signed-out' }));
    expect(mockIdentity).toHaveBeenCalledWith('google', 'nonce-7');
    expect(mockApi.api.account.delete.mutate).toHaveBeenCalledWith({
      confirmation: 'حذف',
      reauth: { kind: 'provider', identityToken: 'id-token-7', nonce: 'nonce-7' },
      idempotencyKey: 'deletion-key-1',
    });
    expect(mockApi.sessions.current()).toBeNull();
  });

  it('proves an email teacher by the password and says a wrong one in place', async () => {
    mockApi.api.account.delete.mutate.mockRejectedValueOnce(apiError('SIGN_IN_FAILED'));
    await renderIn('rtl', withAccount({ ...me, signInMethod: 'email' })());
    await openSheet();
    await fireEvent.changeText(
      await screen.findByLabelText(ar('auth.field.password')),
      'not the secret',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: ar('teacher.deleteAccount.sheet.confirmEmail') }),
    );
    expect(await screen.findByText(ar('account.delete.sheet.passwordFailed'))).toBeTruthy();
    expect(mockApi.api.account.delete.mutate).toHaveBeenCalledWith({
      confirmation: 'حذف',
      reauth: { kind: 'password', password: 'not the secret' },
      idempotencyKey: 'deletion-key-1',
    });
    expect(getSession()).toEqual({ kind: 'signed-in', landing: 'teacher_home' });
  });
});
