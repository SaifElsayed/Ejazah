// T158 (FR-PROFILE-1, FR-310): the teacher's public profile against ProfileEditor, in both
// languages: the display name, reached from the account tab's «الملف العام», is edited and saved
// through `account.updateProfile`, refused here as the contract refuses it; an unchanged name saves
// nothing.
//
// T023 (FR-310, FR-PROFILE-1, FR-PROFILE-7, R-GENDER-6): the profile `teacher.profile.get` answers.
// The bio and the qualification are saved through `teacher.profile.update`, and only they; a bio
// longer than BIO_MAX_LENGTH or an empty qualification cannot be sent. The photo is picked from the
// system picker and uploaded at once through `POST /uploads/photos`. The gender is shown with the
// support hint and no input of it is editable or ever sent. The board's subjects and years of
// teaching are not in the task or the contract, so nothing of them is drawn.
import { BIO_MAX_LENGTH, type TeacherProfileGetOutput } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, nodesOf, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
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

const mockPick = jest.fn<() => Promise<unknown>>();
jest.mock('../../../lib/files', () => ({ pickPhoto: () => mockPick() }));

const PHOTO = 'https://files.ijazah.test/photos/old.jpg?signature=0';
const NEW_PHOTO = 'https://files.ijazah.test/photos/new.jpg?signature=1';
const PICKED = { uri: 'file:///cache/me.jpg', name: 'IMG_0001.jpg', mimeType: 'image/jpeg' };

const profile: TeacherProfileGetOutput = {
  displayName: 'أحمد سالم',
  photoUrl: PHOTO,
  bio: 'أُدرّس القرآن منذ عشرين عامًا.',
  qualificationSummary: 'إجازة في رواية حفص عن عاصم',
  gender: 'male',
  published: true,
};

const said = (direction: 'rtl' | 'ltr', key: MessageKey) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);
const ar = (key: MessageKey) => translate('ar', key);

function withProfile(answer: TeacherProfileGetOutput = profile) {
  mockApi.api.teacher.profile.get.query.mockResolvedValue(answer);
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return () => (
    <QueryClientProvider client={queries}>
      <ProfileEditor />
    </QueryClientProvider>
  );
}

const save = () => screen.getByRole('button', { name: ar('common.action.save') });
const field = (key: MessageKey) => screen.getByLabelText(ar(key));
const loaded = () => screen.findByLabelText(ar('teacher.profile.displayName'));

beforeEach(async () => {
  mockApi = fakeApi();
  await mockApi.sessions.store.write(tokens);
  mockNavigate.mockReset();
  mockPick.mockReset();
  mockPick.mockResolvedValue(PICKED);
  setSession({ kind: 'signed-in', landing: 'teacher_home' });
});

