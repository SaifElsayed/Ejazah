// T121: the push port's entry. Which adapter serves the port is `PUSH_PROVIDER` in the loaded
// configuration, never a code change (FR-056); `ports.module.ts` calls this once at startup, and
// nothing else names an adapter (R-API-4) or this folder (R-API-15).
//
// T005 of specs/005-certification (R-405, P2 (a)): `expo` serves Expo's push service
// (`expo.adapter.ts`), with `EXPO_ACCESS_TOKEN` as its bearer when the project turns it on and none
// otherwise; the stand-in reads neither.
import type { Config } from '../../config/config.module.js';
import { ExpoPushAdapter } from './expo.adapter.js';
import { FakePushAdapter } from './fake.adapter.js';
import type { PushPort } from './push.port.js';

export type PushConfig = Pick<Config, 'PUSH_PROVIDER'> & Partial<Pick<Config, 'EXPO_ACCESS_TOKEN'>>;

export function createPushPort(config: PushConfig): PushPort {
  switch (config.PUSH_PROVIDER) {
    case 'fake':
      return new FakePushAdapter();
    case 'expo':
      return new ExpoPushAdapter(
        config.EXPO_ACCESS_TOKEN === undefined ? {} : { accessToken: config.EXPO_ACCESS_TOKEN },
      );
  }
}
