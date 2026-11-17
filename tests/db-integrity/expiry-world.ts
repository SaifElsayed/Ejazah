// T040: what the expiry sweeps' specs share over the real tables, beside `confirmation-world.ts`'s
// worlds: the settings the sweeps and the confirm job read, the instant a sweep runs at, an order in
// any status, and the payment webhook as the application mounts it, listening on a local port with
// the stand-in's harness in front of it (SC-302), its `confirm-enrollment` queue the spec's own.
//
// THE SWEEP'S INSTANT. A paid event delivered through the webhook is recorded at the database's
// clock, today's, while the worlds' holds and orders are set around `NOW` (2026-11-03T08:00Z). A
// sweep runs a minute after the later of the two, so every world's hold and order has expired and
// every paid event is older than the confirmation timeout, whenever the suite runs.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { piasters } from '../../packages/money/src/index';
import { addSeconds } from '../../packages/time/src/index';
import {
  type ConfirmationQueue,
  createPaymentWebhookRoute,
  PAYMENT_WEBHOOK_PATH,
} from '../../apps/api/src/modules/payments/index';
import type { Database } from '../../apps/api/src/platform/db/prisma.repository';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import {
  createPaymentPort,
  type PaymentConfig,
} from '../../apps/api/src/platform/ports/payment/index';
import type { PaymentPort } from '../../apps/api/src/platform/ports/payment/payment.port';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { gatewayStandIn, type GatewayStandIn } from '../support/gateway-stand-in';
import { LATER, SETTINGS } from './confirmation-world';

/** The confirm job's settings and the sweep's timeout, `checkout_confirmation_timeout_seconds`. */
export const EXPIRY_SETTINGS: Record<string, number> = {
  ...SETTINGS,
  checkout_confirmation_timeout_seconds: 15,
};
export const expirySettings: SettingsReader = {
  read: async (key, schema) => schema.parse(EXPIRY_SETTINGS[key]),
};

/** A minute after the later of now and the worlds' latest expiry (this file's head). */
export function sweepInstant(): Date {
  const now = new Date();
  return new Date(addSeconds(now > LATER ? now : LATER, 60));
}

/** An hour after the sweep's instant: a hold still running when the sweep and the job run. */
export function farFuture(): Date {
  return new Date(addSeconds(sweepInstant(), 3600));
}

/**
 * A gateway order of the enrollment in `status`, expiring at `expiresAt`, written by SQL as
 * `confirmation-world.ts`' orders are (the amount column is named only in payments, R-MONEY-6),
 * with no event. Its id.
 */
export async function plainOrder(
  database: Database,
  enrollmentId: string,
  status: 'created' | 'failed',
  expiresAt: Date = LATER,
): Promise<string> {
  const [row] = await database.$queryRaw<{ id: string }[]>`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, updated_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, 100000, 'EGP',
            ${status}::payment_status, ${expiresAt}, now())
    RETURNING id::text AS id`;
  if (row === undefined) throw new Error('no order written');
  return row.id;
}

export interface Webhook {
  readonly stand: GatewayStandIn;
  readonly payment: PaymentPort;
  close(): Promise<void>;
}

/** The webhook listening on a local port, `confirmations` its `confirm-enrollment` queue. */
export async function listenWebhook(
  database: Database,
  confirmations: ConfirmationQueue,
): Promise<Webhook> {
  let route: ReturnType<typeof createPaymentWebhookRoute> | undefined;
  const server: Server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (route === undefined || !url.startsWith(PAYMENT_WEBHOOK_PATH)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    request.url = url.slice(PAYMENT_WEBHOOK_PATH.length) || '/';
    route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config: PaymentConfig = {
    PAYMENT_GATEWAY: 'fake',
    PAYMENT_MODE: 'test',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    API_PUBLIC_ORIGIN: origin,
  };
  const payment = createPaymentPort(config);
  route = createPaymentWebhookRoute({
    database,
    payment,
    log: createLogger({ level: 'error', destination: { write: () => undefined } }),
    maxBodyBytes: 1_048_576,
    confirmations,
    report: () => undefined,
  });
  return {
    stand: gatewayStandIn({ origin, config, payment }),
    payment,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A `created` order the stand-in made for the enrollment: its gateway id and its row's id. */
export async function plantOrder(
  webhook: Webhook,
  order: (enrollmentId: string, status: 'created', gatewayOrderId: string) => Promise<string>,
  enrollmentId: string,
): Promise<{ gatewayOrderId: string; paymentId: string }> {
  const { gatewayOrderId } = await webhook.payment.createCheckout(
    randomUUID(),
    piasters(100_000),
    'EGP',
    LATER,
  );
  return { gatewayOrderId, paymentId: await order(enrollmentId, 'created', gatewayOrderId) };
}
