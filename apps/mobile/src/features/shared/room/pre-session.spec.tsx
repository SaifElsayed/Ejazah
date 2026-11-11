// T018 of specs/004-sessions (FR-434, FR-494, FR-499; US1 acceptance 1 and 4; ADR 0009 D5): the
// pre-session screen, in Arabic and English. From `sessions.get`: the counterparty's name, the
// scheduled length, the start in the session's zone and in the viewer's (one line when they are one
// zone); before the lead, when joining opens, in both zones (the instant `JOIN_NOT_OPEN` carries as
// `opensAt`); the microphone granted here, the join waiting for it; the camera off, turned on only in
// the room. The screen asks the server for no token: the room does (T019).
import type { MeOutput } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking, PermissionsAndroid, Platform } from 'react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatTime, formatWeekdayDate } from '../../../lib/formatters';
import { apiError } from '../__tests__/api-double';
import { CAIRO, DUBAI, roomApi, SESSION_ID, session } from './__tests__/room-api';
import { PreSessionScreen } from './index';

jest.mock('livekit-client', () => require('./__tests__/fake-room'));

let mockApi = roomApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockBack = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = { id: SESSION_ID };
jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: (to: unknown) => mockPush(to) },
  useLocalSearchParams: () => mockParams,
}));

const ROOM = '/(student)/sessions/room';
/** Inside the join period: ten minutes before the start. */
const OPEN = '2026-11-11T15:50:00.000Z';
/** An hour before the lead. */
const EARLY = '2026-11-11T14:45:00.000Z';

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(localeOf(direction), key, values);
const lineIn = (direction: Direction, instant: string, zone: string) =>
  said(direction, 'session.pre.timeIn', {
    date: formatWeekdayDate(instant, zone, localeOf(direction)),
    time: formatTime(instant, zone, localeOf(direction)),
    city: cityOf(zone, localeOf(direction)) ?? zone,
  });
/** The text on screen, marks and all: the screen renders what `translate` answers. */
const shown = (text: string) => screen.getByText(text);
const absent = (text: string) => screen.queryByText(text);

const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: DUBAI } as MeOutput;

let queries: QueryClient;
const ui = (): ReactElement => (
  <QueryClientProvider client={queries}>
    <PreSessionScreen counterpartyRole="teacher" roomRoute={ROOM} />
  </QueryClientProvider>
);

let check: jest.SpiedFunction<typeof PermissionsAndroid.check>;
let request: jest.SpiedFunction<typeof PermissionsAndroid.request>;

beforeEach(() => {
  mockApi = roomApi();
  mockBack.mockReset();
  mockPush.mockReset();
  mockParams = { id: SESSION_ID };
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
  jest.replaceProperty(Platform, 'OS', 'android');
  check = jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  request = jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  jest.useFakeTimers({ now: new Date(OPEN) });
});

