// T056 (FR-371, R-221): the Paymob adapter behind the payment port, with no network. Every request is
// answered by a recording `fetch`, and every callback is built by hand from the shape Paymob's
// documentation gives ("HMAC Transaction Callback"), signed here under a placeholder secret. No value
// below is a real key (R-SEC-1).
import { createHmac } from 'node:crypto';
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';
import { EventSignatureError, MalformedEventError, NonFinalEventError } from './payment.port.js';
import { GatewayRequestError, PaymobPaymentAdapter, paymobHmacMessage } from './paymob.adapter.js';

const SECRET_KEY = 'egy_sk_test_placeholder';
const PUBLIC_KEY = 'egy_pk_test_placeholder';
const HMAC_SECRET = 'hmac-secret-placeholder';
const INTEGRATION_ID = 1_000_001;
const SPLIT_INTEGRATION_ID = 1_000_002;
const NOTIFICATION_URL = 'https://tunnel.example.com/webhooks/payment';
const NOW = new Date('2026-11-04T10:00:00.400Z');
const PAY_BY = new Date('2026-11-04T10:15:00.900Z');

interface Recorded {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** A `fetch` that records each request and answers `answer`. */
function recordingFetch(answer: () => Promise<Response>): {
  fetch: typeof fetch;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  const fetchDouble = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body,
    });
    return answer();
  }) as typeof fetch;
  return { fetch: fetchDouble, requests };
}

const intentionAnswer = (): Promise<Response> =>
  Promise.resolve(
    Response.json(
      {
        id: 'pi_test_placeholder',
        client_secret: 'egy_csk_test_placeholder',
        intention_order_id: 217_503_754,
        status: 'intended',
      },
      { status: 201 },
    ),
  );

function adapter(
  options: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    splitIntegrationId?: number;
  } = {},
): PaymobPaymentAdapter {
  return new PaymobPaymentAdapter({
    secretKey: SECRET_KEY,
    publicKey: PUBLIC_KEY,
    hmacSecret: HMAC_SECRET,
    integrationId: INTEGRATION_ID,
    notificationUrl: NOTIFICATION_URL,
    now: () => NOW,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.splitIntegrationId === undefined
      ? {}
      : { splitIntegrationId: options.splitIntegrationId }),
  });
}

// The documented sample's transaction, trimmed to what the callback's HMAC and the mapping read plus
// a few fields the HMAC does not cover.
type Transaction = Record<string, unknown> & {
  order: Record<string, unknown>;
  source_data: Record<string, unknown>;
};

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 192_036_465,
    pending: false,
    amount_cents: 100_000,
    success: true,
    is_auth: false,
    is_capture: false,
    is_standalone_payment: true,
    is_voided: false,
    is_refunded: false,
    is_3d_secure: true,
    integration_id: INTEGRATION_ID,
    profile_id: 164_295,
    has_parent_transaction: false,
    order: { id: 217_503_754, amount_cents: 100_000, currency: 'EGP', paid_amount_cents: 100_000 },
    created_at: '2024-06-13T11:33:44.592345',
    currency: 'EGP',
    source_data: { pan: '2346', type: 'card', sub_type: 'MasterCard', tenure: null },
    error_occured: false,
    is_live: false,
    owner: 302_852,
    merchant_commission: null,
    ...overrides,
  };
}

/** Paymob's processed callback: the body, and the `hmac` it appends to the callback's query. */
function callback(
  obj: Transaction,
  secret = HMAC_SECRET,
): { rawBody: Buffer; query: Record<string, string> } {
  const rawBody = Buffer.from(JSON.stringify({ type: 'TRANSACTION', obj, issuer_bank: null }));
  const hmac = createHmac('sha512', secret).update(paymobHmacMessage(obj)).digest('hex');
  return { rawBody, query: { hmac } };
}

