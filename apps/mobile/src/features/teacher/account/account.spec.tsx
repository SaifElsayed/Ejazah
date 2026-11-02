// T052 (FR-PROFILE-6, FR-131, FR-AUTH-7): the teacher's account tab against the board: the sign-out
// in the header, the name with the approved badge, and the same settings as the student's. The
// teaching list holds «إجازاتي» since B11b (T059), with the count waiting for review, and «حساب
// الاستلام» since B15 (T078), with «موثّق» once verified; the profile and signature come with their
// phases. The danger row «حذف الحساب» opens the deletion since B16 (T084).
//
// T115 (a): the payout row's badge is each state of `teacher.payout.get`, as PayoutSetup reads it.
//
// T158: «الملف العام» leads the teaching list to the public profile, where the display name is
// edited.
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
// The tab leads to the deletion, whose proof loads the providers' native modules (T084).
jest.mock('../../shared/auth/providers', () => ({ nativeIdentity: jest.fn() }));

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

function withAccount(payout = me.teacher.payout) {
  const account = { ...me, teacher: { ...me.teacher, payout } };
  mockApi.api.account.me.query.mockResolvedValue(account);
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, account);
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
  it('draws the name with its badge, the settings and the delete row, none of the rows that come later', async () => {
    await inBothDirections(withAccount(), (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'teacher.account.title'))).toBeTruthy();
      expect(screen.getByText('أحمد سالم')).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.application.approved'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.providers.apple'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'account.genders.male'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.account.deleteAccount'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'teacher.account.signature'))).toBeNull();
    });
  });

  it('leads the teaching list with «الملف العام», and opens the profile (T158)', async () => {
    await inBothDirections(withAccount(), (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'teacher.account.profile'))).toBeTruthy();
      // The board's hint names the subjects, which the profile does not edit (R-HONEST).
      expect(screen.queryByText(said(direction, 'teacher.account.profileHint'))).toBeNull();
    });
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByText(translate('ar', 'teacher.account.profile')));
    expect(mockPush).toHaveBeenCalledWith('/(teacher)/profile');
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

  it('lists «حساب الاستلام» under teaching, «موثّق» once verified, and opens the payout (T078)', async () => {
    mockApi.api.teacher.payout.get.query.mockResolvedValue({ state: 'verified' });
    await inBothDirections(withAccount(), async (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'teacher.account.payout'))).toBeTruthy();
      expect(await screen.findByText(said(direction, 'status.payout.verified'))).toBeTruthy();
    });
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByText(translate('ar', 'teacher.account.payout')));
    expect(mockPush).toHaveBeenCalledWith('/(teacher)/payout');
  });

  it.each([
    ['pending_verification', 'status.payout.verifying'],
    ['rejected', 'status.payout.rejected'],
  ] as const)(
    'draws the %s payout as the payout screen reads it, whatever account.me says (T115)',
    async (state, badge) => {
      // `account.me` reads a rejection with no reason as pending; the row follows the payout's own state.
      mockApi.api.teacher.payout.get.query.mockResolvedValue({ state });
      await inBothDirections(
        withAccount({ configured: true, verified: false }),
        async (_rendered, direction) => {
          expect(await screen.findByText(said(direction, badge))).toBeTruthy();
          expect(screen.queryByText(said(direction, 'status.payout.verified'))).toBeNull();
        },
      );
      expect(mockApi.api.teacher.payout.get.query).toHaveBeenCalled();
    },
  );

  it('draws no badge on the payout row while no account is configured (T115)', async () => {
    mockApi.api.teacher.payout.get.query.mockResolvedValue({ state: 'not_configured' });
    await inBothDirections(
      withAccount({ configured: false, verified: false }),
      async (_rendered, direction) => {
        await waitFor(() => expect(mockApi.api.teacher.payout.get.query).toHaveBeenCalled());
        expect(screen.getByText(said(direction, 'teacher.account.payout'))).toBeTruthy();
        for (const badge of [
          'status.payout.verified',
          'status.payout.verifying',
          'status.payout.rejected',
        ] as const) {
          expect(screen.queryByText(said(direction, badge))).toBeNull();
        }
      },
    );
  });

  it('opens the deletion from the danger row (T084)', async () => {
    await renderIn('rtl', withAccount()());
    await fireEvent.press(screen.getByText(translate('ar', 'teacher.account.deleteAccount')));
    expect(mockPush).toHaveBeenCalledWith('/(teacher)/account/delete');
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
