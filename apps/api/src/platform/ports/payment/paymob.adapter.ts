// T056 (FR-371, R-221): Paymob behind the payment port, selected by `PAYMENT_GATEWAY=paymob`. Built
// from Paymob's developer documentation (developers.paymob.com, 2026-11-04) and tried on its test
// account; what the test account does not offer is settled at contracting (OPEN-11).
//
// CHECKOUT. One intention per order (`POST /v1/intention/`, "Create Intention"), authorised by the
// secret key as `Authorization: Token <key>`: the gross on the card integration, the order's
// lifetime in whole seconds (`expiration`) and the webhook's address (`notification_url`). Paymob
// requires `billing_data`; the port carries nothing of the student (no data leaves for a third party
// that the checkout does not need). The email is the platform's own address (`SUPPORT_EMAIL`, as
// `billingEmail`), never the student's, as Paymob refuses "NA" there (its test account,
// 2026-11-04); the name and phone are Paymob's "NA". The order's id is Paymob's
// `intention_order_id`, the id its callbacks name under `obj.order.id`; the hosted page is the
// Unified Checkout under the public key and the intention's client secret, an address that carries a
// payment token and is stored encrypted only (R-DB-8). The expiry answered is the latest expiry's
// whole second, never after it (FR-355): Paymob counts its lifetime from when the request arrives,
// so its own expiry falls at most the request's travel after that, inside the hold's grace (ADR 0010
// D4). With a recipient named, the whole gross is split to the teacher's account
// (`split_amounts`, Paymob's "Split Features Implementation") on the auth integration: 0% commission
// (ADR 0007), no share computed here.
//
// THE CALLBACK. Paymob signs a processed callback ("HMAC Transaction Callback") with HMAC-SHA512 under
// the HMAC secret over twenty fields of the transaction, concatenated in a documented order, and
// appends the digest to the callback's query as `hmac`; the body is JSON. Only those twenty fields
// are trusted: the mapping reads nothing else, so a field outside the signature cannot steer it. The
// digests are compared in constant time. Every refusal is `EventSignatureError` (no or a wrong hmac,
// or a body from which the message cannot be built) or `MalformedEventError` (signed, but a state
// the port does not record), and neither carries the body or the digest (R-SEC-2). A signed pending
// or authorise-only transaction is `NonFinalEventError`: Paymob sends the final state in a callback
// of its own, so the webhook acknowledges it and records nothing (the owner's decision of
// 2026-11-04). The callback
// carries no fee and no net (`merchant_commission` is null on the documented sample), so a paid event
// reports neither: they are never computed here (R-MONEY-5). A transaction's id and the state read
// from it form the provider event id, so a callback Paymob sends again is a replay (R-MONEY-8).
//
// NOT OFFERED (OPEN-11): no documented call cancels an unpaid intention, so `cancelCheckout` answers
// `unsupported` (ADR 0010 D6, FR-BOOK-12 then waits for the order's expiry). A teacher's onboarding
// is Paymob's partner onboarding ("Register Merchant" with a phone, an email and documents, under a
// partner key), which the port's payout details do not carry; it is settled at contracting, so both
// recipient operations refuse.
//
// Every request has a timeout and is aborted when it passes (R-API rules: no outbound call without
// one). A refusal by the gateway carries its status alone, never its answer or the key.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { piasters, toPlainNumber, type Piasters } from '@ijazah/money';
import { addSeconds, unixSeconds } from '@ijazah/time';
import { z } from 'zod';
import {
  EventSignatureError,
  MalformedEventError,
  NonFinalEventError,
  type CancelOutcome,
  type Checkout,
  type CheckoutPayee,
  type GatewayEvent,
  type PaymentPort,
  type PayoutDetails,
  type RecipientStatus,
} from './payment.port.js';

/** Egypt's API host (Paymob's regional base URL; test and live share it, the keys decide the mode). */
const API_ORIGIN = 'https://accept.paymob.com';
const INTENTION_PATH = '/v1/intention/';
/** Egypt's Unified Checkout host. */
const CHECKOUT_ORIGIN = 'https://eg.checkout.paymob.com';

/** How long a request to Paymob waits before it is aborted. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** What the student buys, as the intention's item and the split's description name it. */
const ITEM_NAME = 'Package';
/** Paymob's word for a billing field the platform does not send. */
const NOT_GIVEN = 'NA';

const ONE_SECOND = 1;

/** Why a request to Paymob did not answer an order: its HTTP status, or what kept it from one. */
export type GatewayRequestStatus = number | 'timeout' | 'unreachable' | 'unreadable';

/** Paymob did not create what was asked. Carries the status alone (R-SEC-2). */
export class GatewayRequestError extends Error {
  constructor(
    readonly status: GatewayRequestStatus,
    options?: ErrorOptions,
  ) {
    super(`The payment gateway did not complete the request: ${String(status)}.`, options);
    this.name = 'GatewayRequestError';
  }
}

