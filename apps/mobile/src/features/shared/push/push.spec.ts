// T020 of specs/005-certification (FR-623; Q-T2 (a)): the push permission and the token. Pushes
// allowed and a token held, `account.pushToken.register` takes the token once, with the device's
// platform; refused, or with no token, nothing is registered. The stand-in, the one binding of this
// build, asks nothing and yields no token, so it never registers.
import type { PushTokenRegisterInput } from '@ijazah/contracts';
import { describe, expect, it, jest } from '@jest/globals';

import {
  askAndRegister,
  devicePlatformOf,
  type PushBinding,
  pushBinding,
  standInPush,
} from './index';

const TOKEN = 'ExponentPushToken[device-1]';

function binding(allowed: boolean, token: string | null) {
  const ask = jest.fn(async () => allowed);
  const read = jest.fn(async () => token);
  const value: PushBinding = { ask, token: read };
  return { value, ask, read };
}

const register = () => jest.fn(async (_input: PushTokenRegisterInput) => undefined);

describe('askAndRegister', () => {
  it('asks, then registers the token once with the platform', async () => {
    const fake = binding(true, TOKEN);
    const registered = register();
    expect(await askAndRegister(fake.value, 'android', registered)).toBe(true);
    expect(fake.ask).toHaveBeenCalledTimes(1);
    expect(registered).toHaveBeenCalledTimes(1);
    expect(registered).toHaveBeenCalledWith({ token: TOKEN, platform: 'android' });
  });

  it('registers nothing when pushes are refused, and reads no token', async () => {
    const fake = binding(false, TOKEN);
    const registered = register();
    expect(await askAndRegister(fake.value, 'ios', registered)).toBe(false);
    expect(fake.read).not.toHaveBeenCalled();
    expect(registered).not.toHaveBeenCalled();
  });

  it('registers nothing when no token exists', async () => {
    const fake = binding(true, null);
    const registered = register();
    expect(await askAndRegister(fake.value, 'ios', registered)).toBe(false);
    expect(registered).not.toHaveBeenCalled();
  });

  it('asks nothing on a system that takes no push', async () => {
    const fake = binding(true, TOKEN);
    const registered = register();
    expect(await askAndRegister(fake.value, devicePlatformOf('web'), registered)).toBe(false);
    expect(fake.ask).not.toHaveBeenCalled();
    expect(registered).not.toHaveBeenCalled();
  });

  it('with the stand-in, never registers', async () => {
    const registered = register();
    expect(await askAndRegister(standInPush, 'android', registered)).toBe(false);
    expect(await standInPush.token()).toBeNull();
    expect(registered).not.toHaveBeenCalled();
  });

  it('binds the stand-in in this build (Q-T2 (a))', () => {
    expect(pushBinding).toBe(standInPush);
  });
});

describe('devicePlatformOf', () => {
  it('names iOS and Android, and nothing else', () => {
    expect(devicePlatformOf('ios')).toBe('ios');
    expect(devicePlatformOf('android')).toBe('android');
    expect(devicePlatformOf('web')).toBeNull();
  });
});
