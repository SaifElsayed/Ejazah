// T158 (FR-PROFILE-1, FR-310): the teacher's public profile against ProfileEditor, in both
// languages: the display name, reached from the account tab's «الملف العام», is edited and saved
// through `account.updateProfile`, refused here as the contract refuses it; an unchanged name saves
// nothing.
import type { MeOutput } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { setSession } from '../../../lib/session';
import { apiError, fakeApi, tokens } from '../../shared/__tests__/api-double';
import { ProfileEditor } from './index';

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

const me: MeOutput = {
  userId: '0193a6f0-0000-7000-8000-000000000002',
  role: 'teacher',
  displayName: 'أحمد سالم',
  email: 'ahmed@example.com',
  gender: 'male',
  dateOfBirth: '1980-01-01',
  preferredLanguage: 'ar',
  timezone: 'Africa/Cairo',
  signInMethod: 'apple',
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
      <ProfileEditor />
    </QueryClientProvider>
  );
}

const save = () => screen.getByRole('button', { name: ar('common.action.save') });

beforeEach(async () => {
  mockApi = fakeApi();
  await mockApi.sessions.store.write(tokens);
  mockNavigate.mockReset();
  setSession({ kind: 'signed-in', landing: 'teacher_home' });
});

describe('ProfileEditor', () => {
  it('draws the display name to edit', async () => {
    await inBothDirections(withAccount(), (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'teacher.profile.title'))).toBeTruthy();
      const name = screen.getByLabelText(said(direction, 'teacher.profile.displayName'));
      expect(name.props.value).toBe('أحمد سالم');
      expect(name.props.editable).not.toBe(false);
    });
  });

  it('saves the name through account.updateProfile, reads the account again, and goes back', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.changeText(
      screen.getByLabelText(ar('teacher.profile.displayName')),
      '  أحمد سالم علي ',
    );
    await fireEvent.press(save());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
    expect(mockApi.api.account.updateProfile.mutate).toHaveBeenCalledWith({
      displayName: 'أحمد سالم علي',
    });
    expect(mockApi.api.account.me.query).toHaveBeenCalled();
  });

  it('keeps «حفظ» disabled for a name the contract refuses', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.changeText(screen.getByLabelText(ar('teacher.profile.displayName')), ' أ ');
    expect(save().props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('goes back without a call when nothing changed', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.press(save());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
    expect(mockApi.api.account.updateProfile.mutate).not.toHaveBeenCalled();
  });

  it('says a refused save in place and stays', async () => {
    mockApi.api.account.updateProfile.mutate.mockRejectedValueOnce(apiError('INTERNAL'));
    await renderIn('rtl', withAccount()());
    await fireEvent.changeText(
      screen.getByLabelText(ar('teacher.profile.displayName')),
      'أحمد علي',
    );
    await fireEvent.press(save());
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
