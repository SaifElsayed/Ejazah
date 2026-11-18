// T117: the payment stand-in, selected by `PAYMENT_GATEWAY=fake` and refused in production (T146).
//
// Orders and recipients live in memory. The stand-in can produce a correctly signed and an
// incorrectly signed event for any order or recipient it created, so the signature guard (FR-074,
// T133) is exercised without a network: a body signed with HMAC-SHA256 under the webhook secret in
// the `x-fake-signature` header, or under a random secret for the incorrect one. Producing a
// correctly signed event is the gateway acting, so the order or recipient takes its new state; an
// incorrectly signed one changes nothing. T122: it records each operation it was asked to do and
// fails one when told, before anything changes; a signed body it cannot read is a rejection with
// `MalformedEventError`, never a synchronous throw, and quotes nothing of the body (review of
// PR #45, m1; R-SEC-2).
//
// T012: a gateway at the boundary (R-213, FR-372, FR-374). An order has a hosted page on the API's
// public origin (`API_PUBLIC_ORIGIN`), `/stand-in/checkout/<order>`, which `platform/web/
// stand-in-checkout.ts` serves while this stand-in is the port, and an expiry, `latestExpiry` as
// given, since the stand-in lets it be set (ADR 0010 D4). What the page's buttons do is `submit`: it
// signs `paid` (a transaction id, the gross, a fee of 0 and the whole gross as net, as reported),
// `failed`, or `failed` for a cancellation, under the same secret `verifyAndParseEvent` checks, and
// POSTs it over HTTP to `/webhooks/payment` on the same origin, so it passes the webhook's raw-body
// check and persistence as a real gateway's event would. An order acted on, cancelled or past its
// expiry is no longer payable, so the page cannot send a second event for it. `onCancel` sets what
// `cancelCheckout` answers for one order, so FR-BOOK-12's branches are reachable.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { piasters, type Piasters } from '@ijazah/money';
import { z } from 'zod';
import { StandIn } from '../stand-in.js';
import {
  EventSignatureError,
  MalformedEventError,
  type CancelOutcome,
  type Checkout,
  type CheckoutPayee,
  type GatewayEvent,
  type PaymentPort,
  type PayoutDetails,
  type RecipientStatus,
} from './payment.port.js';

const SIGNATURE_HEADER = 'x-fake-signature';

/** Where the hosted page of an order lives, under the API's public origin (contracts/gateway.md). */
export const STAND_IN_CHECKOUT_PATH = '/stand-in/checkout';

// The payments module's `PAYMENT_WEBHOOK_PATH` (T077), written out: the kernel imports no module.
const WEBHOOK_PATH = '/webhooks/payment';

/** How long the page waits for the webhook's answer before it gives up. */
const DELIVERY_TIMEOUT_MS = 10_000;

// 003:T102 (DEC-82): `refund_reported` is a refund flagged on the original payment, with no amount.
type OrderEventType = 'paid' | 'failed' | 'expired' | 'refunded' | 'refund_reported';

/** The hosted page's three buttons: «ادفع», «فشل الدفع», «إلغاء». */
export const STAND_IN_ACTIONS = ['pay', 'fail', 'cancel'] as const;

export type StandInAction = (typeof STAND_IN_ACTIONS)[number];

/** The event each button sends; a cancellation is reported as a failed payment (R-213). */
const EVENT_OF: Readonly<Record<StandInAction, OrderEventType>> = {
  pay: 'paid',
  fail: 'failed',
  cancel: 'failed',
};

/** What the hosted page shows of an order it can still take payment for. */
export interface PayableOrder {
  readonly gatewayOrderId: string;
  readonly amount_piasters: Piasters;
  readonly currency: string;
  readonly expiresAt: Date;
}

/** The hosted page's view of the stand-in: an order's state, and its buttons. */
export interface StandInCheckout {
  /** The order while it is created and before its expiry; nothing otherwise. */
  payableOrder(gatewayOrderId: string): PayableOrder | undefined;
  /**
   * Sends the action's signed event to the webhook. `not_payable`, sending nothing, unless the order
   * is payable; rejects with `StandInDeliveryError` when the webhook does not answer 2xx.
   */
  submit(gatewayOrderId: string, action: StandInAction): Promise<'delivered' | 'not_payable'>;
}

/** The webhook did not take the event. Carries the status alone, never the event (R-SEC-2). */
export class StandInDeliveryError extends Error {
  constructor(status: number | 'unreachable', options?: ErrorOptions) {
    super(`The stand-in's event was not taken by the webhook: ${status}.`, options);
    this.name = 'StandInDeliveryError';
  }
}
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

export interface RecipientEventOptions extends EventOptions {
  /** The gateway's reason on a rejection; none by default. */
  readonly reason?: string;
}

