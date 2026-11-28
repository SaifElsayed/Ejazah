// T019 of specs/004-sessions (the owner's conditions of 2026-11-09, the notes under T019): the
// service that keeps the room alive while the screen is shared. Android's share prompts and the
// shared app cover this app, and React Native pauses its JS timers there, so the video SDK's ping
// and negotiation stop and the room is lost. The module (`modules/room-keep-alive`) is a foreground
// service of type microphone running a headless task: while a headless task is active the timers
// run. Starting waits until the task runs; a build without the module does nothing.
// T068 (the note under it; R3's Q-7 (a)): the microphone permission is read before the start, and
// a start the module refuses (the app behind) rejects as well; either way the room gives the share
// up as a failed start (`features/shared/room/connection.ts`, `confirmShare`).
import { requireOptionalNativeModule } from 'expo';
import { AppRegistry, PermissionsAndroid, Platform } from 'react-native';

interface NativeKeepAlive {
  start(title: string, text: string): void;
  stop(): void;
}

/** The service's task; the name is `RoomKeepAliveService`'s. */
const TASK = 'RoomKeepAlive';
/** How long the service has to reach its task before the share is given up. */
const START_WAIT_MS = 3_000;

/** The start refused before the service: the microphone permission is not granted (T068). */
export class MicrophoneNotGrantedError extends Error {}

const native = requireOptionalNativeModule<NativeKeepAlive>('RoomKeepAlive');
let started: (() => void) | undefined;
let finish: (() => void) | undefined;

/** Once per process, from the root layout. The task lasts until `stopRoomKeepAlive`. */
export function registerRoomKeepAlive(): void {
  AppRegistry.registerHeadlessTask(
    TASK,
    () => () =>
      new Promise<void>((resolve) => {
        // Nobody is waiting (the wait ran out, or the share was stopped): the timers must not stay on.
        if (started === undefined) {
          resolve();
          return;
        }
        finish = resolve;
        started();
      }),
  );
}

/**
 * While the app is still visible: Android refuses this service from the background. On Android the
 * microphone permission is read first (T068): a service of type microphone is refused without it,
 * so with it refused no service is asked for and the start rejects.
 */
export async function startRoomKeepAlive(title: string, text: string): Promise<void> {
  if (native === null) return;
  if (
    Platform.OS === 'android' &&
    !(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO))
  ) {
    throw new MicrophoneNotGrantedError('The microphone is not granted: no keep-alive started.');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      started = undefined;
      reject(new Error('The room keep-alive did not start in time.'));
    }, START_WAIT_MS);
    started = () => {
      clearTimeout(timer);
      started = undefined;
      resolve();
    };
    try {
      native.start(title, text);
    } catch (error: unknown) {
      clearTimeout(timer);
      started = undefined;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function stopRoomKeepAlive(): void {
  started?.();
  finish?.();
  finish = undefined;
  native?.stop();
}
