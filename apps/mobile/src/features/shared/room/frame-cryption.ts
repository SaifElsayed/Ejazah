// 004:T084 (R1b; SRS NFR-SEC-13, R-HONEST): what each track's frame cryptor says of itself. The
// SDK's `RNE2EEManager` (`@livekit/react-native` 3.1.0, `src/e2ee/RNE2EEManager.ts:40`, `:152`)
// keeps its cryptors private and raises nothing when a frame cannot be decrypted, so the room reads
// react-native-webrtc's own report of every cryptor's change, the native module's event
// `frameCryptionStateChanged` (`@livekit/react-native-webrtc` 150.1.0, `src/EventEmitter.ts:25`;
// Android `RTCCryptoManager.java:74-80`): the participant the track is of, the cryptor's id and its
// state (`new`, `ok`, `decryptionFailed`, `encryptionFailed`, `missingKey`, `keyRatcheted`,
// `internalError`). Nothing of the key is in it.
import { NativeEventEmitter, NativeModules } from 'react-native';

export interface CryptionChange {
  readonly participantId: string;
  readonly frameCryptorId: string;
  readonly state: string;
}

/** The part of the native module's emitter the watch uses (a spec hands its own). */
export interface CryptionSource {
  addListener(eventType: string, listener: (event: unknown) => void): { remove(): void };
}

const EVENT = 'frameCryptionStateChanged';

function isChange(event: unknown): event is CryptionChange {
  if (typeof event !== 'object' || event === null) return false;
  const { participantId, frameCryptorId, state } = event as Record<string, unknown>;
  return (
    typeof participantId === 'string' &&
    typeof frameCryptorId === 'string' &&
    typeof state === 'string'
  );
}

function nativeSource(): CryptionSource {
  return new NativeEventEmitter(NativeModules.WebRTCModule) as unknown as CryptionSource;
}

/** Hands on every cryptor's change until the returned function drops the watch. */
export function watchFrameCryption(
  onChange: (change: CryptionChange) => void,
  source: CryptionSource = nativeSource(),
): () => void {
  const subscription = source.addListener(EVENT, (event) => {
    if (!isChange(event)) return;
    const { participantId, frameCryptorId, state } = event;
    onChange({ participantId, frameCryptorId, state });
  });
  return () => subscription.remove();
}
