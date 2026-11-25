// 006:T020 (SRS DEC-112; B-P4's conflict check, Q-6 (a)): the teacher's account has one «تواصل مع
// الدعم» row, in Arabic and English, that writes to the support address the public configuration
// serves (the restricted screens' mailto); a failure to read it says so. No word about refusing a
// student anywhere on the tab (the app does not explain it). Kept in the programme's folder, the
// lane's own.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  inBothDirections,
  nodesOf,
  renderIn,
  unmarked,
} from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { fakeApi } from '../../shared/__tests__/api-double';
import { TeacherAccount } from '../account';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../../lib/time-zone', () => ({ deviceTimeZone: () => 'Africa/Cairo' }));
jest.mock('../../shared/auth/providers', () => ({
  nativeIdentity: jest.fn(),
  signOutProviders: jest.fn(async () => undefined),
}));
const mockOpenURL = jest.fn<(url: string) => Promise<void>>();
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpenURL(url) }));

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

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <TeacherAccount />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockApi.api.account.me.query.mockResolvedValue(me);
  mockApi.api.teacher.credentials.list.query.mockResolvedValue([]);
  mockOpenURL.mockReset().mockResolvedValue(undefined);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

describe('«تواصل مع الدعم» on the teacher’s account (Q-6 (a))', () => {
  it('draws one support row, and no word about refusing a student', async () => {
    await inBothDirections(ui, (rendered, direction) => {
      expect(
        screen.getAllByText(said(direction, 'account.restricted.contactSupport')),
      ).toHaveLength(1);
      const words = nodesOf(rendered)
        .flatMap((node) => (node.children ?? []).filter((c): c is string => typeof c === 'string'))
        .map(unmarked);
      expect(words.filter((text) => /رفض|refus|declin|reject/i.test(text))).toEqual([]);
    });
  });

  it('writes to the support address the public configuration serves', async () => {
    await renderIn('rtl', ui());
    await fireEvent.press(screen.getByText(translate('ar', 'account.restricted.contactSupport')));
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledWith('mailto:support@ijazah.test'));
  });

  it('says so when the address cannot be read', async () => {
    mockApi.value.client.publicConfig.mockRejectedValueOnce(new Error('offline'));
    await renderIn('rtl', ui());
    await fireEvent.press(screen.getByText(translate('ar', 'account.restricted.contactSupport')));
    expect(await screen.findByText(translate('ar', 'common.state.actionError'))).toBeTruthy();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });
});
