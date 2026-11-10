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
import { startRoomKeepAlive, stopRoomKeepAlive } from '../../../lib/room-keep-alive';
import { apiError } from '../__tests__/api-double';
import {
  DisconnectReason,
  FakeRoom,
  type FakeScreenTrack,
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
jest.mock('../../../lib/room-keep-alive', () => ({
  startRoomKeepAlive: jest.fn(() => Promise.resolve()),
  stopRoomKeepAlive: jest.fn(),
}));

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
const startKeepAlive = startRoomKeepAlive as unknown as jest.Mock<
  (...args: unknown[]) => Promise<void>
>;
const stopKeepAlive = stopRoomKeepAlive as unknown as jest.Mock;

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

/** A promise a spec settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

/** The next room made, as `prepare` sets it up. */
function nextRoom(prepare: (made: FakeRoom) => void) {
  Room.mockImplementationOnce(() => {
    const made = new FakeRoom();
    prepare(made);
    rooms.push(made);
    return made;
  });
}

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
  startKeepAlive.mockClear();
  stopKeepAlive.mockClear();
  resetRooms();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(36);
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
      const share = room().localParticipant.createScreenTracks;
      const stop = room().localParticipant.setScreenShareEnabled;
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
      await advance(0);
      expect(share).toHaveBeenCalledTimes(1);
      expect(room().localParticipant.publishTrack).toHaveBeenCalledWith(
        room().localParticipant.screenTrack,
      );
      // Stopping asks nothing.
      await press(direction, 'session.room.stopShare');
      expect(stop).toHaveBeenLastCalledWith(false);
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
    await advance(0);
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

describe('RoomScreen: what the review at 3a14fc7 and the device check found (the notes under T019)', () => {
  const inRoom = async () => {
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
  };
  const cameraOn = async () => {
    await press('rtl', 'session.room.cameraOn');
    await advance(0);
  };
  const share = async () => {
    await press('rtl', 'session.room.shareScreen');
    await press('rtl', 'common.action.continue');
    await advance(0);
  };

  it('goes back one screen however many times leaving is pressed', async () => {
    await inRoom();
    const pending = deferred<void>();
    room().disconnect.mockReturnValueOnce(pending.promise);
    await press('rtl', 'session.room.leave');
    await press('rtl', 'session.room.leave');
    await press('rtl', 'session.room.leave');
    pending.resolve();
    await advance(0);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('does not turn on in the room made again a camera that failed to turn on', async () => {
    await inRoom();
    room().localParticipant.setCameraEnabled.mockRejectedValueOnce(new Error('busy'));
    await cameraOn();
    await lose();
    await advance(2_000);
    expect(rooms).toHaveLength(2);
    expect(room().localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });

  it('keeps wanting a camera that failed to turn off', async () => {
    await inRoom();
    await cameraOn();
    room().localParticipant.setCameraEnabled.mockRejectedValueOnce(new Error('busy'));
    await press('rtl', 'session.room.cameraOff');
    await advance(0);
    await lose();
    await advance(2_000);
    expect(rooms).toHaveLength(2);
    expect(room().localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
  });

  it('does not say connected over «جهاز آخر» when the microphone answers late', async () => {
    const microphone = deferred<undefined>();
    nextRoom((made) =>
      made.localParticipant.setMicrophoneEnabled.mockReturnValueOnce(microphone.promise),
    );
    await renderIn('rtl', ui());
    await advance(0);
    await lose(DisconnectReason.DUPLICATE_IDENTITY);
    microphone.resolve(undefined);
    await advance(0);
    expect(screen.getByText(said('rtl', 'session.room.anotherDevice.message'))).toBeTruthy();
  });

  it('does not say connected over a lost room when the microphone answers late', async () => {
    const microphone = deferred<undefined>();
    nextRoom((made) =>
      made.localParticipant.setMicrophoneEnabled.mockReturnValueOnce(microphone.promise),
    );
    await renderIn('rtl', ui());
    await advance(0);
    join().mockRejectedValue(new Error('offline'));
    await lose();
    microphone.resolve(undefined);
    await advance(0);
    expect(screen.getByText(said('rtl', 'session.room.reconnecting'))).toBeTruthy();
  });

  it('stops the audio and goes back though the disconnect and the audio both refuse', async () => {
    await inRoom();
    room().disconnect.mockRejectedValueOnce(new Error('gone'));
    stopAudio.mockImplementationOnce(() => Promise.reject(new Error('no session')));
    await press('rtl', 'session.room.leave');
    await advance(0);
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('stops the audio and goes back when the disconnect never answers, after a bounded wait', async () => {
    await inRoom();
    room().disconnect.mockReturnValueOnce(new Promise<void>(() => undefined));
    await press('rtl', 'session.room.leave');
    await advance(4_999);
    expect(mockBack).not.toHaveBeenCalled();
    await advance(1);
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('keeps the room and its audio when the camera fails on a rejoin (again)', async () => {
    await inRoom();
    await cameraOn();
    nextRoom((made) =>
      made.localParticipant.setCameraEnabled.mockRejectedValueOnce(new Error('busy')),
    );
    await lose();
    await advance(2_000);
    expect(rooms).toHaveLength(2);
    expect(room().localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(room().disconnect).not.toHaveBeenCalled();
    expect(room().listenerCount()).toBeGreaterThan(0);
    expect(screen.getByText(said('rtl', 'common.state.actionError'))).toBeTruthy();
    await advance(60_000);
    expect(join()).toHaveBeenCalledTimes(2);
  });

  it('keeps the room and its audio when the camera fails on a rejoin (takeBack)', async () => {
    await inRoom();
    await cameraOn();
    await lose(DisconnectReason.DUPLICATE_IDENTITY);
    nextRoom((made) =>
      made.localParticipant.setCameraEnabled.mockRejectedValueOnce(new Error('busy')),
    );
    await press('rtl', 'session.room.anotherDevice.action');
    await advance(0);
    expect(rooms).toHaveLength(2);
    expect(room().disconnect).not.toHaveBeenCalled();
    expect(room().listenerCount()).toBeGreaterThan(0);
    expect(screen.getByText(said('rtl', 'common.state.actionError'))).toBeTruthy();
    expect(join()).toHaveBeenCalledTimes(2);
  });

  it('releases the screen track when the share is stopped', async () => {
    await inRoom();
    await share();
    const { release } = room().localParticipant.screenTrack.mediaStreamTrack;
    await press('rtl', 'session.room.stopShare');
    await advance(0);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the screen track after the disconnect when leaving while sharing', async () => {
    await inRoom();
    await share();
    const left = room();
    const { release } = left.localParticipant.screenTrack.mediaStreamTrack;
    await press('rtl', 'session.room.leave');
    await advance(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.invocationCallOrder[0]).toBeGreaterThan(
      left.disconnect.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('releases the screen track when the room is lost while sharing', async () => {
    await inRoom();
    await share();
    const { release } = room().localParticipant.screenTrack.mediaStreamTrack;
    join().mockRejectedValue(new Error('offline'));
    await lose();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('RoomScreen: the service that keeps the room alive while sharing (the owner’s conditions of 2026-11-09)', () => {
  const inRoom = async () => {
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
  };
  const askShare = async () => {
    await press('rtl', 'session.room.shareScreen');
    await press('rtl', 'common.action.continue');
    await advance(0);
  };
  const local = () => room().localParticipant;

  it('starts while the app is visible, before Android’s prompts, with its notification’s words', async () => {
    await inRoom();
    await askShare();
    expect(startKeepAlive).toHaveBeenCalledTimes(1);
    expect(startKeepAlive).toHaveBeenCalledWith(
      said('rtl', 'session.room.screenShare.noticeTitle'),
      said('rtl', 'session.room.screenShare.noticeText'),
    );
    expect(startKeepAlive.mock.invocationCallOrder[0]).toBeLessThan(
      local().createScreenTracks.mock.invocationCallOrder[0] ?? 0,
    );
    expect(stopKeepAlive).not.toHaveBeenCalled();
  });

  it('asks Android for nothing when the service cannot start', async () => {
    await inRoom();
    startKeepAlive.mockRejectedValueOnce(new Error('refused'));
    await askShare();
    expect(local().createScreenTracks).not.toHaveBeenCalled();
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
    expect(screen.getByText(said('rtl', 'common.state.actionError'))).toBeTruthy();
  });

  it('stops when Android’s prompt is cancelled', async () => {
    await inRoom();
    local().createScreenTracks.mockRejectedValueOnce(new Error('NotAllowedError'));
    await askShare();
    expect(local().publishTrack).not.toHaveBeenCalled();
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('stops and releases the held track when the publish fails', async () => {
    await inRoom();
    local().publishTrack.mockRejectedValueOnce(new Error('negotiation'));
    await askShare();
    expect(local().screenTrack.mediaStreamTrack.release).toHaveBeenCalledTimes(1);
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('stops when the share is stopped, and not before', async () => {
    await inRoom();
    await askShare();
    await press('rtl', 'session.room.stopShare');
    await advance(0);
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('stops after the disconnect when leaving while sharing', async () => {
    await inRoom();
    await askShare();
    const left = room();
    await press('rtl', 'session.room.leave');
    await advance(0);
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
    expect(stopKeepAlive.mock.invocationCallOrder[0]).toBeGreaterThan(
      left.disconnect.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('stops when the room is lost while sharing', async () => {
    await inRoom();
    await askShare();
    join().mockRejectedValue(new Error('offline'));
    await lose();
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('stops on «جهاز آخر» while sharing', async () => {
    await inRoom();
    await askShare();
    await lose(DisconnectReason.DUPLICATE_IDENTITY);
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('stops and releases when Android ends the capture by itself', async () => {
    await inRoom();
    await askShare();
    await act(async () => {
      local().screenTrack.end();
      await Promise.resolve();
    });
    expect(local().screenTrack.mediaStreamTrack.release).toHaveBeenCalledTimes(1);
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('publishes nothing and stops when the participant left during Android’s prompt', async () => {
    await inRoom();
    const prompt = deferred<FakeScreenTrack[]>();
    const left = room();
    left.localParticipant.createScreenTracks.mockReturnValueOnce(prompt.promise);
    await askShare();
    await press('rtl', 'session.room.leave');
    await advance(0);
    prompt.resolve([left.localParticipant.screenTrack]);
    await advance(0);
    expect(left.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(left.localParticipant.screenTrack.mediaStreamTrack.release).toHaveBeenCalledTimes(1);
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });

  const NOTIFICATIONS = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  const askedNotifications = () => request.mock.calls.filter(([asked]) => asked === NOTIFICATIONS);

  it('asks for notifications after «متابعة» and before the service', async () => {
    await inRoom();
    await press('rtl', 'session.room.shareScreen');
    expect(askedNotifications()).toHaveLength(0);
    await press('rtl', 'common.action.continue');
    await advance(0);
    expect(askedNotifications()).toHaveLength(1);
    const asked = request.mock.calls.findIndex(([each]) => each === NOTIFICATIONS);
    expect(request.mock.invocationCallOrder[asked]).toBeLessThan(
      startKeepAlive.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('asks for notifications once however many shares follow', async () => {
    await inRoom();
    await askShare();
    await press('rtl', 'session.room.stopShare');
    await advance(0);
    await askShare();
    expect(askedNotifications()).toHaveLength(1);
    expect(startKeepAlive).toHaveBeenCalledTimes(2);
  });

  it('shares all the same when notifications are refused', async () => {
    await inRoom();
    request.mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    await askShare();
    expect(startKeepAlive).toHaveBeenCalledTimes(1);
    expect(local().publishTrack).toHaveBeenCalledTimes(1);
  });

  it('shares all the same when asking for notifications fails', async () => {
    await inRoom();
    request.mockRejectedValue(new Error('no activity'));
    await askShare();
    expect(startKeepAlive).toHaveBeenCalledTimes(1);
    expect(local().publishTrack).toHaveBeenCalledTimes(1);
  });

  it('opens no Android prompt and stops the service when the participant left while it started', async () => {
    await inRoom();
    const starting = deferred<void>();
    startKeepAlive.mockReturnValueOnce(starting.promise);
    const left = room();
    await askShare();
    await press('rtl', 'session.room.leave');
    await advance(0);
    const before = stopKeepAlive.mock.calls.length;
    starting.resolve();
    await advance(0);
    expect(left.localParticipant.createScreenTracks).not.toHaveBeenCalled();
    expect(stopKeepAlive.mock.calls.length).toBe(before + 1);
  });

  it('opens no Android prompt and stops the service when the room was lost while it started', async () => {
    await inRoom();
    const starting = deferred<void>();
    startKeepAlive.mockReturnValueOnce(starting.promise);
    const lost = room();
    join().mockRejectedValue(new Error('offline'));
    await askShare();
    await lose();
    const before = stopKeepAlive.mock.calls.length;
    starting.resolve();
    await advance(0);
    expect(lost.localParticipant.createScreenTracks).not.toHaveBeenCalled();
    expect(stopKeepAlive.mock.calls.length).toBe(before + 1);
  });

  it('does not start the service for a camera or a plain room', async () => {
    await inRoom();
    await press('rtl', 'session.room.cameraOn');
    await advance(0);
    await press('rtl', 'session.room.leave');
    await advance(0);
    expect(startKeepAlive).not.toHaveBeenCalled();
    expect(stopKeepAlive).not.toHaveBeenCalled();
  });
});

describe('RoomScreen: a share while one starts, and a stop that fails (PR #130’s review, round 1, the notes under T019)', () => {
  const inRoom = async () => {
    await renderIn('rtl', ui());
    await screen.findByText(said('rtl', 'session.room.waitingFor', { name: 'يوسف أحمد' }));
  };
  const askShare = async () => {
    await press('rtl', 'session.room.shareScreen');
    await press('rtl', 'common.action.continue');
    await advance(0);
  };
  const local = () => room().localParticipant;
  const shareButton = () =>
    screen.getByRole('button', { name: said('rtl', 'session.room.shareScreen') });
  const warning = () => screen.queryByText(said('rtl', 'session.room.screenShare.warning'));

  it('offers no second share while the first starts: one capture, one service, released on leaving', async () => {
    await inRoom();
    const publishing = deferred<object>();
    local().publishTrack.mockReturnValueOnce(publishing.promise);
    await askShare();
    expect(shareButton().props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(shareButton());
    expect(warning()).toBeNull();
    expect(local().createScreenTracks).toHaveBeenCalledTimes(1);
    expect(startKeepAlive).toHaveBeenCalledTimes(1);
    const { release } = local().screenTrack.mediaStreamTrack;
    await press('rtl', 'session.room.leave');
    await advance(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('starts one share when «متابعة» is pressed twice', async () => {
    await inRoom();
    local().publishTrack.mockReturnValueOnce(deferred<object>().promise);
    await press('rtl', 'session.room.shareScreen');
    const proceed = screen.getByRole('button', { name: said('rtl', 'common.action.continue') });
    // Both presses before the screen draws again: the dialog is still there for the second.
    await act(async () => {
      await Promise.all([fireEvent.press(proceed), fireEvent.press(proceed)]);
    });
    await advance(0);
    expect(local().createScreenTracks).toHaveBeenCalledTimes(1);
    expect(startKeepAlive).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'Android’s prompt is cancelled',
      () => local().createScreenTracks.mockRejectedValueOnce(new Error('NotAllowedError')),
    ],
    [
      'the service fails to start',
      () => startKeepAlive.mockRejectedValueOnce(new Error('refused')),
    ],
  ])('offers the share again once %s', async (_case, fail) => {
    await inRoom();
    fail();
    await askShare();
    expect(shareButton().props.accessibilityState?.disabled).toBe(false);
    await askShare();
    expect(local().publishTrack).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: said('rtl', 'session.room.stopShare') }),
    ).toBeTruthy();
  });

  it('releases the track once and stops the service when leaving while the share starts', async () => {
    await inRoom();
    const publishing = deferred<object>();
    local().publishTrack.mockReturnValueOnce(publishing.promise);
    const left = room();
    await askShare();
    await press('rtl', 'session.room.leave');
    await advance(0);
    publishing.resolve({});
    await advance(0);
    expect(left.localParticipant.screenTrack.mediaStreamTrack.release).toHaveBeenCalledTimes(1);
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('releases the capture and stops the service when the SDK refuses the stop', async () => {
    await inRoom();
    await askShare();
    local().setScreenShareEnabled.mockRejectedValueOnce(new Error('negotiation'));
    await press('rtl', 'session.room.stopShare');
    await advance(0);
    expect(local().screenTrack.mediaStreamTrack.release).toHaveBeenCalledTimes(1);
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('releases the capture and stops the service 5 s after a stop that never answers', async () => {
    await inRoom();
    await askShare();
    local().setScreenShareEnabled.mockReturnValueOnce(new Promise<undefined>(() => undefined));
    await press('rtl', 'session.room.stopShare');
    await advance(4_999);
    expect(local().screenTrack.mediaStreamTrack.release).not.toHaveBeenCalled();
    expect(stopKeepAlive).not.toHaveBeenCalled();
    await advance(1);
    expect(local().screenTrack.mediaStreamTrack.release).toHaveBeenCalledTimes(1);
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });
});
