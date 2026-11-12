// B41's integration (004:T041, T042, T043; the note under T041, Q1 (a)): the student's session
// screen composes its panels in PreSessionScreen's one slot: the cancellation and the dispute
// (shared, identical for both roles) and the student's remedy (`features/student/remedies/`), in
// Arabic and English. Each panel's own behaviour is its lane's spec; this one proves the wrapper
// draws them.
import type { MeOutput, RemedyView } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react-native';
import { PermissionsAndroid, Platform } from 'react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { CAIRO, roomApi, session } from '../../shared/room/__tests__/room-api';
import { PreSession } from './index';

jest.mock('livekit-client', () => require('../../shared/room/__tests__/fake-room'));

let mockApi = roomApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000c1' }),
}));

const said = (direction: Direction, key: Parameters<typeof translate>[1]) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);
const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: CAIRO } as MeOutput;

const remedy: RemedyView = {
  status: 'awaiting_choice',
  kind: 'makeup',
  offeredAt: '2026-11-11T10:00:00.000Z',
  choiceClosesAt: '2026-11-18T10:00:00.000Z',
  proposal: {
    localDate: '2026-11-25',
    startTimeLocal: '18:00',
    timezone: CAIRO,
    startsAt: '2026-11-25T16:00:00.000Z',
  },
  canChooseRefund: true,
};

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <PreSession />
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

describe('the student’s session screen composes its panels (B41, Q1 (a))', () => {
  it('draws the cancellation request on a scheduled session before its start', async () => {
    mockApi.sessions.get.query.mockResolvedValue(session());
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(
        await screen.findByRole('button', {
          name: said(direction, 'session.cancellation.request'),
        }),
      ).toBeTruthy();
    });
  });

  it('draws the dispute while the session may be disputed', async () => {
    mockApi.sessions.get.query.mockResolvedValue(
      session({
        status: 'done',
        canRaiseDispute: true,
        disputeClosesAt: '2026-11-14T16:45:00.000Z',
      }),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(
        await screen.findByRole('button', { name: said(direction, 'session.dispute.raise') }),
      ).toBeTruthy();
    });
  });

  it('draws the student’s remedy while one is offered', async () => {
    mockApi.sessions.get.query.mockResolvedValue(session({ status: 'teacher_no_show', remedy }));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'student.remedy.title'))).toBeTruthy();
    });
  });
});
