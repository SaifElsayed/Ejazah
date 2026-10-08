// T121: the push port's entry. Which adapter serves the port is `PUSH_PROVIDER` in the loaded
// configuration, never a code change (FR-056); `ports.module.ts` calls this once at startup, and
// nothing else names an adapter (R-API-4) or this folder (R-API-15). The real provider's member and
// its case are added by the Phase 4 adapter task.
import type { Config } from '../../config/config.module.js';
import { FakePushAdapter } from './fake.adapter.js';
import type { PushPort } from './push.port.js';

export type PushConfig = Pick<Config, 'PUSH_PROVIDER'>;

export function createPushPort(config: PushConfig): PushPort {
  switch (config.PUSH_PROVIDER) {
    case 'fake':
      return new FakePushAdapter();
  }
}
