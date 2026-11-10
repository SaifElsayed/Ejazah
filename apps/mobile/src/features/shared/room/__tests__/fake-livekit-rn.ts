// T019 of specs/004-sessions: `@livekit/react-native` as the room's specs see it: the audio session
// and the globals as `jest.setup.js` mocks them, and `VideoTrack` drawn as a view named by whose
// track it shows (`video:<identity or me>:<source>`).
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
