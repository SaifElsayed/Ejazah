// 006:T014 (R-509, FR-714, FR-716; SRS DEC-110, DEC-113; Q-10 (a) adjusted, Q-11 (a), Q-2 (a)
// amended): Paymob's automatic charge of a saved card (the Moto intention, then the token payment),
// its inquiry, and the decline code table, with no network. Every request is answered by a recording
// `fetch`; the shapes are Paymob's pages as read for B-P3 (`track2\b-p3\paymob-docs.md`). No value
// below is a real key or a real card token (R-SEC-1, SC-707).
import { createHmac } from 'node:crypto';
import { piasters } from '@ijazah/money';
import { describe, expect, it, vi } from 'vitest';
import { ChargeRefusedError } from './payment.port.js';
import { declineKindOf, PaymobPaymentAdapter, paymobHmacMessage } from './paymob.adapter.js';

const SECRET_KEY = 'egy_sk_test_placeholder';
const API_KEY = 'placeholder-api-key';
const AUTH_TOKEN = 'placeholder-auth-token';
const HMAC_SECRET = 'hmac-secret-placeholder';
const CARD_TOKEN = 'placeholder-card-token';
const PAYMENT_KEY = 'placeholder-payment-key';
const INTEGRATION_ID = 1_000_001;
const SPLIT_INTEGRATION_ID = 1_000_002;
const MOTO_INTEGRATION_ID = 1_000_004;
const NOTIFICATION_URL = 'https://tunnel.example.com/webhooks/payment';
const BILLING_EMAIL = 'support@ijazah.invalid';
const NOW = new Date('2026-11-26T16:31:00.400Z');
const EXPIRES = new Date('2026-11-26T16:41:00.900Z');
const PAYMENT_ID = '019a0000-0000-7000-8000-00000000c0de';
const ORDER_ID = 317_503_754;
const PAYEE = { recipientRef: 'mid-placeholder', share_piasters: piasters(70_000) } as const;

interface Recorded {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** A `fetch` that records each request and answers the next of `answers` (the last one repeats). */
function recordingFetch(...answers: (() => Promise<Response>)[]): {
  fetch: typeof fetch;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  const fetchDouble = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body,
    });
    const answer = answers[Math.min(requests.length - 1, answers.length - 1)];
    if (answer === undefined) throw new Error('no answer given');
    return answer();
  }) as typeof fetch;
  return { fetch: fetchDouble, requests };
}

const json =
  (body: unknown, status = 200) =>
  (): Promise<Response> =>
    Promise.resolve(Response.json(body, { status }));
const timeout = (): Promise<Response> =>
  Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
const motoIntention = json(
  {
    id: 'pi_test_placeholder',
    client_secret: 'egy_csk_test_placeholder',
    intention_order_id: ORDER_ID,
    payment_keys: [{ integration: MOTO_INTEGRATION_ID, key: PAYMENT_KEY }],
  },
  201,
);
// The pay call's synchronous answer is not documented (paymob-docs.md row 4): nothing is read of it.
const payAnswer = json({ id: 99, pending: true });

function adapter(
  options: {
    fetch?: typeof fetch;
    mode?: 'test' | 'live';
    splitIntegrationId?: number;
    motoIntegrationId?: number;
    apiKey?: string;
  } = {},
): PaymobPaymentAdapter {
  return new PaymobPaymentAdapter({
    secretKey: SECRET_KEY,
    publicKey: 'egy_pk_test_placeholder',
    hmacSecret: HMAC_SECRET,
    integrationId: INTEGRATION_ID,
    notificationUrl: NOTIFICATION_URL,
    billingEmail: BILLING_EMAIL,
    mode: options.mode ?? 'test',
    now: () => NOW,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.splitIntegrationId === undefined
      ? {}
      : { splitIntegrationId: options.splitIntegrationId }),
    ...(options.motoIntegrationId === undefined
      ? {}
      : { motoIntegrationId: options.motoIntegrationId }),
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
  });
}

