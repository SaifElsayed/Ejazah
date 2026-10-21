// T052 (FR-PROFILE-6, FR-131, FR-AUTH-7): the teacher's account tab against the board: the sign-out
// in the header, the name with the approved badge, and the same settings as the student's. The
// teaching list holds «إجازاتي» since B11b (T059), with the count waiting for review; payout comes
// with B15, the profile and signature with their phases, and the delete row with B16.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { getSession, setSession } from '../../../lib/session';
import { fakeApi, tokens } from '../../shared/__tests__/api-double';
import { TeacherAccount } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (route: unknown) => mockPush(route) } }));
jest.mock('../../../lib/time-zone', () => ({ deviceTimeZone: () => 'Africa/Cairo' }));

const me = {
  userId: '0193a6f0-0000-7000-8000-000000000002',
  role: 'teacher' as const,
  displayName: 'أحمد سالم',
  email: 'ahmed@example.com',
  gender: 'male' as const,
  dateOfBirth: '1980-01-01',
  preferredLanguage: 'ar' as const,
  timezone: 'Africa/Cairo',
  signInMethod: 'apple' as const,
  memberSince: '2026-01-10T09:00:00Z',
  accountStatus: 'active' as const,
  landing: 'teacher_home' as const,
  teacher: {
    applicationStatus: 'approved' as const,
    verificationStatus: 'approved' as const,
    payout: { configured: true, verified: true },
  },
};

const said = (direction: 'rtl' | 'ltr', key: MessageKey) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);

function withAccount() {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
  return () => (
    <QueryClientProvider client={queries}>
      <TeacherAccount />
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  mockApi = fakeApi();
  mockApi.api.account.me.query.mockResolvedValue(me);
  await mockApi.sessions.store.write(tokens);
  setSession({ kind: 'signed-in', landing: 'teacher_home' });
});

describe('TeacherAccount', () => {
  it('draws the name with its badge and the settings, none of the rows that come later', async () => {
    await inBothDirections(withAccount(), (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'teacher.account.title'))).toBeTruthy();
      expect(screen.getByText('أحمد سالم')).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.application.approved'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.providers.apple'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.genders.male'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'teacher.account.payout'))).toBeNull();
      expect(screen.queryByText(said(direction, 'teacher.account.deleteAccount'))).toBeNull();
    });
  });

  it('lists «إجازاتي» under teaching with the count waiting for review, and opens it', async () => {
    mockApi.api.teacher.credentials.list.query.mockResolvedValue([
      {
        credentialId: 'c1',
        subject: { id: 's1', nameAr: 'أ', nameEn: 'A' },
        status: 'approved',
        submittedAt: '2026-10-01T09:00:00Z',
        document: {},
      },
      {
        credentialId: 'c2',
        subject: { id: 's2', nameAr: 'ب', nameEn: 'B' },
        status: 'pending',
        submittedAt: '2026-10-02T09:00:00Z',
        document: {},
      },
      {
        credentialId: 'c3',
        subject: { id: 's3', nameAr: 'ج', nameEn: 'C' },
        status: 'pending',
        submittedAt: '2026-10-03T09:00:00Z',
        document: {},
      },
    ]);
    await inBothDirections(withAccount(), async (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'teacher.account.teaching'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.account.credentials'))).toBeTruthy();
      expect(
        await screen.findByText(
          translate(direction === 'rtl' ? 'ar' : 'en', 'teacher.account.credentialsPending', {
            count: 2,
          }),
        ),
      ).toBeTruthy();
    });
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByText(translate('ar', 'teacher.account.credentials')));
    expect(mockPush).toHaveBeenCalledWith('/(teacher)/credentials');
  });

  it('signs out from the header, after the sheet', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.press(
      screen.getByRole('button', { name: translate('ar', 'common.action.signOut') }),
    );
    expect(await screen.findByText(translate('ar', 'account.signOutSheet.textApple'))).toBeTruthy();
    await fireEvent.press(
      screen
        .getAllByRole('button', { name: translate('ar', 'account.signOutSheet.confirm') })
        .at(-1)!,
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'signed-out' }));
  });
});
