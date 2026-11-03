// T013: the gateway stand-in's test harness (contracts/gateway.md "The test harness", R-213, FR-372,
// SC-302, SC-311), for specs and the development scripts, and nothing a request ever runs. It is
// the only way a spec produces a gateway event: it builds the event as the gateway would, signed
// under the stand-in's secret, and POSTs it over HTTP to the listening API's webhook, so every
// event passes the same raw-body check and the same persistence a real gateway's would. No spec
// hands an event to the webhook's service directly.
//
// WHY HERE. Its entry for the test tree and the scripts is `tests/support/gateway-stand-in.ts`,
// which binds it to the payments module's `PAYMENT_WEBHOOK_PATH`. The building lives in the payment
// port's folder because the specs of `apps/api/src` cannot import the test tree (the API's `rootDir`
// is `src`), because a paid event names the gateway's amounts, which only this folder and the
// payments module may (R-MONEY-6), and because only this folder may name the stand-in itself
// (R-API-4). The kernel imports no module, so the webhook's path is handed in by the caller.
//
// THE EVENTS. An order event (`paid`, `failed`, `expired`) is the stand-in's own `orderEvent` for an
// order it created through the port the API holds, so its amounts are the order's and the stand-in's
// state moves as the gateway's would (`cancelCheckout` answers `paid` once paid). A recipient event
// is built here for any reference, since the reference may have been registered by another process
// (`scripts/dev/emit-recipient-event.ts` reads it from the database). Every event carries a fresh
// provider event id unless the caller names one (the script's replay). `deliverAfter` runs the
// caller's hook (a hold expired or released) before it delivers (the note under T013, added by
// T039). `tamper` makes the three
// forgeries FR-372 names: a wrong secret, no signature, and a body changed after signing (here, the
// same event under a new provider id, so it would be recorded anew were the signature not checked).
//
// Nothing here logs: the secret, the signatures and the bodies stay in the caller's hands (R-SEC-2).
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { FakePaymentAdapter, type PaidEventOptions, type SignedEvent } from './fake.adapter.js';
import { type PaymentConfig, standInWebhookSecret } from './index.js';
import type { CancelOutcome, PaymentPort } from './payment.port.js';

/** The stand-in's signature header (note under T117). */
const SIGNATURE_HEADER = 'x-fake-signature';

/** How long a delivery waits for the webhook's answer. */
const DELIVERY_TIMEOUT_MS = 10_000;

/** The forged variants of FR-372, in the contract's order. */
export const FORGERIES = ['wrong_secret', 'no_signature', 'body_changed'] as const;

export type Forgery = (typeof FORGERIES)[number];

/** An event as the gateway sends it, with the provider event id its body carries. */
export interface StandInEvent extends SignedEvent {
  readonly providerEventId: string;
}

/** What the gateway reports on a paid event; by default no fee and the whole gross settled. */
export type ReportedAmounts = Omit<PaidEventOptions, 'signature'>;

/** A provider event id the caller decides, so the same command twice is a replay. */
export interface EventIdOption {
  readonly eventId?: string;
}

export interface GatewayStandIn {
  paid(gatewayOrderId: string, reported?: ReportedAmounts): StandInEvent;
  failed(gatewayOrderId: string): StandInEvent;
  expired(gatewayOrderId: string): StandInEvent;
  recipientVerified(recipientRef: string, options?: EventIdOption): StandInEvent;
  recipientRejected(recipientRef: string, reason?: string, options?: EventIdOption): StandInEvent;
  /** POSTs the event to the webhook; the status it answered. */
  deliver(event: StandInEvent): Promise<number>;
  /** The same body and id twice, one after the other. */
  deliverTwice(event: StandInEvent): Promise<readonly [number, number]>;
  /** One after the other, in the order given, whatever order they were built in. */
  deliverInOrder(events: readonly StandInEvent[]): Promise<number[]>;
  /**
   * Runs `hook` first (a hold expired or released, R-213), then POSTs the event; the status it
   * answered (the note under T013).
   */
  deliverAfter(event: StandInEvent, hook: () => Promise<unknown>): Promise<number>;
  /** A forged variant of the event. */
  tamper(event: StandInEvent, how: Forgery): StandInEvent;
  /** What the stand-in's `cancelCheckout` answers for that order from now on. */
  onCancel(gatewayOrderId: string, outcome: CancelOutcome): void;
}

