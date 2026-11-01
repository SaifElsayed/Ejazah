// T138: NetInfo is a native module the test run does not have; every spec gets the library's own
// Jest mock (connected, and an `addEventListener` that never reports), as its documentation says.
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);
