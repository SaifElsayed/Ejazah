// T017 of specs/004-sessions (research R-316; FR-430, FR-433; ADR 0003, Consequences): the phone's
// video SDK set up once. `registerGlobals()` installs the WebRTC globals livekit-client needs; it runs
// once per process, from the root layout (`app/_layout.tsx`). The audio session is started before a
// room is connected and stopped after it is left (T019's room calls both), as the SDK's guide asks.
import { AudioSession, registerGlobals } from '@livekit/react-native';

import { registerRoomKeepAlive } from './room-keep-alive';

let registered = false;

/** Installs the WebRTC globals once; later calls do nothing. */
export function registerVideoGlobals(): void {
  if (registered) return;
  registerGlobals();
  registerRoomKeepAlive();
  registered = true;
}

/** Before a room is connected. */
export function startAudio(): Promise<void> {
  return AudioSession.startAudioSession();
}

/** After the room is left. */
export function stopAudio(): Promise<void> {
  return AudioSession.stopAudioSession();
}

/** Specs only: forgets the registration, so each spec starts from a fresh process's state. */
export function resetVideoGlobalsForTests(): void {
  registered = false;
}
