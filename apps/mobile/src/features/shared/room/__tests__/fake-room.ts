// T019 of specs/004-sessions: livekit-client as the room's specs see it. Every `new Room()` is a
// fake that records what the room asked of it, with the events a spec emits; the native half of
// the SDK exists only in the development build (research R-316).
import { jest } from '@jest/globals';

export const RoomEvent = {
  Disconnected: 'disconnected',
  Reconnecting: 'reconnecting',
  SignalReconnecting: 'signalReconnecting',
  Reconnected: 'reconnected',
  ConnectionStateChanged: 'connectionStateChanged',
  ParticipantConnected: 'participantConnected',
  ParticipantDisconnected: 'participantDisconnected',
  TrackSubscribed: 'trackSubscribed',
  TrackUnsubscribed: 'trackUnsubscribed',
  TrackMuted: 'trackMuted',
  TrackUnmuted: 'trackUnmuted',
  LocalTrackPublished: 'localTrackPublished',
  LocalTrackUnpublished: 'localTrackUnpublished',
} as const;

export const DisconnectReason = {
  CLIENT_INITIATED: 1,
  DUPLICATE_IDENTITY: 2,
  SIGNAL_CLOSE: 9,
  ROOM_DELETED: 5,
} as const;

export const TrackEvent = { Ended: 'ended' } as const;

export const Track = {
  Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' },
} as const;

type Listener = (...args: unknown[]) => void;

export interface FakePublication {
  readonly isSubscribed: boolean;
  readonly isMuted: boolean;
  readonly track: object | undefined;
}

/** The screen's track as `createScreenTracks` hands it: Android may end the capture by itself. */
export class FakeScreenTrack {
  readonly mediaStreamTrack: { readonly release: jest.Mock<() => void> } = {
    release: jest.fn(),
  };
  private ended: (() => void) | undefined;
  once(_event: string, listener: () => void): this {
    this.ended = listener;
    return this;
  }
  /** Android ended the capture. */
  end(): void {
    this.ended?.();
  }
}

export class FakeLocalParticipant {
  /** Every capture `createScreenTracks` made, in order: a new track each time, as Android's are. */
  readonly screenTracks: FakeScreenTrack[] = [];
  readonly createScreenTracks: jest.Mock<() => Promise<FakeScreenTrack[]>> = jest.fn(async () => {
    const track = new FakeScreenTrack();
    this.screenTracks.push(track);
    return [track];
  });
  /**
   * The last capture made, or one made now for a spec that hands it back itself: react-native-webrtc's
   * `release()` is what ends the capture's service.
   */
  get screenTrack(): FakeScreenTrack {
    const last = this.screenTracks.at(-1);
    if (last !== undefined) return last;
    const track = new FakeScreenTrack();
    this.screenTracks.push(track);
    return track;
  }
  readonly publishTrack: jest.Mock<(track: FakeScreenTrack) => Promise<object>> = jest.fn(
    async (_track: FakeScreenTrack) => {
      this.isScreenShareEnabled = true;
      return {};
    },
  );
  isCameraEnabled = false;
  isScreenShareEnabled = false;
  isMicrophoneEnabled = false;
  readonly setMicrophoneEnabled: jest.Mock<(on: boolean) => Promise<undefined>> = jest.fn(
    async (on: boolean) => {
      this.isMicrophoneEnabled = on;
      return undefined;
    },
  );
  readonly setCameraEnabled: jest.Mock<(on: boolean) => Promise<undefined>> = jest.fn(
    async (on: boolean) => {
      this.isCameraEnabled = on;
      return undefined;
    },
  );
  readonly setScreenShareEnabled: jest.Mock<(on: boolean) => Promise<undefined>> = jest.fn(
    async (on: boolean) => {
      this.isScreenShareEnabled = on;
      return undefined;
    },
  );
  getTrackPublication(source: string): FakePublication | undefined {
    if (source === Track.Source.ScreenShare && this.isScreenShareEnabled) {
      return { isSubscribed: true, isMuted: false, track: this.screenTrack };
    }
    return source === Track.Source.Camera && this.isCameraEnabled
      ? { isSubscribed: true, isMuted: false, track: {} }
      : undefined;
  }
}

export class FakeRemoteParticipant {
  readonly publications = new Map<string, FakePublication>();
  constructor(readonly identity: string) {}
  getTrackPublication(source: string): FakePublication | undefined {
    return this.publications.get(source);
  }
}

export class FakeRoom {
  readonly localParticipant = new FakeLocalParticipant();
  readonly remoteParticipants = new Map<string, FakeRemoteParticipant>();
  private readonly listeners = new Map<string, Set<Listener>>();
  /** Resolves unless a spec makes it fail. */
  readonly connect: jest.Mock<(url: string, token: string) => Promise<undefined>> = jest.fn(
    async (_url: string, _token: string) => undefined,
  );
  readonly disconnect: jest.Mock<() => Promise<void>> = jest.fn(async () => {
    this.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
  });

  on(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(listener);
    return this;
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }

  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }

  /** The counterparty joins, with what they publish. */
  join(identity: string, publications: Record<string, FakePublication> = {}): void {
    const remote = new FakeRemoteParticipant(identity);
    for (const [source, publication] of Object.entries(publications)) {
      remote.publications.set(source, publication);
    }
    this.remoteParticipants.set(identity, remote);
    this.emit(RoomEvent.ParticipantConnected, remote);
  }
}

/** Every room the code under test made, in order. */
export const rooms: FakeRoom[] = [];

export const Room: jest.Mock<() => FakeRoom> = jest.fn(() => {
  const room = new FakeRoom();
  rooms.push(room);
  return room;
});

export function resetRooms(): void {
  rooms.length = 0;
  Room.mockClear();
}