describe('the callback HMAC message (Paymob, "HMAC Transaction Callback")', () => {
  it('concatenates the twenty documented fields in their documented order, booleans in lower case', () => {
    // The documentation's own sample string, value by value.
    expect(paymobHmacMessage(transaction({ integration_id: 4_097_558 }))).toBe(
      [
        '100000',
        '2024-06-13T11:33:44.592345',
        'EGP',
        'false',
        'false',
        '192036465',
        '4097558',
        'true',
        'false',
        'false',
        'false',
        'true',
        'false',
        '217503754',
        '302852',
        'false',
        '2346',
        'MasterCard',
        'card',
        'true',
      ].join(''),
    );
  });
});

describe('verifying a callback (FR-372, R-MONEY-9)', () => {
  it('takes a callback whose hmac holds, and reads a paid order as reported, no fee or net reported', async () => {
    const { rawBody, query } = callback(transaction());

    await expect(adapter().verifyAndParseEvent(rawBody, {}, query)).resolves.toEqual({
      type: 'paid',
      providerEventId: 'paymob:192036465:paid',
      gatewayOrderId: '217503754',
      gatewayTransactionId: '192036465',
      gross_piasters: piasters(100_000),
      gateway_fee_piasters: null,
      net_piasters: null,
      currency: 'EGP',
    });
  });

  it('takes the hmac in upper case as Paymob may send hex', async () => {
    const { rawBody, query } = callback(transaction());

    await expect(
      adapter().verifyAndParseEvent(rawBody, {}, { hmac: (query.hmac ?? '').toUpperCase() }),
    ).resolves.toMatchObject({ type: 'paid' });
  });

  it('refuses a callback with no hmac, in the query or anywhere else', async () => {
    const { rawBody, query } = callback(transaction());

    await expect(adapter().verifyAndParseEvent(rawBody, {})).rejects.toThrow(EventSignatureError);
    await expect(adapter().verifyAndParseEvent(rawBody, query, {})).rejects.toThrow(
      EventSignatureError,
    );
  });

  it('refuses a callback signed under another secret', async () => {
    const { rawBody, query } = callback(transaction(), 'another-secret');

    await expect(adapter().verifyAndParseEvent(rawBody, {}, query)).rejects.toThrow(
      EventSignatureError,
    );
  });

  it.each([
    ['amount_cents', { amount_cents: 1 }],
    ['success', { success: false }],
    ['is_refunded', { is_refunded: true }],
    ['currency', { currency: 'USD' }],
  ])('refuses a callback whose %s changed after signing', async (_field, change) => {
    const { query } = callback(transaction());
    const rawBody = Buffer.from(
      JSON.stringify({ type: 'TRANSACTION', obj: transaction(change), issuer_bank: null }),
    );

    await expect(adapter().verifyAndParseEvent(rawBody, {}, query)).rejects.toThrow(
      EventSignatureError,
    );
  });

  it('refuses a callback whose order id changed after signing', async () => {
    const signed = transaction();
    const { query } = callback(signed);
    const rawBody = Buffer.from(
      JSON.stringify({ type: 'TRANSACTION', obj: { ...signed, order: { id: 1 } } }),
    );

    await expect(adapter().verifyAndParseEvent(rawBody, {}, query)).rejects.toThrow(
      EventSignatureError,
    );
  });

  it('refuses an hmac that is not hex or not whole, and a body that is not JSON, as unsigned', async () => {
    const { rawBody, query } = callback(transaction());
    const hmac = query.hmac ?? '';

    for (const forged of ['zz', hmac.slice(0, -2), `${hmac}00`, '']) {
      await expect(adapter().verifyAndParseEvent(rawBody, {}, { hmac: forged })).rejects.toThrow(
        EventSignatureError,
      );
    }
    await expect(adapter().verifyAndParseEvent(Buffer.from('not json'), {}, query)).rejects.toThrow(
      EventSignatureError,
    );
  });

  it('never quotes the body or the hmac in a refusal (R-SEC-2)', async () => {
    const { rawBody } = callback(transaction(), 'another-secret');
    const refusal = await adapter()
      .verifyAndParseEvent(rawBody, {}, { hmac: 'ab'.repeat(64) })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(EventSignatureError);
    expect(String((refusal as Error).message)).not.toContain('192036465');
    expect(String((refusal as Error).message)).not.toContain('abab');
  });
});