const charging = (
  paymob: PaymobPaymentAdapter,
  recordOrder: (gatewayOrderId: string) => Promise<boolean> = () => Promise.resolve(true),
  payee: typeof PAYEE | 'no_payee' = PAYEE,
) =>
  paymob.chargeSavedCard(
    PAYMENT_ID,
    piasters(100_000),
    'EGP',
    EXPIRES,
    CARD_TOKEN,
    payee === 'no_payee' ? undefined : payee,
    recordOrder,
  );

describe("the decline code table (Visa's categories; SRS DEC-113, Q-10 (a) adjusted)", () => {
  // Visa's Category 2, «issuer cannot approve at this time», the only retried answers.
  it.each([
    '03',
    '19',
    '51',
    '59',
    '61',
    '62',
    '65',
    '75',
    '78',
    '86',
    '91',
    '93',
    '96',
    'N3',
    'N4',
  ])('counts %s soft (Category 2)', (code) => {
    expect(declineKindOf(code)).toBe('soft');
  });

  // Category 1 (never approve: lost, stolen, closed, invalid, stop recurring): never retried.
  it.each(['04', '07', '12', '14', '15', '41', '43', '46', '57', 'R0', 'R1', 'R3'])(
    'counts %s hard (Category 1)',
    (code) => {
      expect(declineKindOf(code)).toBe('hard');
    },
  );

  // Category 3 (not with these details: 54 expired among them) and Category 4 (generic: 05 do not
  // honour among them), as Adyen's «Visa integrity fees» page gives them: never retried.
  it.each(['54', '55', '82', 'N7', '1A', '70', '05', '01', '06'])('counts %s hard', (code) => {
    expect(declineKindOf(code)).toBe('hard');
  });

  it.each([[undefined], [''], ['XX'], ['051'], ['5'], [' 51']])(
    'counts an absent or unknown code (%j) hard',
    (code) => {
      expect(declineKindOf(code)).toBe('hard');
    },
  );
});

describe('the automatic charge: refused before the gateway', () => {
  // Q-b1 (a) as adjusted: the live charge needs both the Moto integration and the API key (an
  // unanswered payment could otherwise never be asked about).
  it.each([
    ['no Moto integration and no API key', {}],
    ['the API key alone', { apiKey: API_KEY }],
    ['the Moto integration alone', { motoIntegrationId: MOTO_INTEGRATION_ID }],
  ])('refuses charge_off, sending nothing, with %s set', async (_, options) => {
    const recorder = recordingFetch(motoIntention, payAnswer);
    const recordOrder = vi.fn(() => Promise.resolve(true));

    const refusal = await charging(
      adapter({ fetch: recorder.fetch, ...options }),
      recordOrder,
    ).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ChargeRefusedError);
    expect((refusal as ChargeRefusedError).reason).toBe('charge_off');
    expect(recorder.requests).toHaveLength(0);
    expect(recordOrder).not.toHaveBeenCalled();
  });

  it('refuses no_payee in live mode, sending nothing (the payee guard, PR #153 r1 Major 3)', async () => {
    const recorder = recordingFetch(motoIntention, payAnswer);
    const recordOrder = vi.fn(() => Promise.resolve(true));

    const refusal = await charging(
      adapter({
        fetch: recorder.fetch,
        mode: 'live',
        splitIntegrationId: SPLIT_INTEGRATION_ID,
        motoIntegrationId: MOTO_INTEGRATION_ID,
        apiKey: API_KEY,
      }),
      recordOrder,
      'no_payee',
    ).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ChargeRefusedError);
    expect((refusal as ChargeRefusedError).reason).toBe('no_payee');
    expect(recorder.requests).toHaveLength(0);
    expect(recordOrder).not.toHaveBeenCalled();
  });
});

