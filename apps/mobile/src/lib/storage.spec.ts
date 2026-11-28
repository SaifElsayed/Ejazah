// T033: the one sensitive store (R-MOBILE-10). The two session tokens live in the device's secure
// store, never in plain storage, readable only on this device after its first unlock.
import { describe, expect, it } from '@jest/globals';
import { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY } from 'expo-secure-store';

import { createPushTokenStore, createSessionStore, type SecureStoreLike } from './storage';

/** An in-memory secure store that records the options each write was given. */
function fakeSecureStore() {
  const items = new Map<string, string>();
  const options: unknown[] = [];
  const store: SecureStoreLike = {
    getItemAsync: async (key) => items.get(key) ?? null,
    setItemAsync: async (key, value, written) => {
      items.set(key, value);
      options.push(written);
    },
    deleteItemAsync: async (key) => {
      items.delete(key);
    },
  };
  return { store, items, options };
}

const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1' };

describe('the session store', () => {
  it('writes and reads the two tokens', async () => {
    const { store } = fakeSecureStore();
    const sessions = createSessionStore(store);
    await sessions.write(tokens);
    expect(await sessions.read()).toEqual(tokens);
  });

  it('keeps each token on this device only, after its first unlock', async () => {
    const { store, options } = fakeSecureStore();
    await createSessionStore(store).write(tokens);
    expect(options).toHaveLength(2);
    expect(AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY).toBeDefined();
    for (const written of options) {
      expect(written).toEqual({ keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    }
  });

  it('reads no session when either token is missing, and removes the half left', async () => {
    const { store, items } = fakeSecureStore();
    const sessions = createSessionStore(store);
    await sessions.write(tokens);
    items.delete([...items.keys()][0] ?? '');
    expect(await sessions.read()).toBeNull();
    expect(items.size).toBe(0);
  });

  // Each value stays small (a Keychain item over 2 KB may fail on iOS), so the two keys stay and the
  // operations run one at a time (review of B6, finding 2).
  it('never loses a sign-in to a read that runs while it is written', async () => {
    const { store } = fakeSecureStore();
    const sessions = createSessionStore(store);
    await sessions.clear();
    const [, during] = await Promise.all([sessions.write(tokens), sessions.read()]);
    expect([null, tokens]).toContainEqual(during);
    expect(await sessions.read()).toEqual(tokens);
  });

  it('clears both tokens', async () => {
    const { store, items } = fakeSecureStore();
    const sessions = createSessionStore(store);
    await sessions.write(tokens);
    await sessions.clear();
    expect(items.size).toBe(0);
    expect(await sessions.read()).toBeNull();
  });
});

// R3 (005:T020's follow-up, the owner's (a)): the push token kept for a later sign-out.
describe('the push token store', () => {
  it('writes, reads and clears the token, on this device only', async () => {
    const { store, items, options } = fakeSecureStore();
    const pushTokens = createPushTokenStore(store);
    expect(await pushTokens.read()).toBeNull();
    await pushTokens.write('ExponentPushToken[device-1]');
    expect(await pushTokens.read()).toBe('ExponentPushToken[device-1]');
    expect(options).toEqual([{ keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }]);
    await pushTokens.clear();
    expect(items.size).toBe(0);
    expect(await pushTokens.read()).toBeNull();
  });

  it('is kept apart from the session', async () => {
    const { store } = fakeSecureStore();
    await createPushTokenStore(store).write('ExponentPushToken[device-1]');
    const sessions = createSessionStore(store);
    await sessions.write(tokens);
    await sessions.clear();
    expect(await createPushTokenStore(store).read()).toBe('ExponentPushToken[device-1]');
  });
});