describe("mapping Paymob's transaction states to the port's events", () => {
  async function eventOf(obj: Transaction) {
    const { rawBody, query } = callback(obj);
    return adapter().verifyAndParseEvent(rawBody, {}, query);
  }

  it('a declined or erred transaction is a failed order', async () => {
    await expect(eventOf(transaction({ success: false }))).resolves.toEqual({
      type: 'failed',
      providerEventId: 'paymob:192036465:failed',
      gatewayOrderId: '217503754',
    });
    await expect(
      eventOf(transaction({ success: false, error_occured: true, id: 7 })),
    ).resolves.toMatchObject({ type: 'failed', providerEventId: 'paymob:7:failed' });
  });

  it('a refunded or voided transaction is a refunded order', async () => {
    await expect(eventOf(transaction({ is_refunded: true }))).resolves.toEqual({
      type: 'refunded',
      providerEventId: 'paymob:192036465:refunded',
      gatewayOrderId: '217503754',
    });
    await expect(eventOf(transaction({ is_voided: true }))).resolves.toMatchObject({
      type: 'refunded',
    });
  });

  it("a successful child transaction is the order's refund, or its payment when it is a capture", async () => {
    await expect(
      eventOf(transaction({ id: 9, has_parent_transaction: true, is_standalone_payment: false })),
    ).resolves.toEqual({
      type: 'refunded',
      providerEventId: 'paymob:9:refunded',
      gatewayOrderId: '217503754',
    });
    await expect(
      eventOf(
        transaction({
          id: 10,
          has_parent_transaction: true,
          is_capture: true,
          is_standalone_payment: false,
        }),
      ),
    ).resolves.toMatchObject({ type: 'paid', gatewayTransactionId: '10' });
  });

  it('the same transaction reported twice carries the same provider event id, so the second is a replay (R-MONEY-8)', async () => {
    const first = await eventOf(transaction());
    const second = await eventOf(transaction());

    expect(second.providerEventId).toBe(first.providerEventId);
  });

  // The owner's decision of 2026-11-04: Paymob sends a new callback once the state is final, so a
  // pending or authorise-only one is acknowledged and changes nothing.
  it('answers a signed pending or authorise-only transaction as not final', async () => {
    for (const obj of [transaction({ pending: true }), transaction({ is_auth: true })]) {
      await expect(eventOf(obj)).rejects.toThrow(NonFinalEventError);
    }
  });

  it('still refuses a pending transaction that is not signed, or signed under another secret', async () => {
    const pending = transaction({ pending: true });
    const { rawBody, query } = callback(pending, 'another-secret');

    await expect(adapter().verifyAndParseEvent(rawBody, {}, query)).rejects.toThrow(
      EventSignatureError,
    );
    await expect(adapter().verifyAndParseEvent(rawBody, {})).rejects.toThrow(EventSignatureError);
  });

  it('refuses, as a signed body it cannot read, an unknown type', async () => {
    const obj = transaction();
    const { query } = callback(obj);
    const rawBody = Buffer.from(JSON.stringify({ type: 'TOKEN', obj }));
    await expect(adapter().verifyAndParseEvent(rawBody, {}, query)).rejects.toThrow(
      MalformedEventError,
    );
  });

  // The message has no separators, so a digit could move across a boundary between two fields and
  // leave the digest unchanged. Each such move is refused: the time must be a timestamp, the currency
  // three capitals, and the integration the one this adapter pays on.
  it('refuses a digit moved from the time into the amount, though the digest still holds', async () => {
    const forged = transaction({
      amount_cents: 1_000_002,
      created_at: '024-06-13T11:33:44.592345',
    });
    expect(paymobHmacMessage(forged)).toBe(paymobHmacMessage(transaction()));

    await expect(eventOf(forged)).rejects.toThrow(MalformedEventError);
  });

  it('refuses a digit moved from the integration into the transaction id, or another integration', async () => {
    const forged = transaction({ id: 19_203_646, integration_id: 51_000_001 });
    expect(paymobHmacMessage(forged)).toBe(paymobHmacMessage(transaction()));

    await expect(eventOf(forged)).rejects.toThrow(MalformedEventError);
    await expect(eventOf(transaction({ integration_id: 1 }))).rejects.toThrow(MalformedEventError);
  });

  it('refuses a signed currency that is not three capitals', async () => {
    await expect(eventOf(transaction({ currency: 'EGPx' }))).rejects.toThrow(MalformedEventError);
  });

  it('refuses a signed amount that is not a whole number of piasters', async () => {
    await expect(eventOf(transaction({ amount_cents: 10.5 }))).rejects.toThrow(MalformedEventError);
  });
});