describe('the automatic charge: two steps (SRS DEC-113 (2))', () => {
  const live = (recorder: { fetch: typeof fetch }) =>
    adapter({
      fetch: recorder.fetch,
      mode: 'live',
      splitIntegrationId: SPLIT_INTEGRATION_ID,
      motoIntegrationId: MOTO_INTEGRATION_ID,
      apiKey: API_KEY,
    });

  it('creates the intention on the Moto integration with the split and the payment id as its reference', async () => {
    const recorder = recordingFetch(motoIntention, payAnswer);

    await charging(live(recorder));

    const [intention] = recorder.requests;
    expect(intention?.url).toBe('https://accept.paymob.com/v1/intention/');
    expect(intention?.headers).toMatchObject({ authorization: `Token ${SECRET_KEY}` });
    expect(intention?.body).toEqual({
      amount: 100_000,
      currency: 'EGP',
      payment_methods: [MOTO_INTEGRATION_ID],
      items: [{ name: 'Package', amount: 100_000, quantity: 1 }],
      billing_data: {
        first_name: 'NA',
        last_name: 'NA',
        email: BILLING_EMAIL,
        phone_number: 'NA',
      },
      // 16:31:00.400 to 16:41:00.900 in whole seconds.
      expiration: 600,
      notification_url: NOTIFICATION_URL,
      special_reference: PAYMENT_ID,
      split_amounts: [{ mid: PAYEE.recipientRef, amount_cents: 70_000, description: 'Package' }],
      split_payment_methods: [SPLIT_INTEGRATION_ID],
    });
  });

  it("records the gateway's order id before the payment, then pays once with the token and the payment key", async () => {
    const recorder = recordingFetch(motoIntention, payAnswer);
    const seen: number[] = [];
    const recordOrder = vi.fn((_id: string) => {
      seen.push(recorder.requests.length);
      return Promise.resolve(true);
    });

    const charge = await charging(live(recorder), recordOrder);

    expect(recordOrder).toHaveBeenCalledTimes(1);
    expect(recordOrder).toHaveBeenCalledWith(String(ORDER_ID));
    // Recorded after the intention, before the payment.
    expect(seen).toEqual([1]);
    expect(recorder.requests).toHaveLength(2);
    const pay = recorder.requests[1];
    expect(pay?.url).toBe('https://accept.paymob.com/api/acceptance/payments/pay');
    expect(pay?.body).toEqual({
      source: { identifier: CARD_TOKEN, subtype: 'TOKEN' },
      payment_token: PAYMENT_KEY,
    });
    expect(charge).toEqual({ step: 'payment_sent', gatewayOrderId: String(ORDER_ID) });
  });

  it('sends no payment when the order id could not be recorded (the order moved meanwhile)', async () => {
    const recorder = recordingFetch(motoIntention, payAnswer);

    const charge = await charging(live(recorder), () => Promise.resolve(false));

    expect(recorder.requests).toHaveLength(1);
    expect(charge).toEqual({ step: 'order_not_recorded', gatewayOrderId: String(ORDER_ID) });
  });

  it('sends no payment when recording the order id fails, and rejects', async () => {
    const recorder = recordingFetch(motoIntention, payAnswer);

    await expect(
      charging(live(recorder), () => Promise.reject(new Error('database down'))),
    ).rejects.toThrow('database down');
    expect(recorder.requests).toHaveLength(1);
  });

  it.each([
    ['a timeout', timeout],
    ['a refusal', json({ detail: 'refused' }, 400)],
    ['an answer with no order', json({ client_secret: 'x' }, 201)],
    [
      'an answer with no payment key',
      json({ intention_order_id: ORDER_ID, payment_keys: [] }, 201),
    ],
  ])(
    'answers order_unanswered on %s to the intention, records nothing and pays nothing',
    async (_, answer) => {
      const recorder = recordingFetch(answer, payAnswer);
      const recordOrder = vi.fn(() => Promise.resolve(true));

      await expect(charging(live(recorder), recordOrder)).resolves.toEqual({
        step: 'order_unanswered',
      });
      expect(recorder.requests).toHaveLength(1);
      expect(recordOrder).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a timeout', timeout],
    ['a server error', json({}, 502)],
    ['an unreadable answer', () => Promise.resolve(new Response('not json', { status: 200 }))],
  ])(
    'sends the payment once, never again, on %s to it, and answers payment_sent',
    async (_, answer) => {
      const recorder = recordingFetch(motoIntention, answer);

      await expect(charging(live(recorder))).resolves.toEqual({
        step: 'payment_sent',
        gatewayOrderId: String(ORDER_ID),
      });
      expect(recorder.requests).toHaveLength(2);
    },
  );

  it('carries the token in the payment request alone, never in the intention, the answer or a refusal (SC-707)', async () => {
    const recorder = recordingFetch(motoIntention, timeout);

    const charge = await charging(live(recorder));
    const refused = await charging(
      adapter({
        fetch: recorder.fetch,
        mode: 'live',
        motoIntegrationId: MOTO_INTEGRATION_ID,
        apiKey: API_KEY,
      }),
      undefined,
      'no_payee',
    ).catch((error: unknown) => error);

    expect(JSON.stringify(recorder.requests[0])).not.toContain(CARD_TOKEN);
    expect(JSON.stringify(charge)).not.toContain(CARD_TOKEN);
    expect(String(refused)).not.toContain(CARD_TOKEN);
    expect(JSON.stringify(refused)).not.toContain(CARD_TOKEN);
  });
});

