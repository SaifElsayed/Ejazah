// T018 of specs/004-sessions (FR-434, FR-433): the microphone's permission, granted on the
// pre-session screen, and the camera's, asked only when the person turns the camera on in the room
// (T019). On Android the app asks itself through React Native's `PermissionsAndroid` (no new
// package): granted, undecided, refused once (it may ask again), or refused for good, when only
// the system settings can grant it; the microphone is read again whenever the app comes back to
// the foreground, so a grant made in the settings shows at once. Elsewhere the system asks on the
// first use (iOS is Phase 6's).
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, type Permission, PermissionsAndroid, Platform } from 'react-native';

export type Access = 'granted' | 'undecided' | 'denied' | 'blocked';
export type Device = 'microphone' | 'camera';

const PERMISSION: Readonly<Record<Device, Permission>> = {
  microphone: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  camera: PermissionsAndroid.PERMISSIONS.CAMERA,
};

const asksItself = () => Platform.OS === 'android';

/** Whether `device` is granted, asking nothing. */
export async function readAccess(device: Device): Promise<'granted' | 'undecided'> {
  if (!asksItself()) return 'granted';
  return (await PermissionsAndroid.check(PERMISSION[device])) ? 'granted' : 'undecided';
}

/** Asks for `device`: the system's own prompt, unless it was refused for good. */
export async function askAccess(device: Device): Promise<Access> {
  if (!asksItself()) return 'granted';
  const answer = await PermissionsAndroid.request(PERMISSION[device]);
  if (answer === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  return answer === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
}

export interface Microphone {
  /** Undefined while the first read is on its way. */
  readonly access: Access | undefined;
  readonly ask: () => Promise<void>;
  readonly openSettings: () => void;
}

/** The microphone's permission, read on opening and on every return to the foreground. */
export function useMicrophone(): Microphone {
  const [access, setAccess] = useState<Access | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const read = () => {
      void readAccess('microphone').then((now) => {
        // A refusal stays what it was until the settings grant it.
        if (live) setAccess((was) => (now === 'granted' || was === undefined ? now : was));
      });
    };
    read();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  const ask = useCallback(async () => {
    setAccess(await askAccess('microphone'));
  }, []);
  const openSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);
  return { access, ask, openSettings };
}
