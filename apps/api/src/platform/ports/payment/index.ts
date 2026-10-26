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
import type { Config } from '../../config/config.module.js';
import { deriveStandInSecret } from '../inbound-event.js';
import { FakePaymentAdapter } from './fake.adapter.js';
import type { PaymentPort } from './payment.port.js';

export type PaymentConfig = Pick<
  Config,
  'PAYMENT_GATEWAY' | 'PAYMENT_GATEWAY_WEBHOOK_SECRET' | 'ENCRYPTION_KEY'
>;

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

export function createPaymentPort(config: PaymentConfig): PaymentPort {
  switch (config.PAYMENT_GATEWAY) {
    case 'fake':
      return new FakePaymentAdapter({ webhookSecret: standInWebhookSecret(config) });
  }
}
