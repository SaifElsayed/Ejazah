// T138 (FR-205): the teacher's data screens use the shared states. The tab roots (the account, the
// application's status) and the list of credentials keep their cached data under the offline banner
// while there is no connection (the `MainOffline` pattern); a screen with nothing cached says there is
// no connection instead of loading for ever; a failed read is the danger banner of `LoadError` with
// its retry. A form (the subjects of the application) keeps its cached choices without the banner,
// since its states table draws no offline pattern.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { Icon } from '../../design/primitives';
import { nodesOf, renderIn } from '../../design/primitives/__tests__/harness';
import type { IconName } from '../../design/primitives/types';
import { translate } from '../../i18n';
import { ME_QUERY_KEY } from '../../lib/account';
import { setSession } from '../../lib/session';
import { SUBJECTS_QUERY_KEY } from '../../lib/subjects';
import { apiError, fakeApi, tokens } from '../shared/__tests__/api-double';
import { TeacherAccount } from './account';
import { APPLICATION_QUERY_KEY } from './application/api';
import { ApplicationStatus, ApplySubjects } from './application';
import { CREDENTIALS_QUERY_KEY, TeacherCredentials } from './credentials';
import { Payout } from './payout';

let mockApi = fakeApi();
jest.mock('../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false },
  Redirect: () => null,
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'offline-0193a6f0-0000-7000-8000' }));
jest.mock('../shared/auth/providers', () => ({ nativeIdentity: jest.fn() }));
jest.mock('../../lib/time-zone', () => ({ deviceTimeZone: () => 'Africa/Cairo' }));

const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000a1',
  nameAr: 'حفظ القرآن',
  nameEn: 'Quran memorization',
};

const me = {
  userId: '0193a6f0-0000-7000-8000-000000000002',
  role: 'teacher' as const,
  displayName: 'سارة عادل',
  email: 'sara@example.com',
  gender: 'female' as const,
  dateOfBirth: '1988-05-02',
  preferredLanguage: 'ar' as const,
  timezone: 'Africa/Cairo',
  signInMethod: 'google' as const,
  memberSince: '2026-10-20T09:00:00Z',
  accountStatus: 'active' as const,
  landing: 'teacher_home' as const,
  teacher: {
    applicationStatus: 'approved' as const,
    verificationStatus: 'approved' as const,
    payout: { configured: false, verified: false },
  },
};

const pending = {
  credentialId: '0193a6f0-0000-7000-8000-0000000000c2',
  subject: QURAN,
  status: 'pending',
  submittedAt: '2026-10-21T09:00:00.000Z',
  document: {},
};

const inReview = {
  status: 'in_review',
  submittedAt: '2026-10-21T09:00:00.000Z',
  subjectCount: 1,
  callRecorded: false,
  approvedShown: false,
};

const ar = (key: Parameters<typeof translate>[1]) => translate('ar', key);

let queries: QueryClient;
const within = (ui: ReactElement) => (
  <QueryClientProvider client={queries}>{ui}</QueryClientProvider>
);

/** The paths an icon draws, to tell which icon a banner carries. */
async function drawingOf(name: IconName): Promise<unknown[]> {
  const drawn = await renderIn('rtl', <Icon name={name} />);
  const paths = nodesOf(drawn)
    .map((node) => node.props['d'])
    .filter((d) => d !== undefined);
  await drawn.unmount();
  return paths;
}

beforeEach(async () => {
  mockApi = fakeApi();
  mockApi.api.account.me.query.mockResolvedValue(me);
  mockApi.api.teacher.credentials.list.query.mockResolvedValue([pending]);
  mockApi.api.teacher.application.get.query.mockResolvedValue(inReview);
  mockApi.api.catalog.subjects.list.query.mockResolvedValue([QURAN]);
  await mockApi.sessions.store.write(tokens);
  setSession({ kind: 'signed-in', landing: 'teacher_home' });
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});
afterEach(() => onlineManager.setOnline(true));

describe('offline over cached data (T138)', () => {
  it('keeps the account tab under the offline banner', async () => {
    onlineManager.setOnline(false);
    await renderIn('rtl', within(<TeacherAccount />));
    expect(screen.getByText(ar('common.state.offline'))).toBeTruthy();
    expect(screen.getByText('سارة عادل')).toBeTruthy();
  });

  it('keeps the application’s status under the offline banner', async () => {
    queries.setQueryData(APPLICATION_QUERY_KEY, inReview);
    onlineManager.setOnline(false);
    await renderIn('rtl', within(<ApplicationStatus />));
    expect(screen.getByText(ar('common.state.offline'))).toBeTruthy();
    expect(screen.getByText(ar('teacher.application.status.receivedTitle'))).toBeTruthy();
  });

  it('keeps the list of credentials under the offline banner', async () => {
    queries.setQueryData(CREDENTIALS_QUERY_KEY, [pending]);
    onlineManager.setOnline(false);
    await renderIn('rtl', within(<TeacherCredentials />));
    expect(screen.getByText(ar('common.state.offline'))).toBeTruthy();
    expect(screen.getByText(QURAN.nameAr)).toBeTruthy();
  });

  it('draws no offline banner over the list while connected', async () => {
    queries.setQueryData(CREDENTIALS_QUERY_KEY, [pending]);
    await renderIn('rtl', within(<TeacherCredentials />));
    expect(screen.getByText(QURAN.nameAr)).toBeTruthy();
    expect(screen.queryByText(ar('common.state.offline'))).toBeNull();
  });

  it('keeps a form’s cached choices without the banner', async () => {
    queries.setQueryData(SUBJECTS_QUERY_KEY, [QURAN]);
    onlineManager.setOnline(false);
    await renderIn('rtl', within(<ApplySubjects />));
    expect(await screen.findByText(QURAN.nameAr)).toBeTruthy();
    expect(screen.queryByText(ar('common.state.offline'))).toBeNull();
  });
});

describe('nothing cached (T138)', () => {
  it('says there is no connection, with a retry, instead of loading for ever', async () => {
    onlineManager.setOnline(false);
    await renderIn('rtl', within(<TeacherCredentials />));
    expect(await screen.findByText(ar('common.state.offline'))).toBeTruthy();
    expect(screen.getByRole('link', { name: ar('common.action.retry') })).toBeTruthy();
  });

  it('says a failed read with the danger banner of LoadError and its retry', async () => {
    const warning = await drawingOf('triangle-alert');
    mockApi.api.teacher.payout.get.query.mockRejectedValue(apiError('INTERNAL'));
    const rendered = await renderIn('rtl', within(<Payout />));
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    const drawn = nodesOf(rendered).map((node) => node.props['d']);
    expect(warning.length).toBeGreaterThan(0);
    expect(warning.every((path) => drawn.includes(path))).toBe(true);
    mockApi.api.teacher.payout.get.query.mockResolvedValue({ state: 'not_configured' });
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await screen.findByText(ar('teacher.payout.start.heading'))).toBeTruthy();
  });
});