afterEach(() => {
  queries.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('PreSessionScreen (FR-434, FR-494)', () => {
  it('names the counterparty, the length, and the start in the session’s zone and the viewer’s', async () => {
    mockApi.sessions.get.query.mockResolvedValue(session());
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
      expect(shown(said(direction, 'session.pre.title'))).toBeTruthy();
      expect(shown(said(direction, 'session.pre.duration'))).toBeTruthy();
      expect(shown(said(direction, 'common.format.duration', { minutes: 45 }))).toBeTruthy();
      expect(shown(said(direction, 'session.pre.startsAt'))).toBeTruthy();
      expect(shown(lineIn(direction, '2026-11-11T16:00:00.000Z', CAIRO))).toBeTruthy();
      expect(shown(lineIn(direction, '2026-11-11T16:00:00.000Z', DUBAI))).toBeTruthy();
      // Inside the join period the opening is not shown.
      expect(absent(said(direction, 'session.pre.opensAt'))).toBeNull();
    });
    expect(mockApi.sessions.get.query).toHaveBeenCalledWith({ sessionId: SESSION_ID });
  });

  it('says the start once when the viewer lives in the session’s zone', async () => {
    queries.setQueryData(ME_QUERY_KEY, { ...me, timezone: CAIRO });
    mockApi.sessions.get.query.mockResolvedValue(session());
    await renderIn('rtl', ui());
    expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
    const line = lineIn('rtl', '2026-11-11T16:00:00.000Z', CAIRO);
    expect(screen.getAllByText(line)).toHaveLength(1);
  });

  it('draws the stand-in for a deleted counterparty', async () => {
    mockApi.sessions.get.query.mockResolvedValue(
      session({ counterparty: { displayName: null, deleted: true } }),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'common.party.deletedTeacher'))).toBeTruthy();
    });
  });

  it('before the lead, says when joining opens in both zones, and the join waits (US1 acceptance 1)', async () => {
    jest.setSystemTime(new Date(EARLY));
    mockApi.sessions.get.query.mockResolvedValue(session());
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
      expect(shown(said(direction, 'session.pre.opensAt'))).toBeTruthy();
      expect(shown(lineIn(direction, '2026-11-11T15:45:00.000Z', CAIRO))).toBeTruthy();
      expect(shown(lineIn(direction, '2026-11-11T15:45:00.000Z', DUBAI))).toBeTruthy();
      const join = screen.getByRole('button', { name: said(direction, 'session.pre.join') });
      expect(join.props.accessibilityState?.disabled).toBe(true);
    });
    expect(mockApi.sessions.join.mutate).not.toHaveBeenCalled();
  });

  it('opens the join at opensAt with no read of the server, and enters the room', async () => {
    jest.setSystemTime(new Date('2026-11-11T15:44:00.000Z'));
    mockApi.sessions.get.query.mockResolvedValue(session());
    await renderIn('rtl', ui());
    expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
    const name = said('rtl', 'session.pre.join');
    expect(screen.getByRole('button', { name }).props.accessibilityState?.disabled).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    const join = await screen.findByRole('button', { name });
    expect(join.props.accessibilityState?.disabled).toBe(false);
    await fireEvent.press(join);
    expect(mockPush).toHaveBeenCalledWith({ pathname: ROOM, params: { id: SESSION_ID } });
    expect(mockApi.sessions.get.query).toHaveBeenCalledTimes(1);
    expect(mockApi.sessions.join.mutate).not.toHaveBeenCalled();
  });

  it('shows the microphone working and the camera off, asking for neither', async () => {
    mockApi.sessions.get.query.mockResolvedValue(session());
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
      expect(shown(said(direction, 'session.pre.mic'))).toBeTruthy();
      expect(shown(said(direction, 'session.pre.micStatus.working'))).toBeTruthy();
      expect(shown(said(direction, 'session.pre.camera'))).toBeTruthy();
      expect(shown(said(direction, 'session.pre.cameraStatus.off'))).toBeTruthy();
      expect(shown(said(direction, 'session.pre.cameraInRoom'))).toBeTruthy();
    });
    expect(request).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    expect(check).not.toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.CAMERA);
  });

  it('grants the microphone here, and the join waits for it (US1 acceptance 4)', async () => {
    check.mockResolvedValue(false);
    mockApi.sessions.get.query.mockResolvedValue(session());
    await renderIn('ltr', ui());
    expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
    const join = () => screen.getByRole('button', { name: said('ltr', 'session.pre.join') });
    expect(join().props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(
      screen.getByRole('button', { name: said('ltr', 'session.pre.allowMic') }),
    );
    expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    expect(await screen.findByText(said('ltr', 'session.pre.micStatus.working'))).toBeTruthy();
    expect(join().props.accessibilityState?.disabled).toBe(false);
  });

  it('sends a microphone refused for good to the system settings', async () => {
    check.mockResolvedValue(false);
    request.mockResolvedValue(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    mockApi.sessions.get.query.mockResolvedValue(session());
    await renderIn('rtl', ui());
    expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: said('rtl', 'session.pre.allowMic') }),
    );
    expect(await screen.findByText(said('rtl', 'session.pre.permission.banner'))).toBeTruthy();
    expect(shown(said('rtl', 'session.pre.micStatus.denied'))).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: said('rtl', 'session.pre.permission.openSettings') }),
    );
    expect(openSettings).toHaveBeenCalledTimes(1);
    const join = screen.getByRole('button', { name: said('rtl', 'session.pre.join') });
    expect(join.props.accessibilityState?.disabled).toBe(true);
  });

  it('says a session past its end, or no longer scheduled, cannot be joined', async () => {
    jest.setSystemTime(new Date('2026-11-11T16:45:00.000Z'));
    mockApi.sessions.get.query.mockResolvedValue(session());
    await renderIn('rtl', ui());
    expect(await screen.findByText(said('rtl', 'session.pre.unavailable'))).toBeTruthy();
    let join = screen.getByRole('button', { name: said('rtl', 'session.pre.join') });
    expect(join.props.accessibilityState?.disabled).toBe(true);
    await screen.unmount();

    jest.setSystemTime(new Date(OPEN));
    queries.clear();
    queries.setQueryData(ME_QUERY_KEY, me);
    mockApi.sessions.get.query.mockResolvedValue(session({ status: 'cancelled_by_agreement' }));
    await renderIn('ltr', ui());
    expect(await screen.findByText(said('ltr', 'session.pre.unavailable'))).toBeTruthy();
    expect(shown(said('ltr', 'status.session.cancelledByAgreement'))).toBeTruthy();
    join = screen.getByRole('button', { name: said('ltr', 'session.pre.join') });
    expect(join.props.accessibilityState?.disabled).toBe(true);
  });

  it('says a session it may not see cannot be joined, and retries a failed read', async () => {
    mockApi.sessions.get.query.mockRejectedValueOnce(apiError('NOT_FOUND'));
    await renderIn('rtl', ui());
    expect(await screen.findByText(said('rtl', 'session.pre.unavailable'))).toBeTruthy();
    await screen.unmount();

    queries.clear();
    queries.setQueryData(ME_QUERY_KEY, me);
    mockApi.sessions.get.query
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(session());
    await renderIn('rtl', ui());
    await fireEvent.press(
      await screen.findByRole('button', { name: said('rtl', 'common.action.retry') }),
    );
    expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
  });

  // T065 (the owner's decision of 2026-11-06, the RATE_LIMITED message): the screen's failed read
  // hands its error to `NotLoaded`, which says when to try again.
  it('says when to try again when sessions.get is refused RATE_LIMITED (T065)', async () => {
    mockApi.sessions.get.query.mockRejectedValue(
      apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(
        await screen.findByText(said(direction, 'common.state.rateLimitedIn', { count: 2 })),
      ).toBeTruthy();
      expect(absent(said(direction, 'common.state.loadError'))).toBeNull();
    });
  });

  it('goes back where it was opened from', async () => {
    mockApi.sessions.get.query.mockResolvedValue(session());
    await renderIn('rtl', ui());
    expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: said('rtl', 'common.a11y.back') }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

// T065 of specs/004-sessions (FR-427; research R-324, item 6; contracts/app-surface.md, `sessions.get`):
// the counterparty's presence before joining, from `sessions.get`'s `counterpartyInRoom`, recorded
// from the video provider's webhooks. A hint only: the join waits for the period and the microphone
// as before, whatever it says.
describe('PreSessionScreen: the counterparty in the room (T065, FR-427)', () => {
  it('says «انضمّ الطرف الآخر» while sessions.get says the counterparty is in the room', async () => {
    mockApi.sessions.get.query.mockResolvedValue(session({ counterpartyInRoom: true }));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
      expect(shown(said(direction, 'session.pre.counterpartyInRoom'))).toBeTruthy();
    });
    expect(translate('ar', 'session.pre.counterpartyInRoom')).toContain('انضمّ الطرف الآخر');
  });

  it('says nothing of it while they are not, and decides nothing by it', async () => {
    mockApi.sessions.get.query.mockResolvedValue(session({ counterpartyInRoom: false }));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
      expect(absent(said(direction, 'session.pre.counterpartyInRoom'))).toBeNull();
    });
    jest.setSystemTime(new Date(EARLY));
    queries.removeQueries({ queryKey: ['sessions'] });
    mockApi.sessions.get.query.mockResolvedValue(session({ counterpartyInRoom: true }));
    await renderIn('rtl', ui());
    expect(await screen.findByText(said('rtl', 'session.pre.counterpartyInRoom'))).toBeTruthy();
    const join = screen.getByRole('button', { name: said('rtl', 'session.pre.join') });
    expect(join.props.accessibilityState?.disabled).toBe(true);
  });
});