describe('creating a checkout (the Intention API, Unified Checkout)', () => {
  it('sends one intention for the gross on the card integration, authorised by the secret key', async () => {
    const recorder = recordingFetch(intentionAnswer);

    await adapter({ fetch: recorder.fetch }).createCheckout(
      'enr-1',
      piasters(25_000),
      'EGP',
      PAY_BY,
    );

    expect(recorder.requests).toHaveLength(1);
    const [request] = recorder.requests;
    expect(request?.url).toBe('https://accept.paymob.com/v1/intention/');
    expect(request?.method).toBe('POST');
    expect(request?.headers).toMatchObject({
      authorization: `Token ${SECRET_KEY}`,
      'content-type': 'application/json',
    });
    expect(request?.body).toEqual({
      amount: 25_000,
      currency: 'EGP',
      payment_methods: [INTEGRATION_ID],
      items: [{ name: 'Package', amount: 25_000, quantity: 1 }],
      billing_data: { first_name: 'NA', last_name: 'NA', email: 'NA', phone_number: 'NA' },
      // From now, 10:00:00.400, to the latest expiry, 10:15:00.900, in whole seconds (900).
      expiration: 900,
      notification_url: NOTIFICATION_URL,
    });
  });

  it("answers the order's id, the hosted page under the public key and client secret, and an expiry no later than the latest", async () => {
    const recorder = recordingFetch(intentionAnswer);

    const checkout = await adapter({ fetch: recorder.fetch }).createCheckout(
      'enr-1',
      piasters(25_000),
      'EGP',
      PAY_BY,
    );

    expect(checkout.gatewayOrderId).toBe('217503754');
    const url = new URL(checkout.checkoutUrl);
    expect(url.origin).toBe('https://eg.checkout.paymob.com');
    expect(url.searchParams.get('publicKey')).toBe(PUBLIC_KEY);
    expect(url.searchParams.get('clientSecret')).toBe('egy_csk_test_placeholder');
    expect(checkout.expiresAt).toEqual(new Date('2026-11-04T10:15:00.000Z'));
    expect(checkout.expiresAt.getTime()).toBeLessThanOrEqual(PAY_BY.getTime());
  });

  it("splits the whole gross to the teacher's recipient, on the auth integration, when a recipient is named", async () => {
    const recorder = recordingFetch(intentionAnswer);

    await adapter({
      fetch: recorder.fetch,
      splitIntegrationId: SPLIT_INTEGRATION_ID,
    }).createCheckout('enr-1', piasters(25_000), 'EGP', PAY_BY, { recipientRef: '600001' });

    expect(recorder.requests[0]?.body).toMatchObject({
      split_amounts: [{ mid: '600001', amount_cents: 25_000, description: 'Package' }],
      split_payment_methods: [SPLIT_INTEGRATION_ID],
    });
  });

  it('refuses a split without the auth integration, sending nothing', async () => {
    const recorder = recordingFetch(intentionAnswer);

    await expect(
      adapter({ fetch: recorder.fetch }).createCheckout('enr-1', piasters(25_000), 'EGP', PAY_BY, {
        recipientRef: '600001',
      }),
    ).rejects.toThrow(/PAYMENT_GATEWAY_SPLIT_INTEGRATION_ID/);
    expect(recorder.requests).toEqual([]);
  });

  it('refuses a latest expiry less than a second away, and a currency that is not three capitals, sending nothing', async () => {
    const recorder = recordingFetch(intentionAnswer);
    const payment = adapter({ fetch: recorder.fetch });

    await expect(
      payment.createCheckout('enr-1', piasters(1), 'EGP', new Date('2026-11-04T10:00:00.900Z')),
    ).rejects.toThrow(RangeError);
    await expect(payment.createCheckout('enr-1', piasters(1), 'egp', PAY_BY)).rejects.toThrow(
      RangeError,
    );
    expect(recorder.requests).toEqual([]);
  });

  it("rejects with the gateway's status alone when it refuses, quoting neither its answer nor the key", async () => {
    const recorder = recordingFetch(() =>
      Promise.resolve(
        Response.json({ detail: 'Integration ID/Name does not exist' }, { status: 404 }),
      ),
    );

    const refusal = await adapter({ fetch: recorder.fetch })
      .createCheckout('enr-1', piasters(1), 'EGP', PAY_BY)
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(GatewayRequestError);
    expect((refusal as GatewayRequestError).status).toBe(404);
    expect((refusal as Error).message).not.toContain('Integration');
    expect((refusal as Error).message).not.toContain(SECRET_KEY);
  });

  it('rejects an answer it cannot read', async () => {
    const recorder = recordingFetch(() =>
      Promise.resolve(Response.json({ id: 'pi_test_placeholder' }, { status: 201 })),
    );

    await expect(
      adapter({ fetch: recorder.fetch }).createCheckout('enr-1', piasters(1), 'EGP', PAY_BY),
    ).rejects.toMatchObject({ status: 'unreadable' });
  });

  it('gives up after its timeout, aborting the request (R-API rules: every outbound call has one)', async () => {
    let aborted = false;
    const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(init.signal?.reason as Error);
        });
      })) as typeof fetch;

    const refusal = await adapter({ fetch: hanging, timeoutMs: 20 })
      .createCheckout('enr-1', piasters(1), 'EGP', PAY_BY)
      .catch((error: unknown) => error);

    expect(aborted).toBe(true);
    expect(refusal).toBeInstanceOf(GatewayRequestError);
    expect((refusal as GatewayRequestError).status).toBe('timeout');
  });

  it('rejects as unreachable when the request fails before an answer', async () => {
    const failing = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;

    await expect(
      adapter({ fetch: failing }).createCheckout('enr-1', piasters(1), 'EGP', PAY_BY),
    ).rejects.toMatchObject({ status: 'unreachable' });
  });
});

describe('the operations the test account does not offer (OPEN-11, settled at contracting)', () => {
  it('cannot cancel an unpaid order, so it answers unsupported and calls nothing (ADR 0010 D6)', async () => {
    const recorder = recordingFetch(intentionAnswer);

    await expect(adapter({ fetch: recorder.fetch }).cancelCheckout('217503754')).resolves.toBe(
      'unsupported',
    );
    expect(recorder.requests).toEqual([]);
  });

  it("refuses the recipient's registration and its status, calling nothing", async () => {
    const recorder = recordingFetch(intentionAnswer);
    const payment = adapter({ fetch: recorder.fetch });

    await expect(
      payment.registerPayoutRecipient('teacher-1', {
        holderName: 'Placeholder',
        method: 'bank_account',
        accountNumber: '0000',
      }),
    ).rejects.toThrow(/contracting/);
    await expect(payment.getRecipientStatus('600001')).rejects.toThrow(/contracting/);
    expect(recorder.requests).toEqual([]);
  });
});
