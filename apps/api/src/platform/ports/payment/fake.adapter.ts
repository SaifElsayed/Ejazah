// T117: the payment stand-in, selected by `PAYMENT_GATEWAY=fake` and refused in production (T146).
//
// Orders and recipients live in memory. The stand-in can produce a correctly signed and an
// incorrectly signed event for any order or recipient it created, so the signature guard (FR-074,
// T133) is exercised without a network: a body signed with HMAC-SHA256 under the webhook secret in
// the `x-fake-signature` header, or under a random secret for the incorrect one. Producing a
// correctly signed event is the gateway acting, so the order or recipient takes its new state; an
// incorrectly signed one changes nothing. Recording calls and induced failure are T122's.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { piasters, type Piasters } from '@ijazah/money';
import { z } from 'zod';
import {
  EventSignatureError,
  type CancelOutcome,
  type Checkout,
  type GatewayEvent,
  type PaymentPort,
  type PayoutDetails,
  type RecipientStatus,
} from './payment.port.js';

const SIGNATURE_HEADER = 'x-fake-signature';

type OrderEventType = 'paid' | 'failed' | 'expired' | 'refunded';
type RecipientEventType = 'recipient_verified' | 'recipient_rejected';

/** An inbound event as it arrives: the raw body and the headers that carry its signature. */
export interface SignedEvent {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string>>;
}

export interface EventOptions {
  /** `invalid` signs under a secret nobody holds. */
  readonly signature?: 'valid' | 'invalid';
}

export interface PaidEventOptions extends EventOptions {
  /** As the gateway would report them; by default no fee, and the whole gross settled. */
  readonly gateway_fee_piasters?: Piasters;
  readonly net_piasters?: Piasters;
}

interface Order {
  readonly gross_piasters: Piasters;
  readonly currency: string;
  status: 'created' | 'cancelled' | OrderEventType;
}

const amount = z.number().transform((value) => piasters(value));

const eventBody = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('paid'),
    order: z.string().min(1),
    transaction: z.string().min(1),
    gross_piasters: amount,
    gateway_fee_piasters: amount,
    net_piasters: amount,
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  z.object({
    id: z.string().min(1),
    type: z.enum(['failed', 'expired', 'refunded']),
    order: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.enum(['recipient_verified', 'recipient_rejected']),
    recipient: z.string().min(1),
  }),
]);

type EventBody = z.input<typeof eventBody>;

export class FakePaymentAdapter implements PaymentPort {
  readonly #webhookSecret: string;
  readonly #orders = new Map<string, Order>();
  readonly #recipients = new Map<string, RecipientStatus>();

  constructor(options: { readonly webhookSecret: string }) {
    this.#webhookSecret = options.webhookSecret;
  }

  createCheckout(
    _enrollmentId: string,
    gross_piasters: Piasters,
    currency: string,
    _latestExpiry: Date,
  ): Promise<Checkout> {
    if (!/^[A-Z]{3}$/.test(currency)) {
      return Promise.reject(new RangeError('A currency is three capital letters (ISO 4217).'));
    }
    const gatewayOrderId = `fake_ord_${randomUUID()}`;
    this.#orders.set(gatewayOrderId, { gross_piasters, currency, status: 'created' });
    return Promise.resolve({
      gatewayOrderId,
      checkoutUrl: `https://checkout.fake.invalid/${gatewayOrderId}`,
    });
  }

  cancelCheckout(gatewayOrderId: string): Promise<CancelOutcome> {
    const order = this.#orders.get(gatewayOrderId);
    if (order === undefined) return Promise.reject(new Error('unknown order: the stand-in did not create it.'));
    if (order.status === 'paid' || order.status === 'refunded') return Promise.resolve('paid');
    order.status = order.status === 'created' ? 'cancelled' : order.status;
    return Promise.resolve('cancelled');
  }

  verifyAndParseEvent(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<GatewayEvent> {
    const signature = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === SIGNATURE_HEADER,
    )?.[1];
    const expected = Buffer.from(sign(this.#webhookSecret, rawBody), 'hex');
    const given = Buffer.from(signature ?? '', 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return Promise.reject(new EventSignatureError());
    }
    const body = eventBody.parse(JSON.parse(rawBody.toString('utf8')));
    switch (body.type) {
      case 'paid':
        return Promise.resolve({
          type: body.type,
          providerEventId: body.id,
          gatewayOrderId: body.order,
          gatewayTransactionId: body.transaction,
          gross_piasters: body.gross_piasters,
          gateway_fee_piasters: body.gateway_fee_piasters,
          net_piasters: body.net_piasters,
          currency: body.currency,
        });
      case 'failed':
      case 'expired':
      case 'refunded':
        return Promise.resolve({
          type: body.type,
          providerEventId: body.id,
          gatewayOrderId: body.order,
        });
      case 'recipient_verified':
      case 'recipient_rejected':
        return Promise.resolve({
          type: body.type,
          providerEventId: body.id,
          recipientRef: body.recipient,
        });
    }
  }

  registerPayoutRecipient(_teacherUserId: string, _details: PayoutDetails): Promise<string> {
    const recipientRef = `fake_rcp_${randomUUID()}`;
    this.#recipients.set(recipientRef, 'pending');
    return Promise.resolve(recipientRef);
  }

  getRecipientStatus(recipientRef: string): Promise<RecipientStatus> {
    const status = this.#recipients.get(recipientRef);
    if (status === undefined) {
      return Promise.reject(new Error('unknown recipient: the stand-in did not register it.'));
    }
    return Promise.resolve(status);
  }

  /** The gateway reporting on an order this stand-in created. */
  orderEvent(
    gatewayOrderId: string,
    type: OrderEventType,
    options: PaidEventOptions = {},
  ): SignedEvent {
    const order = this.#orders.get(gatewayOrderId);
    if (order === undefined) throw new Error('unknown order: the stand-in did not create it.');
    const id = `fake_evt_${randomUUID()}`;
    const body: EventBody =
      type === 'paid'
        ? {
            id,
            type,
            order: gatewayOrderId,
            transaction: `fake_txn_${randomUUID()}`,
            gross_piasters: order.gross_piasters,
            gateway_fee_piasters: options.gateway_fee_piasters ?? piasters(0),
            net_piasters: options.net_piasters ?? order.gross_piasters,
            currency: order.currency,
          }
        : { id, type, order: gatewayOrderId };
    if (options.signature !== 'invalid') order.status = type;
    return this.#signed(body, options);
  }

  /** The gateway reporting on a payout recipient this stand-in registered. */
  recipientEvent(
    recipientRef: string,
    type: RecipientEventType,
    options: EventOptions = {},
  ): SignedEvent {
    if (!this.#recipients.has(recipientRef)) {
      throw new Error('unknown recipient: the stand-in did not register it.');
    }
    const body: EventBody = { id: `fake_evt_${randomUUID()}`, type, recipient: recipientRef };
    if (options.signature !== 'invalid') {
      this.#recipients.set(recipientRef, type === 'recipient_verified' ? 'verified' : 'rejected');
    }
    return this.#signed(body, options);
  }

  #signed(body: EventBody, options: EventOptions): SignedEvent {
    const rawBody = Buffer.from(JSON.stringify(body));
    const secret =
      options.signature === 'invalid' ? randomBytes(32).toString('hex') : this.#webhookSecret;
    return { rawBody, headers: { [SIGNATURE_HEADER]: sign(secret, rawBody) } };
  }
}

function sign(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}
