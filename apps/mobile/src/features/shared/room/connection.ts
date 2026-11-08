// T019 of specs/004-sessions (FR-433, FR-435, FR-436, FR-500; research R-316; the notes under T019):
// one participant's connection to the session's room, through LiveKit's client SDK, for as long as
// the room screen is open. It starts the audio session, asks `sessions.join` for the provider's
// address and a token bound to this session and this participant, connects with them and turns the
// microphone on: audio in every session (FR-433). The camera and the screen share are the
// participant's own choice, off until turned on, and nothing about them goes to the API: they are
// published to the room alone. Before the whole screen is shared, FR-500's warning is shown every
// time, and only its «متابعة» starts the share (Android's own prompt comes after).
//
// A dropped connection is the SDK's to rejoin (`Reconnecting` → `Reconnected`). A room the SDK gave
// up on (`Disconnected`, not by the participant) is asked of `sessions.join` again on `rejoin.ts`'
// schedule, in a room made again, the camera turned back on when it was on; a final refusal ends
// the tries, and so does the scheduled end (the join's `validUntil`): no try is made after it.
// Leaving (or the screen going away) clears the timer, drops every listener, disconnects, then stops
// the audio session. Nothing here outlives the screen.
import type { SessionsJoinOutput } from '@ijazah/contracts';
import { secondsUntil } from '@ijazah/time/calendar';
import type { TrackReference } from '@livekit/react-native';
import { DisconnectReason, type Participant, Room, RoomEvent, Track } from 'livekit-client';

import { errorCodeOf, errorDetailsOf } from '../../../lib/client';
import { startAudio, stopAudio } from '../../../lib/livekit';
import { askAccess } from './permissions';
import { isFinalRefusal, rejoinDelayMs } from './rejoin';

export type RoomPhase =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected' }
  /** The SDK rejoins a dropped connection, or the room is asked of `sessions.join` again. */
  | { readonly kind: 'reconnecting' }
  /** `JOIN_NOT_OPEN` on the first join: the phone's clock ran ahead of the server's. */
  | { readonly kind: 'notOpen'; readonly opensAt: string | undefined }
  /** A final refusal: the session cannot be joined. */
  | { readonly kind: 'refused' }
  /** The first join had no answer; the participant may try again. */
  | { readonly kind: 'failed' }
  /** The room was lost and the scheduled end came before it could be joined again. */
  | { readonly kind: 'ended' };

export interface RoomView {
  readonly counterpartyPresent: boolean;
  readonly counterpartyCamera: TrackReference | undefined;
  readonly counterpartyScreen: TrackReference | undefined;
  readonly ownCamera: TrackReference | undefined;
  readonly cameraOn: boolean;
  readonly sharing: boolean;
  /** Android refused the camera. */
  readonly cameraRefused: boolean;
  /** Turning the camera or the share on or off failed. */
  readonly deviceFailed: boolean;
  /** FR-500's warning is open. */
  readonly shareWarningOpen: boolean;
}

const MS_PER_SECOND = 1_000;

export class RoomConnection {
  phase: RoomPhase = { kind: 'connecting' };
  private room: Room | undefined;
  /** The room's connection succeeded and it has not been dropped since. */
  private joined = false;
  private closed = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private endsAt: string | undefined;
  private cameraWanted = false;
  private cameraRefused = false;
  private deviceFailed = false;
  private shareWarningOpen = false;
  private closing: Promise<void> | undefined;

  constructor(
    private readonly join: () => Promise<SessionsJoinOutput>,
    private readonly changed: () => void,
  ) {}

  /** Starts the audio session, then the first join. */
  async start(): Promise<void> {
    try {
      await startAudio();
    } catch {
      this.set({ kind: 'failed' });
      return;
    }
    if (!this.closed) await this.attempt(true);
  }

  /** The first join again, after it had no answer. */
  retry(): void {
    if (this.closed || this.phase.kind !== 'failed') return;
    this.set({ kind: 'connecting' });
    void this.attempt(true);
  }

  view(): RoomView {
    const room = this.joined ? this.room : undefined;
    const remote = room?.remoteParticipants.values().next().value;
    const local = room?.localParticipant;
    return {
      counterpartyPresent: remote !== undefined,
      counterpartyCamera: trackOf(remote, Track.Source.Camera),
      counterpartyScreen: trackOf(remote, Track.Source.ScreenShare),
      ownCamera: trackOf(local, Track.Source.Camera),
      cameraOn: local?.isCameraEnabled ?? false,
      sharing: local?.isScreenShareEnabled ?? false,
      cameraRefused: this.cameraRefused,
      deviceFailed: this.deviceFailed,
      shareWarningOpen: this.shareWarningOpen,
    };
  }

  /** Turns the camera on (asking Android for it) or off; the API hears nothing of it. */
  async toggleCamera(): Promise<void> {
    const room = this.joined ? this.room : undefined;
    if (room === undefined) return;
    const turnOn = !room.localParticipant.isCameraEnabled;
    if (turnOn && (await askAccess('camera')) !== 'granted') {
      this.cameraRefused = true;
      this.changed();
      return;
    }
    this.cameraRefused = false;
    this.cameraWanted = turnOn;
    await this.device(() => room.localParticipant.setCameraEnabled(turnOn));
  }

  /** FR-500: the warning first, every time. */
  askToShare(): void {
    this.shareWarningOpen = true;
    this.changed();
  }

