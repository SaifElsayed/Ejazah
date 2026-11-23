// 004:T084 (R1b; SRS DEC-102, NFR-SEC-13; ADR 0003 as amended 2026-11-22): the session's media key
// set in the phone's frame cryptor, through the SDK's own classes (`@livekit/react-native` 3.1.0):
// `RNKeyProvider` in shared-key mode (`src/e2ee/RNKeyProvider.ts:30-52`) and `RNE2EEManager`
// (`src/e2ee/RNE2EEManager.ts:50-58`), which the `Room` is made with. Not the hook
// `useRNE2EEManager` (`src/hooks/useE2EEManager.ts:29-35`), which only warns when the key cannot be
// set: here a key that cannot be set, or a build with no frame cryptor (`new RNKeyProvider` calls
// the native module at once, `RNKeyProvider.ts:50-51`), is a failure the room does not join on.
// The key lives in the native key provider only, and `forget` drops it when the room ends.
import { RNE2EEManager, RNKeyProvider } from '@livekit/react-native';

export interface MediaEncryption {
  /** What the `Room` encrypts with (`RoomOptions.encryption`). */
  readonly manager: RNE2EEManager;
  /** Drops the key from the phone's frame cryptor; once. */
  forget(): void;
}

/**
 * `mediaKey`'s 32 bytes. Handed as bytes: a string is taken as a passphrase
 * (`@livekit/react-native-webrtc` 150.1.0, `src/RTCKeyProvider.ts:28-34`).
 */
function bytesOf(mediaKey: string): Uint8Array {
  return Uint8Array.from(atob(mediaKey), (char) => char.charCodeAt(0));
}

/** The key set, awaited; rejects when the phone cannot. */
export async function encryptionFor(mediaKey: string): Promise<MediaEncryption> {
  const keyProvider = new RNKeyProvider({ sharedKey: true });
  let forgotten = false;
  const forget = () => {
    if (forgotten) return;
    forgotten = true;
    keyProvider.dispose();
  };
  try {
    const set: unknown = await keyProvider.setSharedKey(bytesOf(mediaKey));
    if (set === false) throw new Error('The frame cryptor refused the key.');
  } catch (error) {
    forget();
    throw error;
  }
  return { manager: new RNE2EEManager(keyProvider), forget };
}
