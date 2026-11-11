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
// `DUPLICATE_IDENTITY` (the same account joined from another device; the owner's decision of
// 2026-11-08, the note under T019) makes no automatic try, or the two devices would push each other
// out until the end: the screen says so and offers the room back until the scheduled end (FR-435),
// each press one `sessions.join` and no backoff after it.
// Leaving (or the screen going away) clears the timer, drops every listener, disconnects, then stops
// the audio session; a step that refuses or never answers does not keep the participant in the room
// (the device check of 2026-11-09). The screen's track is held before it is published and released
// when its share ends, however it ends: stopping it alone leaves the capture and its foreground
// service running. The share runs under `lib/room-keep-alive.ts`, started while the app is visible,
// before Android's prompts, and stopped with the share. One share starts at a time, stopping it is
// bounded as leaving is (PR #130's review, round 1), and none starts while one stops (round 2).
// Nothing here outlives the screen.
//
// B40a, T019's follow-up (b): a first join refused `JOIN_NOT_OPEN` (the phone's clock ahead of the
// server's) says when joining opens and asks `sessions.join` again on the same schedule as a lost
// room (`rejoin.ts`, no new constant), until it joins, a final refusal, or the scheduled end
// (`sessions.get`'s `endsAt`, which the screen hands in); a try with no answer is tried again.
// T065: a first join that failed keeps its error, so the screen can say `RATE_LIMITED`'s time.
import type { SessionsJoinOutput } from '@ijazah/contracts';
import { secondsUntil } from '@ijazah/time/calendar';
import type { TrackReference } from '@livekit/react-native';
import {
  DisconnectReason,
  type Participant,
  Room,
  RoomEvent,
  Track,
  TrackEvent,
} from 'livekit-client';

import { errorCodeOf, errorDetailsOf } from '../../../lib/client';
import { startAudio, stopAudio } from '../../../lib/livekit';
import { startRoomKeepAlive, stopRoomKeepAlive } from '../../../lib/room-keep-alive';
import { askAccess, askNotifications } from './permissions';
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
  /** The same account joined from another device: no automatic try; the room can be taken back. */
  | { readonly kind: 'anotherDevice' }
  /** The first join had no answer; the participant may try again. `error`: what refused it (T065). */
  | { readonly kind: 'failed'; readonly error?: unknown }
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
  /** A share is starting: no second one is offered. */
  readonly startingShare: boolean;
  /** A share is stopping: no new one is offered until the stop has settled. */
  readonly stoppingShare: boolean;
}

const MS_PER_SECOND = 1_000;
/** How long leaving waits for each of its steps: the SDK's disconnect was seen never to answer. */
const LEAVE_WAIT_MS = 5_000;

/** react-native-webrtc's track: `release()` alone disposes the capture and ends its service. */
interface NativeTrack {
  release(): void;
}

/** The words of the notification that stays for the whole share. */
export interface ShareNotice {
  readonly title: string;
  readonly text: string;
}

/** Resolves when `work` settles, either way, or after `LEAVE_WAIT_MS`. */
function settled(work: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, LEAVE_WAIT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    work.then(done, done);
  });
}

/**
 * Who asked for a join: the screen opening, the schedule after a loss, the participant's press, or
 * the schedule after `JOIN_NOT_OPEN` (follow-up (b)).
 */
