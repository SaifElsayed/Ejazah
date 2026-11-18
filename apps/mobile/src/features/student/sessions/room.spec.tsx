// T019 of specs/004-sessions (FR-433, FR-435): the student's room, in Arabic and English, with the SDK
// mocked: it joins the session the route names, and a deleted counterparty is waited for by the
// student's stand-in for the other role (T007). The room's body is the shared one
// (`features/shared/room/room.spec.tsx`).
import type { MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { resetRooms, rooms } from '../../shared/room/__tests__/fake-room';
import { CAIRO, grant, roomApi, SESSION_ID, session } from '../../shared/room/__tests__/room-api';
import { Room } from './index';

jest.mock('livekit-client', () => require('../../shared/room/__tests__/fake-room'));
jest.mock('@livekit/react-native', () => require('../../shared/room/__tests__/fake-livekit-rn'));
// 005:T021, E1 (a): the report's idempotency key.
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `report-key-${++mockKey}` }));

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

// 005:T021, E1 (a) (the owner's «موافق على التلاتة», 2026-11-18; FR-611 «from a session they are a
// party of»): the live room's header carries the same report entry as the pre-session screen.
describe('the report from inside the room (005:T021, E1 (a))', () => {
  it('reports the teacher from the room, naming the session, and answers «received» only', async () => {
    const read = session();
    const create = jest.fn(async (_input: unknown) => ({ received: true }));
    const raise = jest.fn(async (_input: unknown) => ({ received: true }));
    Object.assign(mockApi.api, {
      reports: { create: { mutate: create } },
      genderFlags: { raise: { mutate: raise } },
    });
    mockApi.sessions.get.query.mockResolvedValue(read);
    await inBothDirections(ui, async (_rendered, direction) => {
      const name = read.counterparty.displayName ?? '';
      await fireEvent.press(
        await screen.findByRole('button', { name: said(direction, 'common.a11y.report') }),
      );
      const locale = direction === 'rtl' ? 'ar' : 'en';
      expect(
        screen.getByText(translate(locale, 'student.report.title', { teacher: name })),
      ).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('radio', { name: said(direction, 'student.report.reasons.misconduct') }),
      );
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'student.report.submit') }),
      );
      expect(await screen.findByText(said(direction, 'common.toast.reportSent'))).toBeTruthy();
      expect(create).toHaveBeenLastCalledWith({
        reportedUserId: read.counterparty.userId,
        context: 'session',
        sessionId: SESSION_ID,
        reason: said(direction, 'student.report.reasons.misconduct'),
        idempotencyKey: expect.any(String),
      });
    });
    expect(raise).not.toHaveBeenCalled();
  });
});
