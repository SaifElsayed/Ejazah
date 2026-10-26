// T084 (FR-140, FR-141, ADR 0015 D1, D4): the student's deletion against DeleteAccount and
// DeleteAccountSheet, in both languages. The screen says what is deleted, what is kept and what
// happens to the enrollments, only as far as this phase makes it true (no enrollment, session,
// payment or ijazah exists yet, R-HONEST); the button waits for the typed word in either language;
// the sheet proves the person by their sign-in method (a fresh provider token over a minted nonce,
// or the password), sends `account.delete` keyed once per attempt, says a refusal in place, and on
// success forgets the session as sign-out does, so the guard lands on the welcome screen.
import type { MeOutput } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { getSession, setSession } from '../../../lib/session';
import { apiError, fakeApi, tokens } from '../../shared/__tests__/api-double';
import { DeleteAccount } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    replace: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
    canGoBack: () => true,
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

const said = (direction: 'rtl' | 'ltr', key: MessageKey) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);
const ar = (key: MessageKey) => translate('ar', key);

function withAccount(account: MeOutput = me) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, account);
  mockApi.api.account.me.query.mockResolvedValue(account);
  return () => (
    <QueryClientProvider client={queries}>
      <DeleteAccount />
    </QueryClientProvider>
  );
}

const submit = (direction: 'rtl' | 'ltr' = 'rtl') =>
  screen.getByRole('button', { name: said(direction, 'account.delete.submit') });

async function typeWord(word: string, direction: 'rtl' | 'ltr' = 'rtl') {
  await fireEvent.changeText(
    screen.getByLabelText(said(direction, 'account.delete.confirmLabel')),
    word,
  );
}

/** Types the word, opens the sheet, and presses its confirmation for `method`. */
async function confirmWith(label: MessageKey) {
  await typeWord('حذف');
  await fireEvent.press(submit());
  await fireEvent.press(await screen.findByRole('button', { name: ar(label) }));
}

beforeEach(async () => {
  mockApi = fakeApi();
  await mockApi.sessions.store.write(tokens);
  mockNavigate.mockReset();
  mockIdentity.mockReset();
  mockKey = 0;
  mockApi.api.auth.providerNonce.mutate.mockResolvedValue({
    nonce: 'nonce-1',
    expiresAt: '2026-10-26T10:05:00Z',
  });
  mockIdentity.mockResolvedValue({ identityToken: 'id-token-1', email: 'amal@example.com' });
  setSession({ kind: 'signed-in', landing: 'student_home' });
});

describe('DeleteAccount', () => {
  it('says what is deleted and kept as this phase makes it true, and no line of a later phase', async () => {
    await inBothDirections(withAccount(), (_rendered, direction) => {
      // The title and the danger button say the same words.
      expect(screen.getAllByText(said(direction, 'account.delete.title'))).toHaveLength(2);
      expect(screen.getByText(said(direction, 'account.delete.honest.noEnrollments'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.delete.deleted'))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'account.delete.deletedItems.personal')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.delete.kept'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.delete.honest.kept'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.delete.irreversible'))).toBeTruthy();
      // Chats, reviews, ijazahs, payments and sessions arrive with later phases (R-HONEST).
      for (const later of [
        'account.delete.deletedItems.chats',
        'account.delete.keptItems.ijazahs',
        'account.delete.keptItems.records',
      ] as const) {
        expect(screen.queryByText(said(direction, later))).toBeNull();
      }
      expect(screen.queryByText(/ستُلغى جلساتك|sessions will be cancelled/)).toBeNull();
    });
  });

  it('keeps the button disabled until the word is typed, in either language', async () => {
    await inBothDirections(withAccount(), async (_rendered, direction) => {
      expect(submit(direction).props.accessibilityState).toMatchObject({ disabled: true });
      await typeWord('حذ', direction);
      expect(submit(direction).props.accessibilityState).toMatchObject({ disabled: true });
      await typeWord(' حذف ', direction);
      expect(submit(direction).props.accessibilityState).toMatchObject({ disabled: false });
      await typeWord('delete', direction);
      expect(submit(direction).props.accessibilityState).toMatchObject({ disabled: false });
      await typeWord('DELETE', direction);
      expect(submit(direction).props.accessibilityState).toMatchObject({ disabled: false });
    });
  });

  it('goes back on «إلغاء»', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByRole('button', { name: ar('account.delete.cancel') }));
    expect(mockNavigate).toHaveBeenCalledWith('back');
  });
});

