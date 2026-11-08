// T138: NetInfo is a native module the test run does not have; every spec gets the library's own
// Jest mock (connected, and an `addEventListener` that never reports), as its documentation says.
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// T017 (research R-316): the video SDK's native half exists only in the development build; every
// spec gets a stand-in for the calls the app makes outside a room (`registerGlobals`, the audio
// session). The room's own specs (T019) mock what they draw.
jest.mock('@livekit/react-native', () => ({
  registerGlobals: jest.fn(),
  AudioSession: {
    startAudioSession: jest.fn(() => Promise.resolve()),
    stopAudioSession: jest.fn(() => Promise.resolve()),
  },
}));
