// B41's integration (the note under T041, Q1 (a)): PreSessionScreen gains one role-neutral slot,
// `children`, which each role's wrapper fills with its own panels. The slot is drawn once the
// session is read, after the screen's rows, and never before it is read.
import type { MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react-native';
import { PermissionsAndroid, Platform, Text } from 'react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { ME_QUERY_KEY } from '../../../lib/account';
import { CAIRO, roomApi, session } from './__tests__/room-api';
import { PreSessionScreen } from './index';

jest.mock('livekit-client', () => require('./__tests__/fake-room'));

let mockApi = roomApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000c1' }),
}));

const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: CAIRO } as MeOutput;
const SLOT = 'the-role’s-panels';

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <PreSessionScreen counterpartyRole="teacher" roomRoute="/(student)/sessions/room">
      <Text>{SLOT}</Text>
    </PreSessionScreen>
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = roomApi();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  jest.useFakeTimers({ now: new Date('2026-11-11T15:50:00.000Z') });
});

afterEach(() => {
  queries.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('PreSessionScreen’s one slot (B41, Q1 (a))', () => {
  it('draws what the wrapper hands it once the session is read', async () => {
    mockApi.sessions.get.query.mockResolvedValue(session());
    await inBothDirections(ui, async () => {
      expect(await screen.findByText(SLOT)).toBeTruthy();
    });
  });

  it('draws nothing of it while the session is not read', async () => {
    mockApi.sessions.get.query.mockReturnValue(new Promise(() => undefined));
    await inBothDirections(ui, async () => {
      expect(screen.queryByText(SLOT)).toBeNull();
    });
  });
});
