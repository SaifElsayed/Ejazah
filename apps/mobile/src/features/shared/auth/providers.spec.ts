// B50 T148 (research R-103, ADR 0012 D2; the note under T148): the identity token a provider hands
// the device. On Android Google's token comes from Credential Manager through the local module
// `modules/google-id`, its `nonce` claim the server's nonce exactly as `auth.providerNonce` minted
// it: the live adapter compares the claim with that value as given, so it is never hashed (Apple's
// is, as Apple requires). iOS keeps google-signin until the first App Store submission.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';

import { nativeIdentity } from './providers';

const mockGoogleIdSignIn = jest.fn<(webClientId: string, nonce: string) => Promise<unknown>>();
const mockGoogleIdSignOut = jest.fn<() => Promise<void>>();
jest.mock('../../../lib/google-id', () => ({
  googleIdSignIn: (webClientId: string, nonce: string) => mockGoogleIdSignIn(webClientId, nonce),
  googleIdSignOut: () => mockGoogleIdSignOut(),
}));

const mockGoogleSignin = {
  configure: jest.fn(),
  hasPlayServices: jest.fn<() => Promise<boolean>>(),
  signIn: jest.fn<() => Promise<unknown>>(),
  signOut: jest.fn<() => Promise<null>>(),
};
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (options: unknown) => mockGoogleSignin.configure(options),
    hasPlayServices: () => mockGoogleSignin.hasPlayServices(),
    signIn: () => mockGoogleSignin.signIn(),
    signOut: () => mockGoogleSignin.signOut(),
  },
  isErrorWithCode: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
  isSuccessResponse: (response: { type?: unknown } | undefined) => response?.type === 'success',
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

const mockAppleSignIn = jest.fn<(options: { nonce?: string }) => Promise<unknown>>();
jest.mock('expo-apple-authentication', () => ({
  signInAsync: (options: { nonce?: string }) => mockAppleSignIn(options),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

const mockDigest = jest.fn((_algorithm: string, value: string) =>
  Promise.resolve(`sha256:${value}`),
);
jest.mock('expo-crypto', () => ({
  digestStringAsync: (algorithm: string, value: string) => mockDigest(algorithm, value),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

const WEB_CLIENT_ID = 'web-client-id.apps.googleusercontent.com';
/** The value `auth.providerNonce` answered, as the live adapter compares it. */
const SERVER_NONCE = 'server-nonce-0193a6f0';

const mockNative = {
  signIn: jest.fn<(webClientId: string, nonce: string) => Promise<unknown>>(),
  signOut: jest.fn<() => Promise<void>>(),
};
let mockAvailable = true;
jest.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) =>
    mockAvailable && name === 'GoogleId' ? mockNative : null,
}));

/** The wrapper afresh, as the process loads it. */
function loadWrapper(): typeof import('../../../lib/google-id') {
  let loaded: typeof import('../../../lib/google-id') | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<typeof import('../../../lib/google-id')>('../../../lib/google-id');
  });
  if (loaded === undefined) throw new Error('not loaded');
  return loaded;
}

beforeEach(() => {
  mockAvailable = true;
  mockNative.signIn.mockReset();
  mockNative.signOut.mockReset();
  mockGoogleIdSignIn.mockReset();
  mockGoogleIdSignOut.mockReset();
  mockGoogleSignin.configure.mockReset();
  mockGoogleSignin.hasPlayServices.mockReset().mockResolvedValue(true);
  // google-signin answers a token of its own, so a path that reaches it shows.
  mockGoogleSignin.signIn.mockReset().mockResolvedValue({
    type: 'success',
    data: { idToken: 'google-signin-token', user: { email: 'amal@example.com' } },
  });
  mockGoogleSignin.signOut.mockReset().mockResolvedValue(null);
  mockAppleSignIn.mockReset();
  mockDigest.mockClear();
  process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'] = WEB_CLIENT_ID;
});

afterEach(() => {
  delete process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'];
  jest.restoreAllMocks();
});

describe('nativeIdentity: Google on Android (Credential Manager)', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
  });

  it("asks Google's module over the Web client ID and the server's nonce, unhashed", async () => {
    mockGoogleIdSignIn.mockResolvedValue({ idToken: 'id-token-1', email: 'amal@example.com' });
    const identity = await nativeIdentity('google', SERVER_NONCE);
    expect(mockGoogleIdSignIn).toHaveBeenCalledTimes(1);
    expect(mockGoogleIdSignIn).toHaveBeenCalledWith(WEB_CLIENT_ID, SERVER_NONCE);
    expect(mockDigest).not.toHaveBeenCalled();
    expect(mockGoogleSignin.signIn).not.toHaveBeenCalled();
    expect(identity).toEqual({ identityToken: 'id-token-1', email: 'amal@example.com' });
  });

  it('answers null when the person closes the sheet', async () => {
    mockGoogleIdSignIn.mockResolvedValue(null);
    await expect(nativeIdentity('google', SERVER_NONCE)).resolves.toBeNull();
  });

  it('refuses without a Web client ID, asking nothing of Google', async () => {
    delete process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'];
    await expect(nativeIdentity('google', SERVER_NONCE)).rejects.toThrow('Web client ID');
    expect(mockGoogleIdSignIn).not.toHaveBeenCalled();
    expect(mockGoogleSignin.signIn).not.toHaveBeenCalled();
  });
});

