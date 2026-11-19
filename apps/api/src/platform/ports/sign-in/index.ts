// T022: the sign-in port's entry. Which adapter serves the port is `SIGN_IN_PROVIDER` in the loaded
// configuration, never a code change (FR-056); `ports.module.ts` calls this once at startup, and
// nothing else names an adapter (R-API-4).
//
// 002:T148 (B50): `live` serves the live adapter (`live.adapter.ts`: Google's token verified with
// `node:crypto` against Google's published key set; Apple refused until iOS, Q-T4 (a)) with
// GOOGLE_CLIENT_IDS as its audiences and the process logger for its refusal lines. The configuration
// refuses `live` without GOOGLE_CLIENT_IDS, and this entry refuses again, naming the key, so no
// caller can build it half-set (the payment entry's precedent, T056).
import type { Config } from '../../config/config.module.js';
import { FakeSignInAdapter } from './fake.adapter.js';
import { LiveSignInAdapter, type SignInLog } from './live.adapter.js';
import type { SignInPort } from './sign-in.port.js';

export type SignInConfig = Pick<Config, 'SIGN_IN_PROVIDER'> &
  Partial<Pick<Config, 'GOOGLE_CLIENT_IDS'>>;

export function createSignInPort(config: SignInConfig, log?: SignInLog): SignInPort {
  switch (config.SIGN_IN_PROVIDER) {
    case 'fake':
      return new FakeSignInAdapter();
    case 'live':
      if (config.GOOGLE_CLIENT_IDS === undefined) {
        throw new Error('SIGN_IN_PROVIDER=live needs GOOGLE_CLIENT_IDS.');
      }
      return new LiveSignInAdapter({ googleClientIds: config.GOOGLE_CLIENT_IDS, log });
  }
}
