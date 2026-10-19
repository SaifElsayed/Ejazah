// T023: the email port's entry. Which adapter serves the port is `EMAIL_PROVIDER` in the loaded
// configuration, never a code change (FR-056), and `EMAIL_FROM` is the sender it is handed;
// `ports.module.ts` calls this once at startup, and nothing else names an adapter (R-API-4). The
// live member arrives with the sender chosen at launch (contracts/ports.md "Selection").
import { join } from 'node:path';
import type { Config } from '../../config/config.module.js';
import type { EmailPort } from './email.port.js';
import { FakeEmailAdapter } from './fake.adapter.js';

export type EmailConfig = Pick<
  Config,
  'EMAIL_PROVIDER' | 'EMAIL_FROM' | 'NODE_ENV' | 'STORAGE_LOCAL_ROOT'
>;

/** The folder the stand-in writes mails to: under the local storage root in development, else none. */
export function mailDirectoryOf(
  config: Pick<Config, 'NODE_ENV' | 'STORAGE_LOCAL_ROOT'>,
): string | undefined {
  return config.NODE_ENV === 'development' ? join(config.STORAGE_LOCAL_ROOT, 'mail') : undefined;
}

export function createEmailPort(config: EmailConfig): EmailPort {
  switch (config.EMAIL_PROVIDER) {
    case 'fake': {
      const mailDirectory = mailDirectoryOf(config);
      return new FakeEmailAdapter({
        from: config.EMAIL_FROM,
        ...(mailDirectory === undefined ? {} : { mailDirectory }),
      });
    }
  }
}