// The documented transaction, trimmed, for the Moto callback and the inquiry's answer.
function transaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 292_036_465,
    pending: false,
    amount_cents: 100_000,
    success: true,
    is_auth: false,
    is_capture: false,
    is_standalone_payment: true,
    is_voided: false,
    is_refunded: false,
    is_3d_secure: false,
    integration_id: MOTO_INTEGRATION_ID,
    has_parent_transaction: false,
    order: { id: ORDER_ID },
    created_at: '2026-11-26T18:31:44.592345',
    currency: 'EGP',
    source_data: { pan: '4242', type: 'card', sub_type: 'Visa' },
    error_occured: false,
    owner: 302_852,
    ...overrides,
  };
}

describe('the late callback of an automatic charge (Q-2 (a) amended)', () => {
  it('takes a signed callback on the Moto integration, matched by the signed order id, never the unsigned merchant_order_id', async () => {
    const obj = transaction({ merchant_order_id: 'another-payment-id' });
    const rawBody = Buffer.from(JSON.stringify({ type: 'TRANSACTION', obj }));
    const hmac = createHmac('sha512', HMAC_SECRET).update(paymobHmacMessage(obj)).digest('hex');

    await expect(
      adapter({ motoIntegrationId: MOTO_INTEGRATION_ID }).verifyAndParseEvent(
        rawBody,
        {},
        { hmac },
      ),
    ).resolves.toMatchObject({ type: 'paid', gatewayOrderId: String(ORDER_ID) });
  });

  it('records no kind on a signed failed callback, whatever its unsigned codes say (Q-10 (a) adjusted)', async () => {
    const obj = transaction({
      success: false,
      txn_response_code: '51',
      acq_response_code: '51',
      data: { acq_response_code: '51', txn_response_code: '51' },
    });
    const rawBody = Buffer.from(JSON.stringify({ type: 'TRANSACTION', obj }));
    const hmac = createHmac('sha512', HMAC_SECRET).update(paymobHmacMessage(obj)).digest('hex');

    const event = await adapter({ motoIntegrationId: MOTO_INTEGRATION_ID }).verifyAndParseEvent(
      rawBody,
      {},
      { hmac },
    );

    expect(event).toEqual({
      type: 'failed',
      providerEventId: 'paymob:292036465:failed',
      gatewayOrderId: String(ORDER_ID),
    });
  });
});

