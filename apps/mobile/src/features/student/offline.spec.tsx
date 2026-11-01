// T138 (FR-205): the student's data screens use the shared states. The account tab, a tab root,
// keeps its cached account under the offline banner while there is no connection (the `MainOffline`
// pattern); with nothing cached it says there is no connection instead of loading for ever; a failed
// read is the danger banner of `LoadError` with its retry.
import type { MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';

import { Icon } from '../../design/primitives';
import { nodesOf, renderIn } from '../../design/primitives/__tests__/harness';
import type { IconName } from '../../design/primitives/types';
import { translate } from '../../i18n';
import { ME_QUERY_KEY } from '../../lib/account';
import { setSession } from '../../lib/session';
import { apiError, fakeApi, tokens } from '../shared/__tests__/api-double';
import { StudentAccount } from './account';

let mockApi = fakeApi();
jest.mock('../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../shared/auth/providers', () => ({ nativeIdentity: jest.fn() }));
jest.mock('../../lib/time-zone', () => ({ deviceTimeZone: () => 'Africa/Cairo' }));

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

const ar = (key: Parameters<typeof translate>[1]) => translate('ar', key);

function account(cached: MeOutput | null) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached !== null) queries.setQueryData(ME_QUERY_KEY, cached);
  return (
    <QueryClientProvider client={queries}>
      <StudentAccount />
    </QueryClientProvider>
  );
}

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
  await mockApi.sessions.store.write(tokens);
  setSession({ kind: 'signed-in', landing: 'student_home' });
});
afterEach(() => onlineManager.setOnline(true));

describe('StudentAccount (T138)', () => {
  it('keeps the cached account under the offline banner while there is no connection', async () => {
    onlineManager.setOnline(false);
    await renderIn('rtl', account(me));
    expect(screen.getByText(ar('common.state.offline'))).toBeTruthy();
    expect(screen.getByText('أمل حسن')).toBeTruthy();
  });

  it('draws no offline banner while connected', async () => {
    await renderIn('rtl', account(me));
    expect(screen.getByText('أمل حسن')).toBeTruthy();
    expect(screen.queryByText(ar('common.state.offline'))).toBeNull();
  });

  it('says there is no connection, with a retry, when nothing is cached', async () => {
    onlineManager.setOnline(false);
    await renderIn('rtl', account(null));
    expect(await screen.findByText(ar('common.state.offline'))).toBeTruthy();
    expect(screen.getByRole('link', { name: ar('common.action.retry') })).toBeTruthy();
  });

  it('says a failed read with the danger banner of LoadError and its retry', async () => {
    const warning = await drawingOf('triangle-alert');
    mockApi.api.account.me.query.mockRejectedValue(apiError('INTERNAL'));
    const rendered = await renderIn('rtl', account(null));
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    const drawn = nodesOf(rendered).map((node) => node.props['d']);
    expect(warning.length).toBeGreaterThan(0);
    expect(warning.every((path) => drawn.includes(path))).toBe(true);
    mockApi.api.account.me.query.mockResolvedValue(me);
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(await screen.findByText('أمل حسن')).toBeTruthy();
  });
});
