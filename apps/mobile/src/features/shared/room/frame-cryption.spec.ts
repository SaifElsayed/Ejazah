// 004:T084 (R1b; SRS NFR-SEC-13, R-HONEST): what each track's frame cryptor says of itself reaches
// the room. `@livekit/react-native`'s `RNE2EEManager` keeps its cryptors to itself and raises no
// event when a frame cannot be decrypted, so the room reads react-native-webrtc's own report of
// every cryptor's state change, `frameCryptionStateChanged`, from the native module.
import { describe, expect, it, jest } from '@jest/globals';

import { type CryptionSource, watchFrameCryption } from './frame-cryption';

/** The native module's emitter, as a spec drives it. */
function nativeEmitter() {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const remove = jest.fn();
  const source: CryptionSource = {
    addListener: (eventType, listener) => {
      if (!handlers.has(eventType)) handlers.set(eventType, new Set());
      handlers.get(eventType)?.add(listener);
      return {
        remove: () => {
          remove();
          handlers.get(eventType)?.delete(listener);
        },
      };
    },
  };
  const emit = (eventType: string, event: unknown) => {
    for (const listener of [...(handlers.get(eventType) ?? [])]) listener(event);
  };
  const count = () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0);
  return { source, emit, remove, count };
}

describe('watchFrameCryption', () => {
  it('hands on each frame cryptor’s state change, and nothing once the watch is dropped', () => {
    const native = nativeEmitter();
    const changes = jest.fn();
    const stop = watchFrameCryption(changes, native.source);
    native.emit('frameCryptionStateChanged', {
      event: 'frameCryptionStateChanged',
      participantId: 'teacher-1',
      frameCryptorId: 'cryptor-1',
      state: 'decryptionFailed',
    });
    expect(changes).toHaveBeenCalledWith({
      participantId: 'teacher-1',
      frameCryptorId: 'cryptor-1',
      state: 'decryptionFailed',
    });
    stop();
    expect(native.remove).toHaveBeenCalledTimes(1);
    expect(native.count()).toBe(0);
    native.emit('frameCryptionStateChanged', {
      participantId: 'teacher-1',
      frameCryptorId: 'cryptor-1',
      state: 'ok',
    });
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('hands on nothing that is not a cryptor’s change: another event, or a change missing a field', () => {
    const native = nativeEmitter();
    const changes = jest.fn();
    watchFrameCryption(changes, native.source);
    native.emit('peerConnectionStateChanged', {
      participantId: 'teacher-1',
      frameCryptorId: 'cryptor-1',
      state: 'ok',
    });
    for (const event of [
      undefined,
      'decryptionFailed',
      { frameCryptorId: 'cryptor-1', state: 'decryptionFailed' },
      { participantId: 'teacher-1', state: 'decryptionFailed' },
      { participantId: 'teacher-1', frameCryptorId: 'cryptor-1' },
      { participantId: 7, frameCryptorId: 'cryptor-1', state: 'decryptionFailed' },
    ]) {
      native.emit('frameCryptionStateChanged', event);
    }
    expect(changes).not.toHaveBeenCalled();
  });
});
