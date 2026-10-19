// T022: the sign-in port's entry. Which adapter serves the port is `SIGN_IN_PROVIDER` in the loaded
// configuration, never a code change (FR-056); `ports.module.ts` calls this once at startup, and
// nothing else names an adapter (R-API-4). The live adapter's member (`live`: Google's and Apple's
// JWK sets, verified with `node:crypto`, contracts/ports.md) and its case are added by the adapter
// task; the provider keys it reads are already in the schema, optional and stripped from tests.
import type { Config } from '../../config/config.module.js';
import { FakeSignInAdapter } from './fake.adapter.js';
import type { SignInPort } from './sign-in.port.js';

export type SignInConfig = Pick<Config, 'SIGN_IN_PROVIDER'>;

export function createSignInPort(config: SignInConfig): SignInPort {
  switch (config.SIGN_IN_PROVIDER) {
    case 'fake':
      return new FakeSignInAdapter();
  }
}
