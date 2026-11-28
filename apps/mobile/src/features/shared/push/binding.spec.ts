// R3 (specs/005-certification T020's follow-ups; 002:T182's note, (4); Q-4 (a)): the push binding on
// `expo-notifications`. `ask()` makes Android's default channel first (Android 13 shows the
// permission prompt only once a channel exists), named in the person's language, then answers with
// the system's permission. `token()` is the device's Expo push token for the EAS project of
// `app.json`, and null on any failure (a build without the Firebase file has none), so the screen
// that asks never sees an error. The token read is held, and kept in the secure store (the owner's
// (a), 2026-11-28), for the sign-out to remove it, in this process or a later one.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import app from '../../../../app.json';

const mockCalls: string[] = [];
const mockChannel = jest.fn(async (_id: string, _channel: { name: string }) => {
  mockCalls.push('channel');
  return null;
});
const mockRequest = jest.fn(async () => {
  mockCalls.push('request');
  return { granted: true };
});
const mockExpoToken = jest.fn(async (_options: { projectId: string }) => ({
  type: 'expo',
  data: 'ExponentPushToken[device-1]',
}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: (id: string, channel: { name: string }) => mockChannel(id, channel),
  requestPermissionsAsync: () => mockRequest(),
  getExpoPushTokenAsync: (options: { projectId: string }) => mockExpoToken(options),
}));

/** The device's secure store, in memory; it outlives a process (`load()`), as the device's does. */
const PUSH_TOKEN_KEY = 'ijazah.push.token';
const mockKept = new Map<string, string>();
let mockReadFails = false;
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (key: string) => {
    if (mockReadFails) throw new Error('the keystore cannot be read');
    return mockKept.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    mockKept.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockKept.delete(key);
  },
}));

type Loaded = typeof import('./binding') & Pick<typeof import('../../../i18n'), 'setLocale'>;

/** The binding afresh, as the process loads it, with nothing held, and the catalogue it reads. */
function load(): Loaded {
  let loaded: Loaded | undefined;
  jest.isolateModules(() => {
    const i18n = require('../../../i18n') as typeof import('../../../i18n');
    i18n.setLocale('ar');
    loaded = { ...(require('./binding') as typeof import('./binding')), setLocale: i18n.setLocale };
  });
  if (loaded === undefined) throw new Error('not loaded');
  return loaded;
}

beforeEach(() => {
  mockCalls.length = 0;
  mockChannel.mockClear();
  mockRequest.mockClear();
  mockExpoToken.mockClear();
  mockKept.clear();
  mockReadFails = false;
});

describe('the push binding on expo-notifications', () => {
  it('is the binding the screens use', () => {
    const binding = load();
    expect(binding.pushBinding).toBe(binding.expoPush);
    expect(binding.pushBinding).not.toBe(binding.standInPush);
  });

  it('makes the default channel, named in the person’s language, before it asks', async () => {
    const { expoPush, setLocale } = load();
    expect(await expoPush.ask()).toBe(true);
    expect(mockCalls).toEqual(['channel', 'request']);
    expect(mockChannel.mock.calls[0]?.[0]).toBe('default');
    expect(mockChannel.mock.calls[0]?.[1]).toMatchObject({ name: 'التنبيهات' });
    setLocale('en');
    await expoPush.ask();
    expect(mockChannel.mock.calls[1]?.[1]).toMatchObject({ name: 'Notifications' });
  });

  it('answers false when the system refuses', async () => {
    mockRequest.mockResolvedValueOnce({ granted: false });
    const { expoPush } = load();
    expect(await expoPush.ask()).toBe(false);
  });

  it('reads the Expo token for app.json’s EAS project, holds it and keeps it', async () => {
    const { expoPush, heldPushToken } = load();
    expect(await heldPushToken()).toBeNull();
    expect(await expoPush.token()).toBe('ExponentPushToken[device-1]');
    expect(mockExpoToken).toHaveBeenCalledWith({ projectId: app.expo.extra.eas.projectId });
    expect(await heldPushToken()).toBe('ExponentPushToken[device-1]');
    expect(mockKept.get(PUSH_TOKEN_KEY)).toBe('ExponentPushToken[device-1]');
  });

  it('answers null, and holds nothing, when the token cannot be read', async () => {
    mockExpoToken.mockRejectedValueOnce(new Error('no Firebase file in this build'));
    const { expoPush, heldPushToken } = load();
    await expect(expoPush.token()).resolves.toBeNull();
    expect(await heldPushToken()).toBeNull();
    expect(mockKept.size).toBe(0);
  });

  // R3 (T020's follow-up, the owner's (a)): a sign-out before any screen has asked.
  it('holds the token kept by an earlier process, until it is forgotten', async () => {
    await load().expoPush.token();
    const later = load();
    expect(mockExpoToken).toHaveBeenCalledTimes(1);
    expect(await later.heldPushToken()).toBe('ExponentPushToken[device-1]');
    await later.forgetPushToken();
    expect(await later.heldPushToken()).toBeNull();
    expect(mockKept.size).toBe(0);
    expect(await load().heldPushToken()).toBeNull();
  });

  it('holds nothing when the store cannot be read', async () => {
    mockKept.set(PUSH_TOKEN_KEY, 'ExponentPushToken[device-1]');
    mockReadFails = true;
    expect(await load().heldPushToken()).toBeNull();
  });
});
