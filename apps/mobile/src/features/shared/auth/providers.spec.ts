// B50 T148 (research R-103, ADR 0012 D2; the note under T148): the identity token a provider hands
// the device. On Android Google's token comes from Credential Manager through the local module
// `modules/google-id`, its `nonce` claim the server's nonce exactly as `auth.providerNonce` minted
// it: the live adapter compares the claim with that value as given, so it is never hashed (Apple's
// is, as Apple requires). iOS keeps google-signin until the first App Store submission.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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
