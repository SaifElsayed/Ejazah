// T084 (FR-AUTH-8, FR-PROFILE-1, R-GENDER-6): the student's profile editor against
// StudentProfileEditor, in both languages. The name is edited and saved through
// `account.updateProfile`; the photo is picked from the system picker and uploaded at once through
// `POST /uploads/photos`, the avatar showing the link the upload answers; the date of birth and the
// gender are shown locked, with the support hint, and no input of either is ever sent.
import type { MeOutput } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, nodesOf, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { setSession } from '../../../lib/session';
import { apiError, fakeApi, tokens } from '../../shared/__tests__/api-double';
import { StudentProfileEditor } from './index';

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

const mockPick = jest.fn<() => Promise<unknown>>();
jest.mock('../../../lib/files', () => ({ pickPhoto: () => mockPick() }));
// The account's entry carries the deletion, whose proof loads the providers' native modules.
jest.mock('../../shared/auth/providers', () => ({ nativeIdentity: jest.fn() }));

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

const PICKED = { uri: 'file:///cache/me.jpg', name: 'IMG_0001.jpg', mimeType: 'image/jpeg' };
const NEW_PHOTO = 'https://files.ijazah.test/photos/new.jpg?signature=1';

const said = (direction: 'rtl' | 'ltr', key: MessageKey) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);
const ar = (key: MessageKey) => translate('ar', key);

let queries: QueryClient;
function withAccount(account: MeOutput = me) {
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, account);
  mockApi.api.account.me.query.mockResolvedValue(account);
  return () => (
    <QueryClientProvider client={queries}>
      <StudentProfileEditor />
    </QueryClientProvider>
  );
}

const save = () => screen.getByRole('button', { name: ar('student.profile.save') });

beforeEach(async () => {
  mockApi = fakeApi();
  await mockApi.sessions.store.write(tokens);
  mockNavigate.mockReset();
  mockPick.mockReset();
  mockPick.mockResolvedValue(PICKED);
  setSession({ kind: 'signed-in', landing: 'student_home' });
});

describe('StudentProfileEditor', () => {
  it('draws the name to edit, and the date of birth and the gender locked', async () => {
    await inBothDirections(withAccount(), (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'student.profile.title'))).toBeTruthy();
      expect(
        screen.getByRole('link', { name: said(direction, 'student.profile.changePhoto') }),
      ).toBeTruthy();
      const name = screen.getByLabelText(said(direction, 'student.profile.name'));
      expect(name.props.value).toBe('أمل حسن');
      expect(name.props.editable).not.toBe(false);
      const birth = screen.getByLabelText(said(direction, 'student.profile.birthDate'));
      expect(birth.props.value).toBe(direction === 'rtl' ? '12 مارس 2004' : 'March 12, 2004');
      expect(birth.props.editable).toBe(false);
      const gender = screen.getByLabelText(said(direction, 'account.gender'));
      expect(gender.props.value).toBe(said(direction, 'account.genders.female'));
      expect(gender.props.editable).toBe(false);
      expect(screen.getAllByText(said(direction, 'student.profile.lockedHint'))).toHaveLength(2);
      // The certificate name is entered at the first ijazah request, a later phase (R-HONEST).
      expect(screen.queryByText(said(direction, 'student.profile.nameHint'))).toBeNull();
    });
  });

  it('saves the name through account.updateProfile, reads the account again, and goes back', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.changeText(screen.getByLabelText(ar('student.profile.name')), '  أمل حسن علي ');
    await fireEvent.press(save());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
    expect(mockApi.api.account.updateProfile.mutate).toHaveBeenCalledWith({
      displayName: 'أمل حسن علي',
    });
    expect(mockApi.api.account.me.query).toHaveBeenCalled();
  });

  it('keeps «حفظ» disabled for a name the contract refuses', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.changeText(screen.getByLabelText(ar('student.profile.name')), ' أ ');
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
    await fireEvent.changeText(screen.getByLabelText(ar('student.profile.name')), 'أمل علي');
    await fireEvent.press(save());
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('uploads a picked photo at once and shows it', async () => {
    const rendered = await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByRole('link', { name: ar('student.profile.changePhoto') }));
    await waitFor(() => expect(mockApi.value.client.uploadPhoto).toHaveBeenCalledWith(PICKED));
    await waitFor(() =>
      expect(
        nodesOf(rendered).some(
          (node) =>
            node.type === 'Image' && (node.props['source'] as { uri?: string }).uri === NEW_PHOTO,
        ),
      ).toBe(true),
    );
    expect(mockApi.api.account.me.query).toHaveBeenCalled();
    expect(mockApi.api.account.updateProfile.mutate).not.toHaveBeenCalled();
  });

  it('uploads nothing when the picker is closed', async () => {
    mockPick.mockResolvedValue(null);
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByRole('link', { name: ar('student.profile.changePhoto') }));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    expect(mockApi.value.client.uploadPhoto).not.toHaveBeenCalled();
  });

  it('says a refused photo in place', async () => {
    mockApi.value.client.uploadPhoto.mockRejectedValueOnce(apiError('VALIDATION_FAILED'));
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByRole('link', { name: ar('student.profile.changePhoto') }));
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
  });
});