/** The documented order of the processed callback's HMAC fields, as paths into `obj`. */
const HMAC_FIELDS: readonly (readonly string[])[] = [
  ['amount_cents'],
  ['created_at'],
  ['currency'],
  ['error_occured'],
  ['has_parent_transaction'],
  ['id'],
  ['integration_id'],
  ['is_3d_secure'],
  ['is_auth'],
  ['is_capture'],
  ['is_refunded'],
  ['is_standalone_payment'],
  ['is_voided'],
  ['order', 'id'],
  ['owner'],
  ['pending'],
  ['source_data', 'pan'],
  ['source_data', 'sub_type'],
  ['source_data', 'type'],
  ['success'],
];

function fieldAt(obj: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = obj;
  for (const key of path) {
    value =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  return value;
}

/** A field as it enters the message: a boolean in lower case, a number as written, none as empty. */
function asMessagePart(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** The message Paymob signs for a processed callback's transaction (`obj`). */
export function paymobHmacMessage(obj: Record<string, unknown>): string {
  return HMAC_FIELDS.map((path) => asMessagePart(fieldAt(obj, path))).join('');
}

// The signed fields the mapping reads, and only those (the HMAC covers nothing else). The message
// has no separators, so a character could move across the boundary of two neighbouring fields and
// leave the digest as it was; each boundary the mapping depends on is closed by a shape a moved
// character breaks: the time must start as a timestamp (after the amount), the currency is three
// capitals, and the integration (after the transaction id) must be this adapter's. One boundary
// stays open here, the order id's and the owner's (a digit moved between them names a shorter
// order id); it is closed by the payments module, which refuses a paid event whose amount or
// currency is not its order's (T056, `order-events.service.ts`).
const signedTransaction = z.object({
  id: z.number().int(),
  amount_cents: z.number(),
  created_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  integration_id: z.number().int(),
  success: z.boolean(),
  pending: z.boolean(),
  is_auth: z.boolean(),
  is_capture: z.boolean(),
  is_refunded: z.boolean(),
  is_voided: z.boolean(),
  has_parent_transaction: z.boolean(),
  order: z.object({ id: z.number().int() }),
});

type SignedTransaction = z.infer<typeof signedTransaction>;

const callbackBody = z.object({ type: z.string(), obj: z.record(z.string(), z.unknown()) });

const intentionAnswer = z.object({
  client_secret: z.string().min(1),
  intention_order_id: z.number().int(),
});

export interface PaymobOptions {
  readonly secretKey: string;
  readonly publicKey: string;
  readonly hmacSecret: string;
  /** The card integration the intention is paid on. */
  readonly integrationId: number;
  /** The auth integration a split is paid on; without it, a split is refused. */
  readonly splitIntegrationId?: number;
  /** Where Paymob posts its processed callbacks: the webhook on `PUBLIC_WEBHOOK_ORIGIN`. */
  readonly notificationUrl: string;
  /** The billing email every intention carries: the platform's `SUPPORT_EMAIL`, never a student's. */
  readonly billingEmail: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export class PaymobPaymentAdapter implements PaymentPort {
  readonly #options: PaymobOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #timeoutMs: number;

  constructor(options: PaymobOptions) {
    this.#options = options;
    // Called as a plain function, never as a method of this adapter.
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? (() => new Date());
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async createCheckout(
    _enrollmentId: string,
    gross_piasters: Piasters,
    currency: string,
    latestExpiry: Date,
    payee?: CheckoutPayee,
  ): Promise<Checkout> {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new RangeError('A currency is three capital letters (ISO 4217).');
    }
    const now = this.#now();
    const lifetimeSeconds = unixSeconds(latestExpiry) - unixSeconds(now);
    if (lifetimeSeconds < ONE_SECOND) {
      throw new RangeError('The latest expiry leaves the order less than a second.');
    }
    const amount = toPlainNumber(gross_piasters);
    const answer = intentionAnswer.safeParse(
      await this.#post(INTENTION_PATH, {
        amount,
        currency,
        payment_methods: [this.#options.integrationId],
        items: [{ name: ITEM_NAME, amount, quantity: 1 }],
        billing_data: {
          first_name: NOT_GIVEN,
          last_name: NOT_GIVEN,
          email: this.#options.billingEmail,
          phone_number: NOT_GIVEN,
        },
        expiration: lifetimeSeconds,
        notification_url: this.#options.notificationUrl,
        ...this.#split(payee, amount),
      }),
    );
    if (!answer.success) throw new GatewayRequestError('unreadable');
    const checkoutUrl = new URL('/', CHECKOUT_ORIGIN);
    checkoutUrl.searchParams.set('publicKey', this.#options.publicKey);
    checkoutUrl.searchParams.set('clientSecret', answer.data.client_secret);
    return {
      gatewayOrderId: String(answer.data.intention_order_id),
      checkoutUrl: checkoutUrl.toString(),
      expiresAt: new Date(addSeconds(now, lifetimeSeconds)),
    };
  }

  cancelCheckout(_gatewayOrderId: string): Promise<CancelOutcome> {
    return Promise.resolve('unsupported');
  }

  verifyAndParseEvent(
    rawBody: Buffer,
    _headers: Readonly<Record<string, string | undefined>>,
    query: Readonly<Record<string, string | undefined>> = {},
  ): Promise<GatewayEvent> {
    try {
      return Promise.resolve(this.#verified(rawBody, query.hmac));
    } catch (error: unknown) {
      return Promise.reject(
        error instanceof MalformedEventError || error instanceof NonFinalEventError
          ? error
          : new EventSignatureError(),
      );
    }
  }

  registerPayoutRecipient(_teacherUserId: string, _details: PayoutDetails): Promise<string> {
    return Promise.reject(new Error(ONBOARDING_AT_CONTRACTING));
  }

  getRecipientStatus(_recipientRef: string): Promise<RecipientStatus> {
    return Promise.reject(new Error(ONBOARDING_AT_CONTRACTING));
  }

  /** The integrations this adapter's orders are paid on. */
  #integrations(): readonly number[] {
    const { integrationId, splitIntegrationId } = this.#options;
    return splitIntegrationId === undefined ? [integrationId] : [integrationId, splitIntegrationId];
  }

  #split(payee: CheckoutPayee | undefined, amount: number): Record<string, unknown> {
    if (payee === undefined) return {};
    const { splitIntegrationId } = this.#options;
    if (splitIntegrationId === undefined) {
      throw new Error('A split needs PAYMENT_GATEWAY_SPLIT_INTEGRATION_ID, which is not set.');
    }
    return {
      split_amounts: [{ mid: payee.recipientRef, amount_cents: amount, description: ITEM_NAME }],
      split_payment_methods: [splitIntegrationId],
    };
  }

  async #post(path: string, body: object): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(new URL(path, API_ORIGIN), {
        method: 'POST',
        headers: {
          authorization: `Token ${this.#options.secretKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error: unknown) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      throw new GatewayRequestError(timedOut ? 'timeout' : 'unreachable');
    }
    if (!response.ok) {
      // The answer may quote what was sent; nothing of it is kept.
      await response.body?.cancel();
      throw new GatewayRequestError(response.status);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new GatewayRequestError('unreadable');
    }
  }

  /** The event a callback reports, once its hmac holds; throws a refusal otherwise. */
  #verified(rawBody: Buffer, hmac: string | undefined): GatewayEvent {
    if (hmac === undefined || !/^[0-9a-fA-F]+$/.test(hmac)) throw new EventSignatureError();
    const body = callbackBody.parse(JSON.parse(rawBody.toString('utf8')));
    const expected = createHmac('sha512', this.#options.hmacSecret)
      .update(paymobHmacMessage(body.obj))
      .digest();
    const given = Buffer.from(hmac, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new EventSignatureError();
    }
    // Signed from here: what cannot be read is a body this port does not record.
    const transaction = signedTransaction.safeParse(body.obj);
    if (
      body.type !== 'TRANSACTION' ||
      !transaction.success ||
      !this.#integrations().includes(transaction.data.integration_id)
    ) {
      throw new MalformedEventError();
    }
    return eventOf(transaction.data);
  }
}

const ONBOARDING_AT_CONTRACTING =
  "Paymob's recipient onboarding is settled at contracting (OPEN-11); the test account does not offer it.";

/** The port's event for a signed transaction, read from its signed fields alone. */
function eventOf(transaction: SignedTransaction): GatewayEvent {
  const gatewayOrderId = String(transaction.order.id);
  const transactionId = String(transaction.id);
  const providerEventId = (type: GatewayEvent['type']): string => `paymob:${transactionId}:${type}`;
  if (transaction.pending) throw new NonFinalEventError();
  if (!transaction.success) {
    return { type: 'failed', providerEventId: providerEventId('failed'), gatewayOrderId };
  }
  const refunded = transaction.has_parent_transaction
    ? !transaction.is_capture
    : transaction.is_refunded || transaction.is_voided;
  if (refunded) {
    return { type: 'refunded', providerEventId: providerEventId('refunded'), gatewayOrderId };
  }
  // An authorisation alone has taken nothing yet; its capture is the payment.
  if (transaction.is_auth && !transaction.is_capture) throw new NonFinalEventError();
  let gross_piasters: Piasters;
  try {
    gross_piasters = piasters(transaction.amount_cents);
  } catch {
    throw new MalformedEventError();
  }
  return {
    type: 'paid',
    providerEventId: providerEventId('paid'),
    gatewayOrderId,
    gatewayTransactionId: transactionId,
    gross_piasters,
    gateway_fee_piasters: null,
    net_piasters: null,
    currency: transaction.currency,
  };
}
