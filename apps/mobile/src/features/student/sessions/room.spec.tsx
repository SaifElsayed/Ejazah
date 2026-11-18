// T019 of specs/004-sessions (FR-433, FR-435): the student's room, in Arabic and English, with the SDK
// mocked: it joins the session the route names, and a deleted counterparty is waited for by the
// student's stand-in for the other role (T007). The room's body is the shared one
// (`features/shared/room/room.spec.tsx`).
import type { MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { resetRooms, rooms } from '../../shared/room/__tests__/fake-room';
import { CAIRO, grant, roomApi, SESSION_ID, session } from '../../shared/room/__tests__/room-api';
import { Room } from './index';

jest.mock('livekit-client', () => require('../../shared/room/__tests__/fake-room'));
jest.mock('@livekit/react-native', () => require('../../shared/room/__tests__/fake-livekit-rn'));

let mockApi = roomApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000c1' }),
  // B40a: the room holds the system's back until it has left (T019's follow-up (a)).
  usePreventRemove: () => () => undefined,
}));

const said = (direction: Direction, key: Parameters<typeof translate>[1]) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);
const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: CAIRO } as MeOutput;

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <Room />
  </QueryClientProvider>
);

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-11T16:00:00.000Z') });
  mockApi = roomApi();
  mockApi.sessions.get.query.mockResolvedValue(
    session({
      counterparty: {
        userId: '0193a6f0-0000-7000-8000-0000000000b8',
        displayName: null,
        deleted: true,
      },
    }),
  );
  mockApi.sessions.join.mutate.mockResolvedValue(grant());
  resetRooms();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(() => {
  queries.clear();
  jest.useRealTimers();
});

describe('Room (FR-433)', () => {
  it('joins the session the route names, waiting for a deleted counterparty by the stand-in', async () => {
    await inBothDirections(ui, async (_rendered, direction) => {
      const name = said(direction, 'common.party.deletedTeacher');
      expect(
        await screen.findByText(
          translate(direction === 'rtl' ? 'ar' : 'en', 'session.room.waitingFor', { name }),
        ),
      ).toBeTruthy();
    });
    expect(mockApi.sessions.join.mutate).toHaveBeenCalledWith({ sessionId: SESSION_ID });
    expect(rooms.at(-1)?.connect).toHaveBeenCalledWith('wss://video.ijazah.test', 'token-1');
  });
});