describe('DeleteAccountSheet', () => {
  it('asks once more, saying the deletion is final, with the button of the account’s method', async () => {
    await renderIn('rtl', withAccount()());
    await typeWord('حذف');
    await fireEvent.press(submit());
    expect(await screen.findByText(ar('account.delete.sheet.title'))).toBeTruthy();
    expect(screen.getByText(ar('account.delete.honest.sheetText'))).toBeTruthy();
    expect(screen.queryByText(ar('account.delete.sheet.text'))).toBeNull();
    expect(
      screen.getByRole('button', { name: ar('account.delete.sheet.confirmGoogle') }),
    ).toBeTruthy();
    expect(mockApi.api.account.delete.mutate).not.toHaveBeenCalled();
  });

  it('proves a Google account by a fresh token over a minted nonce, deletes, and signs the device out', async () => {
    await renderIn('rtl', withAccount()());
    await confirmWith('account.delete.sheet.confirmGoogle');
    await waitFor(() => expect(getSession()).toEqual({ kind: 'signed-out' }));
    expect(mockIdentity).toHaveBeenCalledWith('google', 'nonce-1');
    expect(mockApi.api.account.delete.mutate).toHaveBeenCalledWith({
      confirmation: 'حذف',
      reauth: { kind: 'provider', identityToken: 'id-token-1', nonce: 'nonce-1' },
      idempotencyKey: 'deletion-key-1',
    });
    expect(mockApi.sessions.current()).toBeNull();
    // The server has revoked every session: nothing is sent after the deletion.
    expect(mockApi.api.auth.signOut.mutate).not.toHaveBeenCalled();
  });

  it('proves an Apple account through Apple, and sends the English word as the contract spells it', async () => {
    await renderIn('ltr', withAccount({ ...me, signInMethod: 'apple' })());
    await typeWord('delete', 'ltr');
    await fireEvent.press(submit('ltr'));
    await fireEvent.press(
      await screen.findByRole('button', { name: said('ltr', 'account.delete.sheet.confirmApple') }),
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'signed-out' }));
    expect(mockIdentity).toHaveBeenCalledWith('apple', 'nonce-1');
    expect(mockApi.api.account.delete.mutate).toHaveBeenCalledWith({
      confirmation: 'DELETE',
      reauth: { kind: 'provider', identityToken: 'id-token-1', nonce: 'nonce-1' },
      idempotencyKey: 'deletion-key-1',
    });
  });

  it('proves an email account by its password, the button waiting for one', async () => {
    await renderIn('rtl', withAccount({ ...me, signInMethod: 'email' })());
    await typeWord('حذف');
    await fireEvent.press(submit());
    const confirm = await screen.findByRole('button', {
      name: ar('account.delete.sheet.confirmEmail'),
    });
    expect(confirm.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.password')), 'a long secret');
    await fireEvent.press(
      screen.getByRole('button', { name: ar('account.delete.sheet.confirmEmail') }),
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'signed-out' }));
    expect(mockApi.api.auth.providerNonce.mutate).not.toHaveBeenCalled();
    expect(mockApi.api.account.delete.mutate).toHaveBeenCalledWith({
      confirmation: 'حذف',
      reauth: { kind: 'password', password: 'a long secret' },
      idempotencyKey: 'deletion-key-1',
    });
    expect(mockApi.sessions.current()).toBeNull();
  });

  it('does nothing when the person closes the provider’s sheet', async () => {
    mockIdentity.mockResolvedValue(null);
    await renderIn('rtl', withAccount()());
    await confirmWith('account.delete.sheet.confirmGoogle');
    await waitFor(() => expect(mockIdentity).toHaveBeenCalled());
    expect(mockApi.api.account.delete.mutate).not.toHaveBeenCalled();
    expect(getSession()).toEqual({ kind: 'signed-in', landing: 'student_home' });
    expect(screen.getByText(ar('account.delete.sheet.title'))).toBeTruthy();
  });

  it('says a wrong password in place and keeps the session; the next attempt has its own key', async () => {
    mockApi.api.account.delete.mutate.mockRejectedValueOnce(apiError('SIGN_IN_FAILED'));
    await renderIn('rtl', withAccount({ ...me, signInMethod: 'email' })());
    await typeWord('حذف');
    await fireEvent.press(submit());
    await fireEvent.changeText(
      await screen.findByLabelText(ar('auth.field.password')),
      'not the secret',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: ar('account.delete.sheet.confirmEmail') }),
    );
    expect(await screen.findByText(ar('account.delete.sheet.passwordFailed'))).toBeTruthy();
    expect(getSession()).toEqual({ kind: 'signed-in', landing: 'student_home' });
    expect(mockApi.sessions.current()).toEqual(tokens);
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.password')), 'a long secret');
    await fireEvent.press(
      screen.getByRole('button', { name: ar('account.delete.sheet.confirmEmail') }),
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'signed-out' }));
    expect(
      mockApi.api.account.delete.mutate.mock.calls.map(
        ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
      ),
    ).toEqual(['deletion-key-1', 'deletion-key-2']);
  });

  it('says a provider proof of another identity in place', async () => {
    mockApi.api.account.delete.mutate.mockRejectedValueOnce(apiError('SIGN_IN_FAILED'));
    await renderIn('rtl', withAccount()());
    await confirmWith('account.delete.sheet.confirmGoogle');
    expect(await screen.findByText(ar('account.delete.sheet.providerFailed'))).toBeTruthy();
    expect(getSession()).toEqual({ kind: 'signed-in', landing: 'student_home' });
  });

  it('says any other failure with the generic sentence', async () => {
    mockApi.api.account.delete.mutate.mockRejectedValueOnce(apiError('INTERNAL'));
    await renderIn('rtl', withAccount()());
    await confirmWith('account.delete.sheet.confirmGoogle');
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(getSession()).toEqual({ kind: 'signed-in', landing: 'student_home' });
  });
});
