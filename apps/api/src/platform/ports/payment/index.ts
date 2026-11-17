// T121: the payment port's entry. Which adapter serves the port is `PAYMENT_GATEWAY` in the loaded
// configuration, never a code change (FR-056); `ports.module.ts` calls this once at startup, and
// nothing else names an adapter (R-API-4). A real gateway's member and its case are added by its
// Phase 2 adapter task (OPEN-11).
//
// The stand-in's webhook secret (note under T117): `PAYMENT_GATEWAY_WEBHOOK_SECRET` when it is set,
// so a developer can sign a test event by hand; otherwise derived from `ENCRYPTION_KEY` by HKDF under
// a label of its own, so no credential is needed (SC-005) and every process of one deployment
// verifies what another signed, which a random per-process secret would not. The stand-in is refused
// in production (T146), so the derived secret never guards a real payment.
//
// T012: the stand-in's hosted page lives on `API_PUBLIC_ORIGIN`, and its events are sent there.
// Unset, the stand-in answers an address nobody serves, as local storage keeps a relative link
// (T095). `standInCheckoutOf` hands the page the stand-in's order operations, and nothing for any
// other gateway, so `platform/web/stand-in-checkout.ts` mounts the page only with the stand-in.
//
// T056: `paymob` serves Paymob (`paymob.adapter.ts`) from its keys; every intention names the webhook
// on `PUBLIC_WEBHOOK_ORIGIN` as its callback address, and `SUPPORT_EMAIL` as its billing email (the
// platform's address, never a student's). The configuration refuses `paymob` without them (T056),
// and this entry refuses again, naming the key, so no caller can build it half-set.
import type { Config } from '../../config/config.module.js';
import { deriveStandInSecret } from '../inbound-event.js';
import { FakePaymentAdapter, type StandInCheckout } from './fake.adapter.js';
import type { PaymentPort } from './payment.port.js';
import { PaymobPaymentAdapter } from './paymob.adapter.js';

export {
  STAND_IN_ACTIONS,
  STAND_IN_CHECKOUT_PATH,
  type PayableOrder,
  type StandInAction,
  type StandInCheckout,
} from './fake.adapter.js';

export type PaymentConfig = Pick<
  Config,
  | 'PAYMENT_GATEWAY'
  // 003:T109: the payment mode, which decides what a checkout without a payee does (T101).
  | 'PAYMENT_MODE'
  | 'PAYMENT_GATEWAY_WEBHOOK_SECRET'
  | 'ENCRYPTION_KEY'
  | 'API_PUBLIC_ORIGIN'
  | 'PAYMENT_GATEWAY_SECRET_KEY'
  | 'PAYMENT_GATEWAY_PUBLIC_KEY'
  | 'PAYMENT_GATEWAY_INTEGRATION_ID'
  | 'PAYMENT_GATEWAY_SPLIT_INTEGRATION_ID'
  | 'PUBLIC_WEBHOOK_ORIGIN'
> &
  Partial<Pick<Config, 'SUPPORT_EMAIL'>>;

// The payments module's `PAYMENT_WEBHOOK_PATH` (T077), written out as the stand-in writes it: the
// kernel imports no module.
const WEBHOOK_PATH = '/webhooks/payment';

const STAND_IN_SECRET_LABEL = 'ijazah:payment-stand-in-webhook:v1';

/**
 * The secret the stand-in signs and verifies its events under, as above. Exported for
 * `scripts/dev/emit-recipient-event.ts` (T079), which signs what the API verifies without naming the
 * adapter or repeating the label.
 */
export function standInWebhookSecret(
  config: Pick<PaymentConfig, 'PAYMENT_GATEWAY_WEBHOOK_SECRET' | 'ENCRYPTION_KEY'>,
): string {
  return (
    config.PAYMENT_GATEWAY_WEBHOOK_SECRET ??
    deriveStandInSecret(config.ENCRYPTION_KEY, STAND_IN_SECRET_LABEL)
  );
}

/** 003:T101: where the gateway writes its one warn line of ids and a reason (the process's logger). */
export interface PaymentLog {
  warn(fields: object, message: string): void;
}

export function createPaymentPort(config: PaymentConfig, log?: PaymentLog): PaymentPort {
  switch (config.PAYMENT_GATEWAY) {
    case 'fake':
      return new FakePaymentAdapter({
        webhookSecret: standInWebhookSecret(config),
        ...(config.API_PUBLIC_ORIGIN === undefined ? {} : { origin: config.API_PUBLIC_ORIGIN }),
      });
    case 'paymob':
      return paymobFrom(config, log);
  }
}

function required<T>(value: T | undefined, key: keyof PaymentConfig): T {
  if (value === undefined) throw new Error(`PAYMENT_GATEWAY=paymob needs ${key}.`);
  return value;
}

function paymobFrom(config: PaymentConfig, log?: PaymentLog): PaymobPaymentAdapter {
  const origin = required(config.PUBLIC_WEBHOOK_ORIGIN, 'PUBLIC_WEBHOOK_ORIGIN');
  return new PaymobPaymentAdapter({
    // 003:T109, T101: the mode decides what a checkout without a payee, or a payee without a split
    // integration, does; the logger takes the one warn line of ids and a reason.
    mode: config.PAYMENT_MODE,
    ...(log === undefined ? {} : { log }),
    secretKey: required(config.PAYMENT_GATEWAY_SECRET_KEY, 'PAYMENT_GATEWAY_SECRET_KEY'),
    publicKey: required(config.PAYMENT_GATEWAY_PUBLIC_KEY, 'PAYMENT_GATEWAY_PUBLIC_KEY'),
    hmacSecret: required(config.PAYMENT_GATEWAY_WEBHOOK_SECRET, 'PAYMENT_GATEWAY_WEBHOOK_SECRET'),
    integrationId: required(
      config.PAYMENT_GATEWAY_INTEGRATION_ID,
      'PAYMENT_GATEWAY_INTEGRATION_ID',
    ),
    ...(config.PAYMENT_GATEWAY_SPLIT_INTEGRATION_ID === undefined
      ? {}
      : { splitIntegrationId: config.PAYMENT_GATEWAY_SPLIT_INTEGRATION_ID }),
    notificationUrl: new URL(WEBHOOK_PATH, origin).toString(),
    billingEmail: required(config.SUPPORT_EMAIL, 'SUPPORT_EMAIL'),
  });
}

/**
 * The stand-in's order operations for its hosted page (T012, R-213), when `payment` is the stand-in;
 * nothing for any other gateway, so the page is mounted only while `PAYMENT_GATEWAY=fake`. The page
 * names this entry, never the adapter (R-API-4).
 */
export function standInCheckoutOf(payment: PaymentPort): StandInCheckout | undefined {
  return payment instanceof FakePaymentAdapter ? payment : undefined;
}