describe('nativeIdentity: iOS and Apple, as before', () => {
  it('signs in with Google through google-signin on iOS, never the Android module', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const identity = await nativeIdentity('google', SERVER_NONCE);
    expect(mockGoogleSignin.signIn).toHaveBeenCalledTimes(1);
    expect(mockGoogleIdSignIn).not.toHaveBeenCalled();
    expect(identity).toEqual({ identityToken: 'google-signin-token', email: 'amal@example.com' });
  });

  it("sends Apple the SHA-256 of the server's nonce, as Apple requires", async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    mockAppleSignIn.mockResolvedValue({
      identityToken: 'apple-token',
      authorizationCode: 'code-1',
      email: 'amal@example.com',
    });
    const identity = await nativeIdentity('apple', SERVER_NONCE);
    expect(mockDigest).toHaveBeenCalledWith('SHA-256', SERVER_NONCE);
    expect(mockAppleSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: `sha256:${SERVER_NONCE}` }),
    );
    expect(identity).toEqual({
      identityToken: 'apple-token',
      authorizationCode: 'code-1',
      email: 'amal@example.com',
    });
  });
});

/** The providers afresh, as the process loads them: google-signin not yet configured. */
function loadProviders(): typeof import('./providers') {
  let loaded: typeof import('./providers') | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<typeof import('./providers')>('./providers');
  });
  if (loaded === undefined) throw new Error('not loaded');
  return loaded;
}

describe('signOutProviders: the Google SDK signed out with the app (B50 T148)', () => {
  it("signs out of Google's module on Android", async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockGoogleIdSignOut.mockResolvedValue(undefined);
    await loadProviders().signOutProviders();
    expect(mockGoogleIdSignOut).toHaveBeenCalledTimes(1);
    expect(mockGoogleSignin.signOut).not.toHaveBeenCalled();
  });

  it('signs out of google-signin on iOS once it was configured, and not before', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const providers = loadProviders();
    await providers.signOutProviders();
    expect(mockGoogleSignin.signOut).not.toHaveBeenCalled();
    await providers.nativeIdentity('google', SERVER_NONCE);
    await providers.signOutProviders();
    expect(mockGoogleSignin.signOut).toHaveBeenCalledTimes(1);
    expect(mockGoogleIdSignOut).not.toHaveBeenCalled();
  });

  it('swallows a failed sign-out and logs it with no data', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGoogleIdSignOut.mockRejectedValue(new Error('id-token-1 amal@example.com'));
    await expect(loadProviders().signOutProviders()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toEqual([expect.any(String)]);
    expect(String(warn.mock.calls[0]?.[0])).not.toMatch(/id-token-1|amal@example\.com/);
  });
});

describe('the Google ID module (lib/google-id)', () => {
  it('signs in through the module with the Web client ID and the nonce as given', async () => {
    mockNative.signIn.mockResolvedValue({ idToken: 'id-token-1', email: 'amal@example.com' });
    const answer = await loadWrapper().googleIdSignIn('web-client', 'server-nonce');
    expect(mockNative.signIn).toHaveBeenCalledWith('web-client', 'server-nonce');
    expect(answer).toEqual({ idToken: 'id-token-1', email: 'amal@example.com' });
  });

  it('answers null when the person closes the sheet', async () => {
    mockNative.signIn.mockResolvedValue(null);
    await expect(loadWrapper().googleIdSignIn('web-client', 'server-nonce')).resolves.toBeNull();
  });

  it('signs out through the module', async () => {
    mockNative.signOut.mockResolvedValue(undefined);
    await loadWrapper().googleIdSignOut();
    expect(mockNative.signOut).toHaveBeenCalledTimes(1);
  });

  it('fails the sign-in as unavailable in a build without the module, and signs out of nothing', async () => {
    mockAvailable = false;
    const wrapper = loadWrapper();
    await expect(wrapper.googleIdSignIn('web-client', 'server-nonce')).rejects.toThrow(
      'not available',
    );
    await expect(wrapper.googleIdSignOut()).resolves.toBeUndefined();
    expect(mockNative.signIn).not.toHaveBeenCalled();
    expect(mockNative.signOut).not.toHaveBeenCalled();
  });
});