type AttemptMode = 'first' | 'again' | 'takeBack' | 'notOpen';

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
  /** From «متابعة» until the share is published or given up. */
  private startingShare = false;
  /** From «إيقاف» until the stop has settled or its wait ran out. */
  private stoppingShare = false;
  private closing: Promise<void> | undefined;
  private shareTrack: NativeTrack | undefined;
  private keepingAlive = false;
  private askedNotifications = false;

  constructor(
    private readonly join: () => Promise<SessionsJoinOutput>,
    private readonly changed: () => void,
    /** The session's scheduled end (`sessions.get`'s `endsAt`), when the screen has read it. */
    private readonly scheduledEnd: () => string | undefined = () => undefined,
  ) {}

  /** Starts the audio session, then the first join. */
  async start(): Promise<void> {
    try {
      await startAudio();
    } catch {
      this.set({ kind: 'failed' });
      return;
    }
    if (!this.closed) await this.attempt('first');
  }

  /** «الدخول من هذا الجهاز»: one `sessions.join`, and no backoff after it. */
  takeBack(): void {
    if (this.closed || this.phase.kind !== 'anotherDevice') return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.set({ kind: 'connecting' });
    void this.attempt('takeBack');
  }

  /** The first join again, after it had no answer. */
  retry(): void {
    if (this.closed || this.phase.kind !== 'failed') return;
    this.set({ kind: 'connecting' });
    void this.attempt('first');
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
      startingShare: this.startingShare,
      stoppingShare: this.stoppingShare,
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
    if (await this.device(() => room.localParticipant.setCameraEnabled(turnOn))) {
      this.cameraWanted = turnOn;
    }
  }

  /** FR-500: the warning first, every time; none while a share is starting or stopping. */
  askToShare(): void {
    if (this.startingShare || this.stoppingShare) return;
    this.shareWarningOpen = true;
    this.changed();
  }

  /** The warning's «إلغاء»: nothing is shared and nothing is sent. */
  cancelShare(): void {
    this.shareWarningOpen = false;
    this.changed();
  }

  /**
   * The warning's «متابعة»: the share starts, Android asking its own permission. One at a time
   * (PR #130's review, round 1): a second start would overwrite the held track, which nothing could
   * then release.
   */
  async confirmShare(notice: ShareNotice): Promise<void> {
    if (this.startingShare || this.stoppingShare) return;
    this.startingShare = true;
    try {
      this.shareWarningOpen = false;
      this.changed();
      const room = this.joined ? this.room : undefined;
      if (room === undefined) return;
      if (!(await this.device(() => this.share(room, notice)))) this.endShare();
    } finally {
      this.startingShare = false;
      this.changed();
    }
  }

  /** The notification's permission, the service, then Android's prompts; the track held before it is published. */
  private async share(room: Room, notice: ShareNotice): Promise<void> {
    if (!this.askedNotifications) {
      this.askedNotifications = true;
      await askNotifications();
    }
    if (this.closed || this.room !== room) return;
    this.keepingAlive = true;
    await startRoomKeepAlive(notice.title, notice.text);
    if (this.closed || this.room !== room) {
      // Leaving or the lost room already turned `keepingAlive` off, perhaps before the task ran.
      this.keepingAlive = true;
      this.endShare();
      return;
    }
    const [track] = await room.localParticipant.createScreenTracks();
    if (track === undefined) throw new Error('Android gave no screen track.');
    const held = track.mediaStreamTrack as unknown as NativeTrack;
    this.shareTrack = held;
    track.once(TrackEvent.Ended, () => {
      if (this.shareTrack === held) this.endShare();
      this.changed();
    });
    if (this.closed || this.room !== room) {
      this.endShare();
      return;
    }
    await room.localParticipant.publishTrack(track);
  }

  /**
   * The capture released and the service stopped whichever way the SDK answers, and after
   * `LEAVE_WAIT_MS` when it does not (PR #130's review, round 1, Minor 2). One at a time, and no
   * share starts meanwhile (round 2): the SDK unpublishes, and says so, before it negotiates, and
   * this late `endShare()` would end a share started in between.
   */
  async stopShare(): Promise<void> {
    if (this.stoppingShare) return;
    this.stoppingShare = true;
    try {
      const room = this.joined ? this.room : undefined;
      if (room === undefined) return;
      await settled(room.localParticipant.setScreenShareEnabled(false));
      this.endShare();
    } finally {
      this.stoppingShare = false;
      this.changed();
    }
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
      await settled(room.disconnect());
    }
    this.endShare();
    await settled(stopAudio());
  }

  /** However the share ended: the capture released and the service stopped, once. */
  private endShare(): void {
    this.shareTrack?.release();
    this.shareTrack = undefined;
    if (this.keepingAlive) {
      this.keepingAlive = false;
      stopRoomKeepAlive();
    }
  }

  private async attempt(mode: AttemptMode): Promise<void> {
    let grant: SessionsJoinOutput;
    try {
      grant = await this.join();
    } catch (error) {
      if (!this.closed) this.refused(error, mode);
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
      // A camera that fails is a device failure: the room and its audio stay (FR-433).
      if (this.cameraWanted) await this.device(() => room.localParticipant.setCameraEnabled(true));
      if (this.closed || this.room !== room) return;
      this.set({ kind: 'connected' });
    } catch {
      if (this.closed || this.room !== room) return;
      this.drop(room);
      // A room that connected before the microphone failed is left too; its listeners are gone, so
      // this disconnect is not read as a lost room, and a failure of it changes nothing here.
      room.disconnect().catch(() => undefined);
      this.notJoined(mode);
    }
  }

  private refused(error: unknown, mode: AttemptMode): void {
    const code = errorCodeOf(error);
    if (isFinalRefusal(code)) {
      this.set({ kind: 'refused' });
    } else if ((mode === 'first' || mode === 'notOpen') && code === 'JOIN_NOT_OPEN') {
      const opensAt = errorDetailsOf(error).find((detail) => detail.path === 'opensAt')?.code;
      this.set({ kind: 'notOpen', opensAt });
      this.notOpenAgain();
    } else if (mode === 'notOpen') {
      this.notOpenAgain();
    } else {
      this.notJoined(mode, error);
    }
  }

  /** A try that did not reach the room: what follows depends on who asked for it. */
  private notJoined(mode: AttemptMode, error?: unknown): void {
    if (mode === 'first' || mode === 'notOpen') this.set({ kind: 'failed', error });
    else if (mode === 'takeBack') this.offerTakeBack();
    else this.again();
  }

  /**
   * Follow-up (b): the next try after `JOIN_NOT_OPEN` on `rejoin.ts`' schedule, or none once the
   * scheduled end comes first, when the session is shown ended.
   */
  private notOpenAgain(): void {
    const delay = rejoinDelayMs(this.failures);
    this.failures += 1;
    const end = this.endsAt ?? this.scheduledEnd();
    const left = end === undefined ? undefined : secondsUntil(end, new Date()) * MS_PER_SECOND;
    if (left !== undefined && left <= delay) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.set({ kind: 'ended' });
      }, left);
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.attempt('notOpen');
    }, delay);
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
    if (reason === DisconnectReason.DUPLICATE_IDENTITY) this.offerTakeBack();
    else this.again();
  }

  /** The other device holds the room: no automatic try, the press offered until the scheduled end. */
  private offerTakeBack(): void {
    const left = this.millisecondsLeft();
    if (left <= 0) {
      this.set({ kind: 'ended' });
      return;
    }
    this.set({ kind: 'anotherDevice' });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.set({ kind: 'ended' });
    }, left);
  }

  private millisecondsLeft(): number {
    return this.endsAt === undefined ? 0 : secondsUntil(this.endsAt, new Date()) * MS_PER_SECOND;
  }

  private drop(room: Room): void {
    room.removeAllListeners();
    if (this.room === room) this.room = undefined;
    this.joined = false;
    this.shareWarningOpen = false;
    this.endShare();
  }

  /** The next try on the schedule, or none once the scheduled end comes first. */
  private again(): void {
    const delay = rejoinDelayMs(this.failures);
    this.failures += 1;
    const left = this.millisecondsLeft();
    if (left <= delay) {
      this.set({ kind: 'reconnecting' });
      this.timer = setTimeout(() => this.set({ kind: 'ended' }), left);
      return;
    }
    this.set({ kind: 'reconnecting' });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.attempt('again');
    }, delay);
  }

  /** Whether the change went through. */
  private async device(change: () => Promise<unknown>): Promise<boolean> {
    try {
      await change();
      this.deviceFailed = false;
    } catch {
      this.deviceFailed = true;
    }
    this.changed();
    return !this.deviceFailed;
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