export interface PaidEventOptions extends EventOptions {
  /**
   * As the gateway would report them; by default no fee, and the whole gross settled. Null reports
   * none, as a gateway whose event carries neither does (T056).
   */
  readonly gateway_fee_piasters?: Piasters | null;
  readonly net_piasters?: Piasters | null;
}

export interface OrderEventOptions extends PaidEventOptions {
  /**
   * 003:T102 (DEC-82): a refunded event's amount, as a refund child reports it; `whole_order` as a
   * void reports it. The order's whole amount by default.
   */
  readonly refunded_piasters?: Piasters | 'whole_order';
}

interface Order {
  readonly gross_piasters: Piasters;
  readonly currency: string;
  readonly expiresAt: Date;
  status: 'created' | 'cancelled' | OrderEventType;
  /** What `cancelCheckout` answers for this order, when a test set it (`onCancel`). */
  cancelOutcome?: CancelOutcome;
}

const amount = z.number().transform((value) => piasters(value));
const reportedAmount = amount.nullable();

const eventBody = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('paid'),
    order: z.string().min(1),
    transaction: z.string().min(1),
    gross_piasters: amount,
    gateway_fee_piasters: reportedAmount,
    net_piasters: reportedAmount,
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  z.object({
    id: z.string().min(1),
    type: z.enum(['failed', 'expired', 'refund_reported']),
    order: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('refunded'),
    order: z.string().min(1),
    refunded_piasters: z.union([amount, z.literal('whole_order')]),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('recipient_verified'),
    recipient: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('recipient_rejected'),
    recipient: z.string().min(1),
    reason: z.string().min(1).optional(),
  }),
]);

type EventBody = z.input<typeof eventBody>;

export interface FakePaymentOptions {
  readonly webhookSecret: string;
  /**
   * `API_PUBLIC_ORIGIN`: where the hosted page lives and where its events are sent. Absent, an
   * order's page is an address nobody serves and the page sends nothing.
   */
  readonly origin?: string;
  readonly now?: () => Date;
}

