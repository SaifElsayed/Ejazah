// T019 of specs/004-sessions: `@livekit/react-native` as the room's specs see it: the audio session
// and the globals as `jest.setup.js` mocks them, and `VideoTrack` drawn as a view named by whose
// track it shows (`video:<identity or me>:<source>`). 004:T084 (R1b): the key provider and the
// manager the room encrypts with.
import { jest } from '@jest/globals';
import { createElement } from 'react';
import { View } from 'react-native';

export const registerGlobals: jest.Mock<() => void> = jest.fn();

export const AudioSession: {
  readonly startAudioSession: jest.Mock<() => Promise<void>>;
  readonly stopAudioSession: jest.Mock<() => Promise<void>>;
} = {
  startAudioSession: jest.fn(() => Promise.resolve()),
  stopAudioSession: jest.fn(() => Promise.resolve()),
};

/**
 * 004:T084 (R1b): the SDK's key provider, its native half absent: what it was made with, the keys
 * set in it (copied as they arrive), and whether it was disposed. `setSharedKey` answers what each
 * case says.
 */
export class FakeKeyProvider {
  readonly keys: Uint8Array[] = [];
  readonly setSharedKey: jest.Mock<(key: string | Uint8Array) => Promise<boolean>> = jest.fn(
    async (key: string | Uint8Array) => {
      this.keys.push(typeof key === 'string' ? new TextEncoder().encode(key) : Uint8Array.from(key));
      return true;
    },
  );
  readonly dispose: jest.Mock<() => void> = jest.fn();
  constructor(readonly options: unknown) {}
}

/** Every key provider the code under test made, in order. */
export const keyProviders: FakeKeyProvider[] = [];

function keyProvider(options: unknown): FakeKeyProvider {
  const made = new FakeKeyProvider(options);
  keyProviders.push(made);
  return made;
}

export const RNKeyProvider: jest.Mock<(options: unknown) => FakeKeyProvider> =
  jest.fn(keyProvider);

/** Every key provider made from now on, as `prepare` sets it up. */
export function everyKeyProvider(prepare: (made: FakeKeyProvider) => void): void {
  RNKeyProvider.mockImplementation((options: unknown) => {
    const made = keyProvider(options);
    prepare(made);
    return made;
  });
}

/** The next key provider made, as `prepare` sets it up. */
export function nextKeyProvider(prepare: (made: FakeKeyProvider) => void): void {
  RNKeyProvider.mockImplementationOnce((options: unknown) => {
    const made = keyProvider(options);
    prepare(made);
    return made;
  });
}

/** The SDK's manager, as a `Room` is handed it: what it was made with. */
export class FakeE2EEManager {
  constructor(
    readonly keyProvider: FakeKeyProvider,
    readonly dataChannelEncryption?: boolean,
  ) {}
}

export const RNE2EEManager: jest.Mock<
  (keyProvider: FakeKeyProvider, dataChannelEncryption?: boolean) => FakeE2EEManager
> = jest.fn(
  (keyProvider: FakeKeyProvider, dataChannelEncryption?: boolean) =>
    new FakeE2EEManager(keyProvider, dataChannelEncryption),
);

export function resetEncryption(): void {
  keyProviders.length = 0;
  RNKeyProvider.mockReset();
  RNKeyProvider.mockImplementation(keyProvider);
  RNE2EEManager.mockClear();
}

export function VideoTrack({
  trackRef,
}: {
  readonly trackRef?: {
    readonly source: string;
    readonly participant: { readonly identity?: string };
  };
}) {
  return createElement(View, {
    testID: `video:${trackRef?.participant.identity ?? 'me'}:${trackRef?.source ?? ''}`,
  });
}