describe('ProfileEditor', () => {
  it('draws the photo, the name, the bio and the qualification to edit, and the gender shown', async () => {
    await inBothDirections(withProfile(), async (rendered, direction) => {
      const name = await screen.findByLabelText(said(direction, 'teacher.profile.displayName'));
      expect(screen.getByText(said(direction, 'teacher.profile.title'))).toBeTruthy();
      expect(name.props.value).toBe('أحمد سالم');
      expect(name.props.editable).not.toBe(false);
      const bio = screen.getByLabelText(said(direction, 'teacher.profile.bio'));
      expect(bio.props.value).toBe(profile.bio);
      expect(bio.props.editable).not.toBe(false);
      const qualification = screen.getByLabelText(
        said(direction, 'teacher.profile.qualificationType'),
      );
      expect(qualification.props.value).toBe(profile.qualificationSummary);
      expect(qualification.props.editable).not.toBe(false);
      expect(
        screen.getByRole('link', { name: said(direction, 'teacher.profile.changePhoto') }),
      ).toBeTruthy();
      expect(
        nodesOf(rendered).some(
          (node) =>
            node.type === 'Image' && (node.props['source'] as { uri?: string }).uri === PHOTO,
        ),
      ).toBe(true);
      // Not in T023's text or the contract (the owner's rule).
      expect(screen.queryByText(said(direction, 'teacher.profile.subjects'))).toBeNull();
      expect(screen.queryByText(said(direction, 'teacher.profile.yearsTeaching'))).toBeNull();
    });
  });

  it.each([
    ['male', 'account.genders.male'],
    ['female', 'account.genders.female'],
  ] as const)(
    'shows the %s gender with the support hint and no way to edit it',
    async (gender, label) => {
      await inBothDirections(withProfile({ ...profile, gender }), async (_rendered, direction) => {
        const shown = await screen.findByLabelText(said(direction, 'teacher.profile.gender'));
        expect(shown.props.value).toBe(said(direction, label));
        expect(shown.props.editable).toBe(false);
        expect(screen.getByText(said(direction, 'teacher.profile.genderHint'))).toBeTruthy();
      });
    },
  );

  it('saves the name through account.updateProfile alone, reads the profile again, and goes back', async () => {
    await renderIn('rtl', withProfile()());
    await fireEvent.changeText(await loaded(), '  أحمد سالم علي ');
    await fireEvent.press(save());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
    expect(mockApi.api.account.updateProfile.mutate).toHaveBeenCalledWith({
      displayName: 'أحمد سالم علي',
    });
    expect(mockApi.api.teacher.profile.update.mutate).not.toHaveBeenCalled();
    expect(mockApi.api.teacher.profile.get.query).toHaveBeenCalledTimes(2);
  });

  it('saves the bio and the qualification through teacher.profile.update alone, never a gender', async () => {
    await renderIn('rtl', withProfile()());
    await loaded();
    await fireEvent.changeText(field('teacher.profile.bio'), '  نبذة جديدة ');
    await fireEvent.changeText(field('teacher.profile.qualificationType'), ' إجازة في القراءات ');
    await fireEvent.press(save());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
    expect(mockApi.api.teacher.profile.update.mutate).toHaveBeenCalledTimes(1);
    expect(mockApi.api.teacher.profile.update.mutate).toHaveBeenCalledWith({
      bio: 'نبذة جديدة',
      qualificationSummary: 'إجازة في القراءات',
    });
    expect(mockApi.api.account.updateProfile.mutate).not.toHaveBeenCalled();
  });

  it('saves the name and the bio, each through its own procedure', async () => {
    await renderIn('rtl', withProfile()());
    await fireEvent.changeText(await loaded(), 'أحمد علي');
    await fireEvent.changeText(field('teacher.profile.bio'), '');
    await fireEvent.press(save());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
    expect(mockApi.api.account.updateProfile.mutate).toHaveBeenCalledWith({
      displayName: 'أحمد علي',
    });
    expect(mockApi.api.teacher.profile.update.mutate).toHaveBeenCalledWith({
      bio: '',
      qualificationSummary: profile.qualificationSummary,
    });
  });

  it(`cannot send a bio of ${BIO_MAX_LENGTH + 1} characters, and says why`, async () => {
    await renderIn('rtl', withProfile()());
    await loaded();
    await fireEvent.changeText(field('teacher.profile.bio'), 'ب'.repeat(BIO_MAX_LENGTH + 1));
    expect(save().props.accessibilityState).toMatchObject({ disabled: true });
    expect(
      screen.getByText(translate('ar', 'teacher.profile.bioTooLong', { max: BIO_MAX_LENGTH })),
    ).toBeTruthy();
    await fireEvent.press(save());
    expect(mockApi.api.teacher.profile.update.mutate).not.toHaveBeenCalled();
    await fireEvent.changeText(field('teacher.profile.bio'), 'ب'.repeat(BIO_MAX_LENGTH));
    expect(save().props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('keeps «حفظ» disabled for an empty qualification or a name the contract refuses', async () => {
    await renderIn('rtl', withProfile()());
    await loaded();
    await fireEvent.changeText(field('teacher.profile.qualificationType'), '   ');
    expect(save().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(field('teacher.profile.qualificationType'), 'إجازة');
    await fireEvent.changeText(field('teacher.profile.displayName'), ' أ ');
    expect(save().props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('goes back without a call when nothing changed', async () => {
    await renderIn('rtl', withProfile()());
    await loaded();
    await fireEvent.press(save());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
    expect(mockApi.api.account.updateProfile.mutate).not.toHaveBeenCalled();
    expect(mockApi.api.teacher.profile.update.mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['the name', 'teacher.profile.displayName', 'أحمد علي'],
    ['the bio', 'teacher.profile.bio', 'نبذة أخرى'],
  ] as const)('says a refused save of %s in place and stays', async (_what, key, value) => {
    mockApi.api.account.updateProfile.mutate.mockRejectedValueOnce(apiError('INTERNAL'));
    mockApi.api.teacher.profile.update.mutate.mockRejectedValueOnce(apiError('INTERNAL'));
    await renderIn('rtl', withProfile()());
    await loaded();
    await fireEvent.changeText(field(key), value);
    await fireEvent.press(save());
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('says the profile did not load, with a retry', async () => {
    mockApi.api.teacher.profile.get.query.mockRejectedValue(apiError('INTERNAL'));
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderIn(
      'rtl',
      <QueryClientProvider client={queries}>
        <ProfileEditor />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(save().props.accessibilityState).toMatchObject({ disabled: true });
    mockApi.api.teacher.profile.get.query.mockResolvedValue(profile);
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await loaded()).toBeTruthy();
  });

  it('uploads a picked photo at once and shows it', async () => {
    const rendered = await renderIn('rtl', withProfile()());
    await loaded();
    await fireEvent.press(screen.getByRole('link', { name: ar('teacher.profile.changePhoto') }));
    await waitFor(() => expect(mockApi.value.client.uploadPhoto).toHaveBeenCalledWith(PICKED));
    await waitFor(() =>
      expect(
        nodesOf(rendered).some(
          (node) =>
            node.type === 'Image' && (node.props['source'] as { uri?: string }).uri === NEW_PHOTO,
        ),
      ).toBe(true),
    );
    expect(mockApi.api.account.updateProfile.mutate).not.toHaveBeenCalled();
    expect(mockApi.api.teacher.profile.update.mutate).not.toHaveBeenCalled();
  });

  it('uploads nothing when the picker is closed', async () => {
    mockPick.mockResolvedValue(null);
    await renderIn('rtl', withProfile()());
    await loaded();
    await fireEvent.press(screen.getByRole('link', { name: ar('teacher.profile.changePhoto') }));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    expect(mockApi.value.client.uploadPhoto).not.toHaveBeenCalled();
  });

  it('says a refused photo in place', async () => {
    mockApi.value.client.uploadPhoto.mockRejectedValueOnce(apiError('VALIDATION_FAILED'));
    await renderIn('rtl', withProfile()());
    await loaded();
    await fireEvent.press(screen.getByRole('link', { name: ar('teacher.profile.changePhoto') }));
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
  });
});