  /** The warning's «إلغاء»: nothing is shared and nothing is sent. */
  cancelShare(): void {
    this.shareWarningOpen = false;
    this.changed();
  }

  /** The warning's «متابعة»: the share starts, Android asking its own permission. */
  async confirmShare(): Promise<void> {
    this.shareWarningOpen = false;
    this.changed();
    const room = this.joined ? this.room : undefined;
    if (room !== undefined)
      await this.device(() => room.localParticipant.setScreenShareEnabled(true));
  }

  async stopShare(): Promise<void> {
    const room = this.joined ? this.room : undefined;
    if (room !== undefined)
      await this.device(() => room.localParticipant.setScreenShareEnabled(false));
  }

  /** Leaves the room: no timer, no listener, the connection closed, then the audio session stopped. */
  close(): Promise<void> {
    this.closing ??= this.shut();
    return this.closing;
  }

  private async shut(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    const room = this.room;
    this.room = undefined;
    this.joined = false;
    if (room !== undefined) {
      room.removeAllListeners();
      await room.disconnect();
    }
    await stopAudio();
  }

  private async attempt(first: boolean): Promise<void> {
    let grant: SessionsJoinOutput;
    try {
      grant = await this.join();
    } catch (error) {
      if (!this.closed) this.refused(error, first);
      return;
    }
    if (this.closed) return;
    this.endsAt = grant.validUntil;
    const room = new Room();
    this.room = room;
    this.listen(room);
    try {
      await room.connect(grant.serverUrl, grant.token);
      if (this.closed || this.room !== room) return;
      this.joined = true;
      this.failures = 0;
      await room.localParticipant.setMicrophoneEnabled(true);
      if (this.cameraWanted) await room.localParticipant.setCameraEnabled(true);
      this.set({ kind: 'connected' });
    } catch {
      if (this.closed || this.room !== room) return;
      this.drop(room);
      // A room that connected before the microphone failed is left too; its listeners are gone, so
      // this disconnect is not read as a lost room, and a failure of it changes nothing here.
      room.disconnect().catch(() => undefined);
      if (first) this.set({ kind: 'failed' });
      else this.again();
    }
  }

  private refused(error: unknown, first: boolean): void {
    const code = errorCodeOf(error);
    if (isFinalRefusal(code)) {
      this.set({ kind: 'refused' });
    } else if (first && code === 'JOIN_NOT_OPEN') {
      const opensAt = errorDetailsOf(error).find((detail) => detail.path === 'opensAt')?.code;
      this.set({ kind: 'notOpen', opensAt });
    } else if (first) {
      this.set({ kind: 'failed' });
    } else {
      this.again();
    }
  }

  private listen(room: Room): void {
    const changed = () => this.changed();
    room
      .on(RoomEvent.Reconnecting, () => this.whileJoined(room, { kind: 'reconnecting' }))
      .on(RoomEvent.SignalReconnecting, () => this.whileJoined(room, { kind: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => this.whileJoined(room, { kind: 'connected' }))
      .on(RoomEvent.Disconnected, (reason) => this.lost(room, reason))
      .on(RoomEvent.ParticipantConnected, changed)
      .on(RoomEvent.ParticipantDisconnected, changed)
      .on(RoomEvent.TrackSubscribed, changed)
      .on(RoomEvent.TrackUnsubscribed, changed)
      .on(RoomEvent.TrackMuted, changed)
      .on(RoomEvent.TrackUnmuted, changed)
      .on(RoomEvent.LocalTrackPublished, changed)
      .on(RoomEvent.LocalTrackUnpublished, changed);
  }

  private whileJoined(room: Room, phase: RoomPhase): void {
    if (this.joined && this.room === room) this.set(phase);
  }

  /** The SDK gave up on the room: the participant did not leave it. */
  private lost(room: Room, reason: DisconnectReason | undefined): void {
    if (this.closed || this.room !== room || !this.joined) return;
    if (reason === DisconnectReason.CLIENT_INITIATED) return;
    this.drop(room);
    this.failures = 0;
    this.again();
  }

  private drop(room: Room): void {
    room.removeAllListeners();
    if (this.room === room) this.room = undefined;
    this.joined = false;
    this.shareWarningOpen = false;
  }

  /** The next try on the schedule, or none once the scheduled end comes first. */
  private again(): void {
    const delay = rejoinDelayMs(this.failures);
    this.failures += 1;
    const left =
      this.endsAt === undefined ? 0 : secondsUntil(this.endsAt, new Date()) * MS_PER_SECOND;
    if (left <= delay) {
      this.set({ kind: 'reconnecting' });
      this.timer = setTimeout(() => this.set({ kind: 'ended' }), left);
      return;
    }
    this.set({ kind: 'reconnecting' });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.attempt(false);
    }, delay);
  }

  private async device(change: () => Promise<unknown>): Promise<void> {
    try {
      await change();
      this.deviceFailed = false;
    } catch {
      this.deviceFailed = true;
    }
    this.changed();
  }

  private set(phase: RoomPhase): void {
    if (this.closed) return;
    this.phase = phase;
    this.changed();
  }
}

/** A participant's track of `source`, as `VideoTrack` draws it, while it is published and on. */
function trackOf(
  participant: Participant | undefined,
  source: Track.Source,
): TrackReference | undefined {
  const publication = participant?.getTrackPublication(source);
  if (participant === undefined || publication === undefined) return undefined;
  if (!publication.isSubscribed || publication.isMuted) return undefined;
  return { participant, publication, source };
}
