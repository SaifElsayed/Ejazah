// T121: provider selection, once, at startup, from the loaded configuration (FR-056). Each port
// folder's entry picks its adapter from one configuration value (`STORAGE_DRIVER`,
// `PAYMENT_GATEWAY`, `SMS_PROVIDER`, `VIDEO_PROVIDER`, `PUSH_PROVIDER`, and since Phase 1
// `SIGN_IN_PROVIDER` and `EMAIL_PROVIDER`, T022 and T023), so switching provider is configuration
// and never a code change. What a caller receives is typed as the port and nothing
// else: no calling module can see, and so none can branch on, which provider is active (R-API-4).
// This file names each folder's entry, never an adapter: `boundaries/no-adapter-import` lets only a
// port's own folder name its adapters.
//
// A plain module, like `config.module.ts`: the worker is not a Nest application (note under T112),
// and both entrypoints call these functions after `loadConfigOrExit`. No module receives a port yet;
// each is handed its ports by the entrypoint, or bound to a token in the application's container,
// when its first consumer arrives, as the settings reader was (note under T113).
//
// Push is selected apart. Only the queued notification job may reach it (R-API-15, FR-057), so the
// request process never holds it: `main.ts` calls `selectPorts` only, and `worker.ts` also calls
// `selectPushPort` for the delivery job. This file is the one outside `push/` that
// `api/no-push-outside-job` lets name that folder (note under T042).
//
// Each call builds new adapters, and nothing is held at module scope, so no state is shared between
// processes or callers.
import { createEmailPort, type EmailConfig } from './email/index.js';
import type { EmailPort } from './email/email.port.js';
import { createPaymentPort, type PaymentConfig, type PaymentLog } from './payment/index.js';
import type { PaymentPort } from './payment/payment.port.js';
import { createPushPort, type PushConfig } from './push/index.js';
import type { PushPort } from './push/push.port.js';
import { createSignInPort, type SignInConfig } from './sign-in/index.js';
import type { SignInPort } from './sign-in/sign-in.port.js';
import { createSmsPort, type SmsConfig } from './sms/index.js';
import type { SmsPort } from './sms/sms.port.js';
import { createStoragePort, type StorageConfig } from './storage/index.js';
import type { StoragePort } from './storage/storage.port.js';
import { createVideoPort, type VideoConfig } from './video/index.js';
import type { VideoPort } from './video/video.port.js';

export type PortsConfig = StorageConfig &
  PaymentConfig &
  SmsConfig &
  VideoConfig &
  SignInConfig &
  EmailConfig;

/** The ports a process may hold. Push is not among them (R-API-15). */
export interface Ports {
  readonly storage: StoragePort;
  readonly payment: PaymentPort;
  readonly sms: SmsPort;
  readonly video: VideoPort;
  /** Phase 1 (T022): provider sign-in, the identity module's. */
  readonly signIn: SignInPort;
  /** Phase 1 (T023): one-time codes, the deletion confirmation, the administrator invite. */
  readonly email: EmailPort;
}

/** 003:T101: `log` takes the payment gateway's one warn line of ids and a reason. */
export function selectPorts(config: PortsConfig, log?: PaymentLog): Ports {
  return {
    storage: createStoragePort(config),
    payment: createPaymentPort(config, log),
    sms: createSmsPort(config),
    video: createVideoPort(config),
    signIn: createSignInPort(config),
    email: createEmailPort(config),
  };
}

/** The push port, for the worker's notification delivery job only (R-API-15). */
export function selectPushPort(config: PushConfig): PushPort {
  return createPushPort(config);
}
