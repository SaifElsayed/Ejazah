// T017 of specs/004-sessions (research R-316; FR-430, FR-433): the phone's video SDK set up once.
// `registerGlobals()` (the WebRTC globals livekit-client needs) runs once per process, from the root
// layout; the audio session starts before a room is connected and stops after it is left. The SDK
// is mocked: its native half exists only in the development build.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AudioSession, registerGlobals } from '@livekit/react-native';

import { registerVideoGlobals, resetVideoGlobalsForTests, startAudio, stopAudio } from './livekit';

const register = registerGlobals as unknown as jest.Mock;
const start = AudioSession.startAudioSession as unknown as jest.Mock;
const stop = AudioSession.stopAudioSession as unknown as jest.Mock;

beforeEach(() => {
  resetVideoGlobalsForTests();
  register.mockClear();
  start.mockClear();
  stop.mockClear();
});

describe('registerVideoGlobals', () => {
  it('registers the WebRTC globals once, however often it is called', () => {
    registerVideoGlobals();
    registerVideoGlobals();
    expect(register).toHaveBeenCalledTimes(1);
  });
});

describe('the audio session', () => {
  it('starts before connecting and stops after leaving', async () => {
    await startAudio();
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    await stopAudio();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
