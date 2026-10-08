// T121: the messaging port's entry. Which adapter serves the port is `SMS_PROVIDER` in the loaded
// configuration, never a code change (FR-056); `ports.module.ts` calls this once at startup, and
// nothing else names an adapter (R-API-4). The real provider's member and its case are added by the
// Phase 1 adapter task.
import type { Config } from '../../config/config.module.js';
import { FakeSmsAdapter } from './fake.adapter.js';
import type { SmsPort } from './sms.port.js';

export type SmsConfig = Pick<Config, 'SMS_PROVIDER'>;

export function createSmsPort(config: SmsConfig): SmsPort {
  switch (config.SMS_PROVIDER) {
    case 'fake':
      return new FakeSmsAdapter();
  }
}
