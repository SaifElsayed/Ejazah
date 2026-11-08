// T019 of specs/004-sessions (FR-433, FR-435, FR-436, FR-500; US1 acceptance 5 and 6; research
// R-316; the notes under T019): the room, in Arabic and English, with the SDK mocked. It starts the
// audio session, asks `sessions.join` for the address and the token, connects with them and turns
// the microphone on: audio in every session. The camera and the screen share are each the
// participant's own choice, off until turned on, and nothing about them goes to the API; before the
// whole screen is shared FR-500's warning comes every time, and a cancel starts nothing. A dropped
// connection is the SDK's to rejoin; a lost room is asked of `sessions.join` again after 2, 4, 8
// and 16 s, then every 30 s, until a final refusal or the scheduled end. Leaving disconnects, then
// stops the audio session.
import type { MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AudioSession } from '@livekit/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { apiError } from '../__tests__/api-double';
import {
  DisconnectReason,
  FakeRoom,
  resetRooms,
  Room,
  RoomEvent,
  rooms,
  Track,
} from './__tests__/fake-room';
import { CAIRO, grant, roomApi, SESSION_ID, session } from './__tests__/room-api';
import { RoomScreen } from './index';

jest.mock('livekit-client', () => require('./__tests__/fake-room'));
jest.mock('@livekit/react-native', () => require('./__tests__/fake-livekit-rn'));

let mockApi = roomApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000c1' }),
}));

const startAudio = AudioSession.startAudioSession as unknown as jest.Mock;
const stopAudio = AudioSession.stopAudioSession as unknown as jest.Mock;
const join = () => mockApi.sessions.join.mutate;

/** The session's start; it ends at 16:45. */
const START = '2026-11-11T16:00:00.000Z';
const WARNING =
  'إذا شاركت الشاشة كاملة، سيرى الطرف الآخر كل ما يظهر عليها، بما في ذلك الإشعارات. أغلق ما لا تريد مشاركته قبل المتابعة.';

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(localeOf(direction), key, values);
const press = async (direction: Direction, key: MessageKey) =>
  fireEvent.press(screen.getByRole('button', { name: said(direction, key) }));

const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: CAIRO } as MeOutput;

let queries: QueryClient;
const ui = (): ReactElement => (
  <QueryClientProvider client={queries}>
    <RoomScreen counterpartyRole="teacher" />
  </QueryClientProvider>
);

/** Runs the pending effects and the timers of `ms` milliseconds. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/** The room the screen holds now. */
const room = (): FakeRoom => {
  const last = rooms.at(-1);
  if (last === undefined) throw new Error('no room was made');
  return last;
};

/** The room is lost: the provider closed it, not the participant. */
async function lose(reason: number = DisconnectReason.SIGNAL_CLOSE) {
  await act(async () => {
    room().emit(RoomEvent.Disconnected, reason);
    await Promise.resolve();
  });
}

let request: jest.SpiedFunction<typeof PermissionsAndroid.request>;

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(START) });
  mockApi = roomApi();
  mockApi.sessions.get.query.mockResolvedValue(session());
  mockApi.sessions.join.mutate.mockResolvedValue(grant());
  mockBack.mockReset();
  startAudio.mockClear();
  stopAudio.mockClear();
  resetRooms();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
  jest.replaceProperty(Platform, 'OS', 'android');
  request = jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
});

