// T023: the email port's entry. Which adapter serves the port is `EMAIL_PROVIDER` in the loaded
// configuration, never a code change (FR-056), and `EMAIL_FROM` is the sender it is handed;
// `ports.module.ts` calls this once at startup, and nothing else names an adapter (R-API-4).
//
// 002:T177 (SRS DEC-108): `resend` serves Resend (`resend.adapter.ts`) with EMAIL_PROVIDER_KEY as its
// bearer, EMAIL_FROM under EMAIL_FROM_NAME as the sender and SUPPORT_EMAIL as the reply address. The
// configuration refuses `resend` without the key, and this entry refuses again, naming the key, so
// no caller can build it half-set (the sign-in entry's precedent, 002:T148).
import { join } from 'node:path';
import type { Config } from '../../config/config.module.js';
import type { EmailPort } from './email.port.js';
import { FakeEmailAdapter } from './fake.adapter.js';
import { ResendEmailAdapter } from './resend.adapter.js';

export type EmailConfig = Pick<
  Config,
  | 'EMAIL_PROVIDER'
  | 'EMAIL_FROM'
  | 'EMAIL_FROM_NAME'
  | 'SUPPORT_EMAIL'
  | 'NODE_ENV'
  | 'STORAGE_LOCAL_ROOT'
> &
  Partial<Pick<Config, 'EMAIL_PROVIDER_KEY'>>;

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
    case 'resend':
      if (config.EMAIL_PROVIDER_KEY === undefined) {
        throw new Error('EMAIL_PROVIDER=resend needs EMAIL_PROVIDER_KEY.');
      }
      return new ResendEmailAdapter({
        apiKey: config.EMAIL_PROVIDER_KEY,
        from: config.EMAIL_FROM,
        fromName: config.EMAIL_FROM_NAME,
        replyTo: config.SUPPORT_EMAIL,
      });
  }
}
