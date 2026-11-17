// T121, T005 of specs/005-certification (R-405, FR-056): the push port's entry picks the adapter from
// `PUSH_PROVIDER`. `expo` serves Expo's push service, with `EXPO_ACCESS_TOKEN` when the project
// turns it on and without it otherwise; `fake` the stand-in. Building an adapter makes no request.
import { describe, expect, it } from 'vitest';

import { ExpoPushAdapter } from './expo.adapter.js';
import { FakePushAdapter } from './fake.adapter.js';
import { createPushPort } from './index.js';

describe('push selection (T121, T005, FR-056)', () => {
  it('serves the stand-in when PUSH_PROVIDER is fake', () => {
    expect(createPushPort({ PUSH_PROVIDER: 'fake' })).toBeInstanceOf(FakePushAdapter);
  });

  it('serves Expo when PUSH_PROVIDER is expo, with or without the access token (T005)', () => {
    expect(createPushPort({ PUSH_PROVIDER: 'expo' })).toBeInstanceOf(ExpoPushAdapter);
    expect(
      createPushPort({ PUSH_PROVIDER: 'expo', EXPO_ACCESS_TOKEN: 'expo-placeholder' }),
    ).toBeInstanceOf(ExpoPushAdapter);
  });
});
