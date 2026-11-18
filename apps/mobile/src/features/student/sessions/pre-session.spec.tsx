// T018 of specs/004-sessions (FR-434; screens.md `PreSession`): the student's pre-session screen, in
// Arabic and English: a deleted counterparty is the student's stand-in for the other role (T007), and
// the join opens the student's own room with the session's id. The screen's body is the shared one
// (`features/shared/room/pre-session.spec.tsx`).
import type { MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import { PermissionsAndroid, Platform } from 'react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { CAIRO, roomApi, SESSION_ID, session } from '../../shared/room/__tests__/room-api';
import { PreSession, STUDENT_ROOM_ROUTE } from './index';

jest.mock('livekit-client', () => require('../../shared/room/__tests__/fake-room'));
// 005:T021: the report's idempotency key.
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `report-key-${++mockKey}` }));

let mockApi = roomApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: (to: unknown) => mockPush(to) },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000c1' }),
}));

const said = (direction: Direction, key: Parameters<typeof translate>[1]) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);
const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: CAIRO } as MeOutput;

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <PreSession />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = roomApi();
  mockPush.mockReset();
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

describe('PreSession (FR-434)', () => {
  it('names a deleted counterparty by the stand-in, and opens the student’s room', async () => {
    mockApi.sessions.get.query.mockResolvedValue(
      session({
        counterparty: {
          userId: '0193a6f0-0000-7000-8000-0000000000b8',
          displayName: null,
          deleted: true,
        },
      }),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'common.party.deletedTeacher'))).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'session.pre.join') }),
      );
    });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: STUDENT_ROOM_ROUTE,
      params: { id: SESSION_ID },
    });
    expect(STUDENT_ROOM_ROUTE).toBe('/(student)/sessions/room');
    expect(mockApi.sessions.join.mutate).not.toHaveBeenCalled();
  });
});

// 005:T021 (FR-611; the note under T021, Q-T4 (a)): the report from a session, the student's
// reasons on the teacher, the teacher named by `sessions.get`'s `counterparty.userId`.
describe('the report from the session (005:T021, FR-611)', () => {
  it('reports the teacher, naming the session, and answers «received» only', async () => {
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
      expect(await screen.findByText(name)).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'common.a11y.report') }),
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