export interface GatewayStandInOptions {
  /** The listening API's origin. */
  readonly origin: string;
  /** Where on it the webhook listens: the payments module's `PAYMENT_WEBHOOK_PATH`. */
  readonly webhookPath: string;
  /** The configuration the API's payment port was built from: the secret is derived from it. */
  readonly config: Pick<PaymentConfig, 'PAYMENT_GATEWAY_WEBHOOK_SECRET' | 'ENCRYPTION_KEY'>;
  /** The payment port the API holds, the stand-in; needed only for order events and `onCancel`. */
  readonly payment?: PaymentPort;
  readonly fetch?: typeof fetch;
}

export function createGatewayStandIn({
  origin,
  webhookPath,
  config,
  payment,
  fetch: send = fetch,
}: GatewayStandInOptions): GatewayStandIn {
  const secret = standInWebhookSecret(config);
  const webhook = new URL(webhookPath, origin);

  const standIn = (): FakePaymentAdapter => {
    if (payment instanceof FakePaymentAdapter) return payment;
    throw new Error('Order events and onCancel need the API’s payment port to be the stand-in.');
  };

  const orderEvent = (
    gatewayOrderId: string,
    type: 'paid' | 'failed' | 'expired',
    reported: ReportedAmounts = {},
  ): StandInEvent => withId(standIn().orderEvent(gatewayOrderId, type, reported));

  const recipientEvent = (body: RecipientBody): StandInEvent =>
    withId(signed(secret, Buffer.from(JSON.stringify(body))));

  const deliver = async ({ rawBody, headers }: StandInEvent): Promise<number> => {
    const response = await send(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: new Uint8Array(rawBody),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    // The answer's body is the webhook's; nothing of it is needed.
    await response.body?.cancel();
    return response.status;
  };

  return {
    paid: (gatewayOrderId, reported) => orderEvent(gatewayOrderId, 'paid', reported),
    failed: (gatewayOrderId) => orderEvent(gatewayOrderId, 'failed'),
    expired: (gatewayOrderId) => orderEvent(gatewayOrderId, 'expired'),
    recipientVerified: (recipientRef, options = {}) =>
      recipientEvent({
        id: options.eventId ?? freshEventId(),
        type: 'recipient_verified',
        recipient: recipientRef,
      }),
    recipientRejected: (recipientRef, reason, options = {}) =>
      recipientEvent({
        id: options.eventId ?? freshEventId(),
        type: 'recipient_rejected',
        recipient: recipientRef,
        ...(reason === undefined ? {} : { reason }),
      }),
    deliver,
    deliverTwice: async (event) => {
      const first = await deliver(event);
      return [first, await deliver(event)];
    },
    deliverInOrder: async (events) => {
      const statuses: number[] = [];
      for (const event of events) statuses.push(await deliver(event));
      return statuses;
    },
    deliverAfter: async (event, hook) => {
      await hook();
      return deliver(event);
    },
    tamper: (event, how) => tampered(event, how),
    onCancel: (gatewayOrderId, outcome) => standIn().onCancel(gatewayOrderId, outcome),
  };
}

/** The stand-in's recipient event body (note under T117). */
interface RecipientBody {
  readonly id: string;
  readonly type: 'recipient_verified' | 'recipient_rejected';
  readonly recipient: string;
  readonly reason?: string;
}

function freshEventId(): string {
  return `fake_evt_${randomUUID()}`;
}

function sign(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function signed(secret: string, rawBody: Buffer): SignedEvent {
  return { rawBody, headers: { [SIGNATURE_HEADER]: sign(secret, rawBody) } };
}

function idIn(rawBody: Buffer): string {
  const { id } = JSON.parse(rawBody.toString('utf8')) as { id?: unknown };
  if (typeof id !== 'string') throw new Error('The stand-in’s event carries no provider event id.');
  return id;
}

function withId(event: SignedEvent): StandInEvent {
  return { ...event, providerEventId: idIn(event.rawBody) };
}

function tampered(event: StandInEvent, how: Forgery): StandInEvent {
  switch (how) {
    case 'wrong_secret':
      return {
        ...signed(randomBytes(32).toString('hex'), event.rawBody),
        providerEventId: event.providerEventId,
      };
    case 'no_signature':
      return {
        rawBody: event.rawBody,
        headers: Object.fromEntries(
          Object.entries(event.headers).filter(([name]) => name.toLowerCase() !== SIGNATURE_HEADER),
        ),
        providerEventId: event.providerEventId,
      };
    case 'body_changed': {
      const body = JSON.parse(event.rawBody.toString('utf8')) as Record<string, unknown>;
      const providerEventId = freshEventId();
      return {
        rawBody: Buffer.from(JSON.stringify({ ...body, id: providerEventId })),
        headers: event.headers,
        providerEventId,
      };
    }
  }
}