describe('the inquiry (SRS DEC-110, DEC-113 (1); Q-11 (a))', () => {
  const inquiring = (...answers: (() => Promise<Response>)[]) => {
    const recorder = recordingFetch(json({ profile: { id: 1 }, token: AUTH_TOKEN }), ...answers);
    return {
      recorder,
      ask: () =>
        adapter({
          fetch: recorder.fetch,
          motoIntegrationId: MOTO_INTEGRATION_ID,
          apiKey: API_KEY,
        }).inquireOrder(String(ORDER_ID)),
    };
  };

  it('answers no_answer and sends nothing with no API key (the live inquiry off)', async () => {
    const recorder = recordingFetch(json(transaction()));

    await expect(
      adapter({ fetch: recorder.fetch, motoIntegrationId: MOTO_INTEGRATION_ID }).inquireOrder(
        String(ORDER_ID),
      ),
    ).resolves.toEqual({ answer: 'no_answer' });
    expect(recorder.requests).toHaveLength(0);
  });

  it('makes the auth token from the API key, then asks by the order id', async () => {
    const { recorder, ask } = inquiring(json(transaction()));

    await ask();

    expect(recorder.requests).toHaveLength(2);
    expect(recorder.requests[0]?.url).toBe('https://accept.paymob.com/api/auth/tokens');
    expect(recorder.requests[0]?.body).toEqual({ api_key: API_KEY });
    expect(recorder.requests[1]?.url).toBe(
      'https://accept.paymob.com/api/ecommerce/orders/transaction_inquiry',
    );
    expect(recorder.requests[1]?.body).toEqual({ auth_token: AUTH_TOKEN, order_id: ORDER_ID });
  });

  it('answers a paid transaction as the paid event its callback carries, with the answer as received', async () => {
    const body = transaction();
    const { ask } = inquiring(json(body));

    const inquiry = await ask();

    expect(inquiry).toMatchObject({
      answer: 'transaction',
      event: {
        type: 'paid',
        providerEventId: 'paymob:292036465:paid',
        gatewayOrderId: String(ORDER_ID),
        gatewayTransactionId: '292036465',
        gross_piasters: 100_000,
        gateway_fee_piasters: null,
        net_piasters: null,
        currency: 'EGP',
      },
    });
    expect(inquiry.answer === 'transaction' && inquiry.rawBody.toString('utf8')).toBe(
      JSON.stringify(body),
    );
  });

  it.each([
    ['51 in data', { data: { acq_response_code: '51' } }, 'soft'],
    ['96 at the top', { acq_response_code: '96' }, 'soft'],
    ['51 as a number', { data: { acq_response_code: 51 } }, 'soft'],
    ['05 (do not honour)', { data: { acq_response_code: '05' } }, 'hard'],
    ['54 (expired)', { data: { acq_response_code: '54' } }, 'hard'],
    ['no code', {}, 'hard'],
    ['only a txn_response_code', { data: { txn_response_code: '51' } }, 'hard'],
  ])('answers a failed transaction with %s as its kind', async (_, codes, kind) => {
    const { ask } = inquiring(json(transaction({ success: false, ...codes })));

    await expect(ask()).resolves.toMatchObject({
      answer: 'transaction',
      event: {
        type: 'failed',
        providerEventId: 'paymob:292036465:failed',
        gatewayOrderId: String(ORDER_ID),
        declineKind: kind,
      },
    });
  });

  it.each([
    ['pending', transaction({ pending: true })],
    ['a refund child', transaction({ has_parent_transaction: true })],
    ['refunded', transaction({ is_refunded: true })],
    ['voided', transaction({ is_voided: true })],
    ['an authorisation alone', transaction({ is_auth: true })],
    ['another order', transaction({ order: { id: ORDER_ID + 1 } })],
    ['another integration', transaction({ integration_id: 9 })],
    ['no currency', transaction({ currency: undefined })],
    // The «no transaction» answer is not documented: never read as «no charge».
    ['an empty answer', {}],
    ['a not-found detail', { detail: 'Not found.' }],
  ])('answers no_answer on %s', async (_, body) => {
    const { ask } = inquiring(json(body));

    await expect(ask()).resolves.toEqual({ answer: 'no_answer' });
  });

  it.each([
    ['a 404', json({ detail: 'Not found.' }, 404)],
    ['a timeout', timeout],
    ['an unreadable answer', () => Promise.resolve(new Response('<html>', { status: 200 }))],
  ])('answers no_answer on %s to the inquiry', async (_, answer) => {
    const { ask } = inquiring(answer);

    await expect(ask()).resolves.toEqual({ answer: 'no_answer' });
  });

  it.each([
    ['refused', json({ detail: 'bad key' }, 403)],
    ['answered with no token', json({ profile: { id: 1 } })],
    ['unreadable', () => Promise.resolve(new Response('<html>', { status: 200 }))],
    ['timed out', timeout],
  ])('answers no_answer and asks nothing when the auth token is %s', async (_, authAnswer) => {
    const recorder = recordingFetch(authAnswer, json(transaction()));

    await expect(
      adapter({
        fetch: recorder.fetch,
        motoIntegrationId: MOTO_INTEGRATION_ID,
        apiKey: API_KEY,
      }).inquireOrder(String(ORDER_ID)),
    ).resolves.toEqual({ answer: 'no_answer' });
    expect(recorder.requests).toHaveLength(1);
  });
});