export class FakePaymentAdapter
  extends StandIn<PaymentPort>
  implements PaymentPort, StandInCheckout
{
  readonly #webhookSecret: string;
  readonly #origin: string | undefined;
  readonly #now: () => Date;
  readonly #orders = new Map<string, Order>();
  readonly #recipients = new Map<string, RecipientStatus>();

  constructor(options: FakePaymentOptions) {
    super();
    this.#webhookSecret = options.webhookSecret;
    this.#origin = options.origin;
    this.#now = options.now ?? (() => new Date());
  }

  createCheckout(
    enrollmentId: string,
    gross_piasters: Piasters,
    currency: string,
    latestExpiry: Date,
    payee?: CheckoutPayee,
  ): Promise<Checkout> {
    // T104: the payee and the teacher's share it carries are recorded as they were given, so a
    // spec reads what the split would send; the stand-in settles nothing.
    const failure =
      payee === undefined
        ? this.attempt('createCheckout', [enrollmentId, gross_piasters, currency, latestExpiry])
        : this.attempt('createCheckout', [enrollmentId, gross_piasters, currency, latestExpiry, payee]);
    if (failure !== undefined) return Promise.reject(failure);
    if (!/^[A-Z]{3}$/.test(currency)) {
      return Promise.reject(new RangeError('A currency is three capital letters (ISO 4217).'));
    }
    const gatewayOrderId = `fake_ord_${randomUUID()}`;
    this.#orders.set(gatewayOrderId, {
      gross_piasters,
      currency,
      expiresAt: latestExpiry,
      status: 'created',
    });
    const checkoutUrl =
      this.#origin === undefined
        ? `https://checkout.fake.invalid/${gatewayOrderId}`
        : new URL(`${STAND_IN_CHECKOUT_PATH}/${gatewayOrderId}`, this.#origin).toString();
    return Promise.resolve({ gatewayOrderId, checkoutUrl, expiresAt: latestExpiry });
  }

  cancelCheckout(gatewayOrderId: string): Promise<CancelOutcome> {
    const failure = this.attempt('cancelCheckout', [gatewayOrderId]);
    if (failure !== undefined) return Promise.reject(failure);
    const order = this.#orders.get(gatewayOrderId);
    if (order === undefined)
      return Promise.reject(new Error('unknown order: the stand-in did not create it.'));
    const outcome =
      order.cancelOutcome ??
      (order.status === 'paid' || order.status === 'refunded' ? 'paid' : 'cancelled');
    if (outcome === 'cancelled' && order.status === 'created') order.status = 'cancelled';
    return Promise.resolve(outcome);
  }

  /** What `cancelCheckout` answers for this order from now on (R-213, FR-BOOK-12). */
  onCancel(gatewayOrderId: string, outcome: CancelOutcome): void {
    const order = this.#orders.get(gatewayOrderId);
    if (order === undefined) throw new Error('unknown order: the stand-in did not create it.');
    order.cancelOutcome = outcome;
  }

  payableOrder(gatewayOrderId: string): PayableOrder | undefined {
    const order = this.#orders.get(gatewayOrderId);
    if (order?.status !== 'created' || this.#now() >= order.expiresAt) return undefined;
    return {
      gatewayOrderId,
      amount_piasters: order.gross_piasters,
      currency: order.currency,
      expiresAt: order.expiresAt,
    };
  }

  async submit(
    gatewayOrderId: string,
    action: StandInAction,
  ): Promise<'delivered' | 'not_payable'> {
    if (this.#origin === undefined) {
      throw new Error('The stand-in was given no origin (API_PUBLIC_ORIGIN) to send its event to.');
    }
    if (this.payableOrder(gatewayOrderId) === undefined) return 'not_payable';
    // Signed before the first await, so a second press of a button finds the order acted on.
    const { rawBody, headers } = this.orderEvent(gatewayOrderId, EVENT_OF[action]);
    let response: Response;
    try {
      response = await fetch(new URL(WEBHOOK_PATH, this.#origin), {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: rawBody,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new StandInDeliveryError('unreachable', { cause: error });
    }
    // The answer's body is the webhook's; nothing of it is needed.
    await response.body?.cancel();
    if (!response.ok) throw new StandInDeliveryError(response.status);
    return 'delivered';
  }

  verifyAndParseEvent(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<GatewayEvent> {
    const failure = this.attempt('verifyAndParseEvent', [rawBody, headers]);
    if (failure !== undefined) return Promise.reject(failure);
    const signature = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === SIGNATURE_HEADER,
    )?.[1];
    const expected = Buffer.from(sign(this.#webhookSecret, rawBody), 'hex');
    const given = Buffer.from(signature ?? '', 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return Promise.reject(new EventSignatureError());
    }
    let body: z.output<typeof eventBody>;
    try {
      body = eventBody.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      // The parser's message can quote the body; the refusal carries none of it (R-SEC-2).
      return Promise.reject(new MalformedEventError());
    }
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
      case 'refunded':
        return Promise.resolve({
          type: body.type,
          providerEventId: body.id,
          gatewayOrderId: body.order,
          refunded_piasters: body.refunded_piasters,
        });
      case 'failed':
      case 'expired':
      case 'refund_reported':
        return Promise.resolve({
          type: body.type,
          providerEventId: body.id,
          gatewayOrderId: body.order,
        });
      case 'recipient_verified':
        return Promise.resolve({
          type: body.type,
          providerEventId: body.id,
          recipientRef: body.recipient,
        });
      case 'recipient_rejected':
        return Promise.resolve({
          type: body.type,
          providerEventId: body.id,
          recipientRef: body.recipient,
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        });
    }
  }

  registerPayoutRecipient(teacherUserId: string, details: PayoutDetails): Promise<string> {
    const failure = this.attempt('registerPayoutRecipient', [teacherUserId, details]);
    if (failure !== undefined) return Promise.reject(failure);
    const recipientRef = `fake_rcp_${randomUUID()}`;
    this.#recipients.set(recipientRef, 'pending');
    return Promise.resolve(recipientRef);
  }

  getRecipientStatus(recipientRef: string): Promise<RecipientStatus> {
    const failure = this.attempt('getRecipientStatus', [recipientRef]);
    if (failure !== undefined) return Promise.reject(failure);
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
    options: OrderEventOptions = {},
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
            gateway_fee_piasters:
              options.gateway_fee_piasters === undefined
                ? piasters(0)
                : options.gateway_fee_piasters,
            net_piasters:
              options.net_piasters === undefined ? order.gross_piasters : options.net_piasters,
            currency: order.currency,
          }
        : type === 'refunded'
          ? {
              id,
              type,
              order: gatewayOrderId,
              refunded_piasters: options.refunded_piasters ?? order.gross_piasters,
            }
          : { id, type, order: gatewayOrderId };
    // A reported refund moves nothing (003:T102): the order keeps its state.
    if (options.signature !== 'invalid' && type !== 'refund_reported') order.status = type;
    return this.#signed(body, options);
  }

  /** The gateway reporting on a payout recipient this stand-in registered. */
  recipientEvent(
    recipientRef: string,
    type: RecipientEventType,
    options: RecipientEventOptions = {},
  ): SignedEvent {
    if (!this.#recipients.has(recipientRef)) {
      throw new Error('unknown recipient: the stand-in did not register it.');
    }
    const id = `fake_evt_${randomUUID()}`;
    const body: EventBody =
      type === 'recipient_rejected' && options.reason !== undefined
        ? { id, type, recipient: recipientRef, reason: options.reason }
        : { id, type, recipient: recipientRef };
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