afterEach(() => {
  queries.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('RoomScreen: joining (FR-433, FR-436)', () => {
  it('starts the audio, joins with sessions.join’s address and token, and turns the microphone on', async () => {
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(
        await screen.findByText(said(direction, 'session.room.waitingFor', { name: 'يوسف أحمد' })),
      ).toBeTruthy();
    });
    expect(join()).toHaveBeenCalledWith({ sessionId: SESSION_ID });
    expect(startAudio.mock.invocationCallOrder[0]).toBeLessThan(
      join().mock.invocationCallOrder[0] ?? 0,
    );
    expect(room().connect).toHaveBeenCalledWith('wss://video.ijazah.test', 'token-1');
    expect(room().localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(room().localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it('draws the counterparty once they join, their camera and their screen when they share', async () => {
    await renderIn('rtl', ui());
    expect(
      await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' })),
    ).toBeTruthy();
    await act(async () => {
      room().join('teacher-1');
    });
    expect(
      screen.queryByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' })),
    ).toBeNull();
    expect(screen.getAllByText('يوسف أحمد').length).toBeGreaterThan(0);
    const remote = room().remoteParticipants.get('teacher-1');
    await act(async () => {
      remote?.publications.set(Track.Source.Camera, {
        isSubscribed: true,
        isMuted: false,
        track: {},
      });
      room().emit(RoomEvent.TrackSubscribed);
    });
    expect(screen.getByTestId('video:teacher-1:camera')).toBeTruthy();
    await act(async () => {
      remote?.publications.set(Track.Source.ScreenShare, {
        isSubscribed: true,
        isMuted: false,
        track: {},
      });
      room().emit(RoomEvent.TrackSubscribed);
    });
    expect(screen.getByTestId('video:teacher-1:screen_share')).toBeTruthy();
  });

  it('leaves a room whose microphone failed, and says the join did not go through', async () => {
    Room.mockImplementationOnce(() => {
      const made = new FakeRoom();
      made.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(new Error('no microphone'));
      rooms.push(made);
      return made;
    });
    await renderIn('rtl', ui());
    expect(await screen.findByText(said('rtl', 'common.state.actionError'))).toBeTruthy();
    expect(room().disconnect).toHaveBeenCalledTimes(1);
    expect(room().listenerCount()).toBe(0);
    await advance(10 * 60_000);
    expect(join()).toHaveBeenCalledTimes(1);
  });

  it('says when joining opens, a final refusal, and retries a failed first join', async () => {
    join().mockRejectedValueOnce(
      apiError('JOIN_NOT_OPEN', [{ path: 'opensAt', code: '2026-11-11T15:45:00.000Z' }]),
    );
    await renderIn('rtl', ui());
    expect(await screen.findByText(said('rtl', 'session.pre.opensAt'))).toBeTruthy();
    await screen.unmount();

    join().mockRejectedValueOnce(apiError('ACCOUNT_RESTRICTED'));
    await renderIn('ltr', ui());
    expect(await screen.findByText(said('ltr', 'session.pre.unavailable'))).toBeTruthy();
    await screen.unmount();

    join().mockRejectedValueOnce(new Error('offline'));
    await renderIn('rtl', ui());
    await press('rtl', 'common.action.retry');
    expect(
      await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' })),
    ).toBeTruthy();
  });
});

describe('RoomScreen: the camera and the screen share are the participant’s own (FR-433)', () => {
  it('turns the camera on and off, asking Android for the camera and the API for nothing', async () => {
    await inBothDirections(ui, async (_rendered, direction) => {
      await screen.findByText(said(direction, 'session.room.waitingFor', { name: 'يوسف أحمد' }));
      await press(direction, 'session.room.cameraOn');
      expect(room().localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(true);
      expect(await screen.findByTestId('video:me:camera')).toBeTruthy();
      await press(direction, 'session.room.cameraOff');
      expect(room().localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(false);
    });
    expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.CAMERA);
    // One join per render (two directions, two schemes each), and nothing else.
    expect(join()).toHaveBeenCalledTimes(4);
    expect(mockApi.sessions.get.query.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('keeps the camera off when Android refuses it', async () => {
    request.mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
    await press('rtl', 'session.room.cameraOn');
    expect(await screen.findByText(said('rtl', 'session.room.cameraDenied'))).toBeTruthy();
    expect(room().localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });

  it('warns before every whole-screen share; a cancel starts nothing (FR-500)', async () => {
    await inBothDirections(ui, async (_rendered, direction) => {
      await screen.findByText(said(direction, 'session.room.waitingFor', { name: 'يوسف أحمد' }));
      const share = room().localParticipant.setScreenShareEnabled;
      await press(direction, 'session.room.shareScreen');
      expect(screen.getByText(said(direction, 'session.room.screenShare.warning'))).toBeTruthy();
      await press(direction, 'common.action.cancel');
      expect(screen.queryByText(said(direction, 'session.room.screenShare.warning'))).toBeNull();
      expect(share).not.toHaveBeenCalled();
      // Every time: the warning comes again, and only a continue starts the share.
      await press(direction, 'session.room.shareScreen');
      expect(screen.getByText(said(direction, 'session.room.screenShare.warning'))).toBeTruthy();
      expect(share).not.toHaveBeenCalled();
      await press(direction, 'common.action.continue');
      expect(share).toHaveBeenCalledWith(true);
      // Stopping asks nothing.
      await press(direction, 'session.room.stopShare');
      expect(share).toHaveBeenLastCalledWith(false);
      expect(screen.queryByText(said(direction, 'session.room.screenShare.warning'))).toBeNull();
    });
    expect(join()).toHaveBeenCalledTimes(4);
  });

  it('says FR-500’s warning word for word, with «متابعة» and «إلغاء»', () => {
    expect(translate('ar', 'session.room.screenShare.warning')).toBe(WARNING);
    expect(translate('ar', 'common.action.continue')).toBe('متابعة');
    expect(translate('ar', 'common.action.cancel')).toBe('إلغاء');
  });
});

describe('RoomScreen: a dropped connection and a lost room (FR-435)', () => {
  it('leaves a dropped connection to the SDK, saying it reconnects', async () => {
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
    await act(async () => {
      room().emit(RoomEvent.Reconnecting);
    });
    expect(screen.getByText(said('rtl', 'session.room.reconnecting'))).toBeTruthy();
    await act(async () => {
      room().emit(RoomEvent.Reconnected);
    });
    expect(screen.queryByText(said('rtl', 'session.room.reconnecting'))).toBeNull();
    await advance(120_000);
    expect(join()).toHaveBeenCalledTimes(1);
  });

  it('asks again after 2, 4, 8 and 16 s, then every 30 s', async () => {
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
    join().mockRejectedValue(new Error('offline'));
    await lose();
    expect(screen.getByText(said('rtl', 'session.room.reconnecting'))).toBeTruthy();
    const calls = () => join().mock.calls.length;
    await advance(1_999);
    expect(calls()).toBe(1);
    await advance(1);
    expect(calls()).toBe(2);
    await advance(3_999);
    expect(calls()).toBe(2);
    await advance(1);
    expect(calls()).toBe(3);
    await advance(8_000);
    expect(calls()).toBe(4);
    await advance(16_000);
    expect(calls()).toBe(5);
    await advance(30_000);
    expect(calls()).toBe(6);
    await advance(30_000);
    expect(calls()).toBe(7);
  });

  it('returns to a room made again, and starts the backoff afresh on the next loss', async () => {
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
    const first = room();
    await lose(DisconnectReason.ROOM_DELETED);
    await advance(2_000);
    expect(join()).toHaveBeenCalledTimes(2);
    expect(rooms).toHaveLength(2);
    expect(first.listenerCount()).toBe(0);
    expect(room().connect).toHaveBeenCalledWith('wss://video.ijazah.test', 'token-1');
    expect(room().localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(screen.queryByText(said('rtl', 'session.room.reconnecting'))).toBeNull();
    await lose();
    await advance(2_000);
    expect(join()).toHaveBeenCalledTimes(3);
  });

  it('turns the camera back on in the room made again when it was on', async () => {
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
    await press('rtl', 'session.room.cameraOn');
    await lose();
    await advance(2_000);
    expect(room().localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(room().localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it('stops trying when the same account joins from another device, and says so (the note under T019)', async () => {
    await inBothDirections(ui, async (_rendered, direction) => {
      await screen.findByText(said(direction, 'session.room.waitingFor', { name: 'يوسف أحمد' }));
      join().mockClear();
      await lose(DisconnectReason.DUPLICATE_IDENTITY);
      expect(screen.getByText(said(direction, 'session.room.anotherDevice.message'))).toBeTruthy();
      expect(
        screen.getByRole('button', { name: said(direction, 'session.room.anotherDevice.action') }),
      ).toBeTruthy();
      await advance(5 * 60_000);
      expect(join()).not.toHaveBeenCalled();
    });
  });

  it('joins once for each press of «الدخول من هذا الجهاز», with no backoff after it', async () => {
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
    await lose(DisconnectReason.DUPLICATE_IDENTITY);
    join().mockClear();
    join().mockRejectedValueOnce(new Error('offline'));
    await press('rtl', 'session.room.anotherDevice.action');
    await advance(0);
    expect(join()).toHaveBeenCalledTimes(1);
    expect(screen.getByText(said('rtl', 'session.room.anotherDevice.message'))).toBeTruthy();
    await advance(5 * 60_000);
    expect(join()).toHaveBeenCalledTimes(1);
    await press('rtl', 'session.room.anotherDevice.action');
    await advance(0);
    expect(join()).toHaveBeenCalledTimes(2);
    expect(room().connect).toHaveBeenCalledWith('wss://video.ijazah.test', 'token-1');
    expect(screen.queryByText(said('rtl', 'session.room.anotherDevice.message'))).toBeNull();
  });

  it('offers the press only until the scheduled end', async () => {
    jest.setSystemTime(new Date('2026-11-11T16:44:50.000Z'));
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
    await lose(DisconnectReason.DUPLICATE_IDENTITY);
    expect(screen.getByText(said('rtl', 'session.room.anotherDevice.message'))).toBeTruthy();
    await advance(11_000);
    expect(screen.getByText(said('rtl', 'session.room.ended'))).toBeTruthy();
    expect(screen.queryByText(said('rtl', 'session.room.anotherDevice.message'))).toBeNull();
  });

  it('stops at a final refusal', async () => {
    await renderIn('ltr', ui());
    await screen.findByText(said('ltr', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
    join().mockRejectedValue(apiError('SESSION_NOT_SCHEDULED'));
    await lose();
    await advance(2_000);
    expect(join()).toHaveBeenCalledTimes(2);
    expect(screen.getByText(said('ltr', 'session.pre.unavailable'))).toBeTruthy();
    await advance(10 * 60_000);
    expect(join()).toHaveBeenCalledTimes(2);
  });

  it('stops at the scheduled end', async () => {
    jest.setSystemTime(new Date('2026-11-11T16:44:50.000Z'));
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
    join().mockRejectedValue(new Error('offline'));
    await lose();
    // 16:44:52 and 16:44:56; the next, at 16:45:04, would come after the end.
    await advance(6_000);
    expect(join()).toHaveBeenCalledTimes(3);
    await advance(4_000);
    expect(screen.getByText(said('rtl', 'session.room.ended'))).toBeTruthy();
    await advance(10 * 60_000);
    expect(join()).toHaveBeenCalledTimes(3);
  });
});

describe('RoomScreen: leaving the room', () => {
  it('disconnects, then stops the audio, and goes back; nothing joins again', async () => {
    await inBothDirections(ui, async (_rendered, direction) => {
      await screen.findByText(said(direction, 'session.room.waitingFor', { name: 'يوسف أحمد' }));
      const left = room();
      await press(direction, 'session.room.leave');
      expect(left.disconnect).toHaveBeenCalledTimes(1);
      expect(stopAudio.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
        left.disconnect.mock.invocationCallOrder[0] ?? 0,
      );
    });
    expect(mockBack).toHaveBeenCalledTimes(2);
    const before = join().mock.calls.length;
    await advance(10 * 60_000);
    expect(join().mock.calls.length).toBe(before);
  });

  it('disconnects and stops the audio when the screen goes away, with no timer left', async () => {
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
    join().mockRejectedValue(new Error('offline'));
    await lose();
    const lost = room();
    await screen.unmount();
    expect(stopAudio).toHaveBeenCalled();
    expect(lost.listenerCount()).toBe(0);
    await advance(10 * 60_000);
    expect(join()).toHaveBeenCalledTimes(1);
  });
});
