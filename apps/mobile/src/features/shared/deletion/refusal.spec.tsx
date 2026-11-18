// 005:T031 of specs/005-certification (FR-630; the note under T031): a teacher's deletion refused for
// an undecided ijazah request (`CONFLICT` `pending_ijazah_requests`) says that cause's own sentence in
// the sheet, naming no count, and offers «تواصل مع الدعم» in place of the confirm button, as T080's
// ongoing enrollment does; each cause its own text, in both directions.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { getSession, setSession } from '../../../lib/session';
import { apiError, fakeApi, tokens } from '../__tests__/api-double';
import { DeletionSheet } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockIdentity = jest.fn<(provider: string, nonce: string) => Promise<unknown>>();
jest.mock('../auth/providers', () => ({
  nativeIdentity: (provider: string, nonce: string) => mockIdentity(provider, nonce),
}));
jest.mock('../auth/dev-sign-in', () => ({
  ...jest.requireActual<typeof import('../auth/dev-sign-in')>('../auth/dev-sign-in'),
  devSignInEnabled: () => false,
}));

const mockOpen = jest.fn<(url: string) => Promise<true>>();
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpen(url) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'deletion-key-1' }));

const said = (direction: 'rtl' | 'ltr', key: MessageKey) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);

const COPY = {
  title: 'title',
  text: 'text',
  confirm: { google: 'Delete with Google', apple: 'Delete with Apple', email: 'Delete' },
  cancel: 'Cancel',
} as const;

beforeEach(async () => {
  mockApi = fakeApi();
  await mockApi.sessions.store.write(tokens);
  mockIdentity.mockReset();
  mockOpen.mockReset();
  mockApi.api.auth.providerNonce.mutate.mockResolvedValue({
    nonce: 'nonce-7',
    expiresAt: '2026-11-18T10:05:00Z',
  });
  mockIdentity.mockResolvedValue({ identityToken: 'id-token-7' });
  setSession({ kind: 'signed-in', landing: 'teacher_home' });
});

describe('DeletionSheet: a refusal names its own cause (005:T031)', () => {
  it.each(['rtl', 'ltr'] as const)(
    'says an undecided ijazah request’s refusal with the support link in place of the confirm button (%s)',
    async (direction) => {
      mockApi.api.account.delete.mutate.mockRejectedValueOnce(
        apiError('CONFLICT', [{ path: 'cause', code: 'pending_ijazah_requests' }]),
      );
      await renderIn(
        direction,
        <DeletionSheet copy={COPY} method="google" confirmation="حذف" onClose={() => undefined} />,
      );
      await fireEvent.press(screen.getByRole('button', { name: COPY.confirm.google }));

      expect(
        await screen.findByText(said(direction, 'account.delete.refused.pendingIjazahRequests')),
      ).toBeTruthy();
      expect(
        screen.queryByText(said(direction, 'account.delete.refused.activeEnrollments')),
      ).toBeNull();
      expect(screen.queryByRole('button', { name: COPY.confirm.google })).toBeNull();
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'account.restricted.contactSupport') }),
      );
      await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('mailto:support@ijazah.test'));
      expect(getSession()).toEqual({ kind: 'signed-in', landing: 'teacher_home' });
    },
  );

  it('keeps an ongoing enrollment’s refusal in its own words (T080)', async () => {
    mockApi.api.account.delete.mutate.mockRejectedValueOnce(
      apiError('CONFLICT', [{ path: 'cause', code: 'active_enrollments' }]),
    );
    await renderIn(
      'rtl',
      <DeletionSheet copy={COPY} method="google" confirmation="حذف" onClose={() => undefined} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: COPY.confirm.google }));

    expect(
      await screen.findByText(said('rtl', 'account.delete.refused.activeEnrollments')),
    ).toBeTruthy();
    expect(
      screen.queryByText(said('rtl', 'account.delete.refused.pendingIjazahRequests')),
    ).toBeNull();
  });

  it('answers any other conflict with the generic error, never a refusal’s sentence', async () => {
    mockApi.api.account.delete.mutate.mockRejectedValueOnce(
      apiError('CONFLICT', [{ path: 'cause', code: 'open_cases' }]),
    );
    await renderIn(
      'rtl',
      <DeletionSheet copy={COPY} method="google" confirmation="حذف" onClose={() => undefined} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: COPY.confirm.google }));

    await waitFor(() => expect(mockApi.api.account.delete.mutate).toHaveBeenCalled());
    expect(
      screen.queryByText(said('rtl', 'account.delete.refused.pendingIjazahRequests')),
    ).toBeNull();
    expect(screen.queryByText(said('rtl', 'account.delete.refused.activeEnrollments'))).toBeNull();
    expect(screen.getByRole('button', { name: COPY.confirm.google })).toBeTruthy();
  });
});
