// R3 T184 (SRS DEC-99, DEC-109; the note under T184, Q-2 (a′)): the running build's number, read
// from the binary with `expo-application`'s `nativeBuildVersion` (Play's version code, a string).
// A whole number of one to ten digits is the number the phone sends in `x-app-build`; anything else
// (none under Expo Go or on the web, an empty value, a decimal, letters, eleven digits) is no
// number, and the phone then sends no header at all (the server admits a call with none).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { APP_BUILD_HEADER, appBuild } from './app-build';

let mockNativeBuildVersion: string | null = null;
jest.mock('expo-application', () => ({
  get nativeBuildVersion() {
    return mockNativeBuildVersion;
  },
}));

beforeEach(() => {
  mockNativeBuildVersion = null;
});

describe('the running build’s number (R3 T184)', () => {
  it('is the version code as a number', () => {
    mockNativeBuildVersion = '3';
    expect(appBuild()).toBe(3);
  });

  it('reads leading zeros as the same whole number', () => {
    mockNativeBuildVersion = '0012';
    expect(appBuild()).toBe(12);
  });

  it('is no number when the binary has none (Expo Go, the web)', () => {
    mockNativeBuildVersion = null;
    expect(appBuild()).toBeNull();
  });

  it('is no number for an empty value', () => {
    mockNativeBuildVersion = '';
    expect(appBuild()).toBeNull();
  });

  it('is no number for a decimal', () => {
    mockNativeBuildVersion = '1.0';
    expect(appBuild()).toBeNull();
  });

  it('is no number for letters', () => {
    mockNativeBuildVersion = 'abc';
    expect(appBuild()).toBeNull();
  });

  it('is no number past ten digits, as the server reads the header', () => {
    mockNativeBuildVersion = '12345678901';
    expect(appBuild()).toBeNull();
  });

  it('travels in x-app-build', () => {
    expect(APP_BUILD_HEADER).toBe('x-app-build');
  });
});
