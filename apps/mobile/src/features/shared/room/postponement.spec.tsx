// 003:T112 (SRS FR-POSTPONE-5, DEC-90): the pre-session screen of a postponed session, in Arabic and
// English: its status «مؤجلة», and which party postponed it with the reason, from `sessions.get`'s
// `postponement`, worded for the viewer (the student who postponed reads «بطلبك»; the teacher reads
// the student's postponement as the student's).
import type { MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react-native';
import { PermissionsAndroid, Platform } from 'react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import type { PartyRole } from '../../../lib/party';
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
const REASON = 'امتحانات نهاية الفصل';
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);

let queries: QueryClient;
const ui = (counterpartyRole: PartyRole) => () => (
  <QueryClientProvider client={queries}>
    <PreSessionScreen counterpartyRole={counterpartyRole} roomRoute="/room" />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = roomApi();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  jest.useFakeTimers({ now: new Date('2026-11-10T15:50:00.000Z') });
});

afterEach(() => {
  queries.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const postponed = session({
  status: 'postponed',
  postponement: { by: 'student', reason: REASON, at: '2026-11-09T09:00:00.000Z' },
});

describe('PreSessionScreen: a postponed session (T112, FR-POSTPONE-5)', () => {
  it('tells the student who postponed it «postponed at your request», with the reason', async () => {
    mockApi.sessions.get.query.mockResolvedValue(postponed);
    await inBothDirections(ui('teacher'), async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'status.session.postponed'))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'postponement.shown.byMe', { reason: REASON })),
      ).toBeTruthy();
    });
  });

  it('tells the teacher the student postponed it, with the reason', async () => {
    mockApi.sessions.get.query.mockResolvedValue(postponed);
    await inBothDirections(ui('student'), async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'status.session.postponed'))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'postponement.shown.byStudent', { reason: REASON })),
      ).toBeTruthy();
    });
  });
});
