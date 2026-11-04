// T121: the payment port's entry picks the adapter from `PAYMENT_GATEWAY` and gives the stand-in its
// webhook secret (note under T117): `PAYMENT_GATEWAY_WEBHOOK_SECRET` when it is set, otherwise a
// secret derived from `ENCRYPTION_KEY`, so every process of one deployment verifies what another
// signed and no credential is needed (SC-005).
import { piasters } from '@ijazah/money';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakePaymentAdapter } from './fake.adapter.js';
import { createPaymentPort, standInCheckoutOf, type PaymentConfig } from './index.js';
import { EventSignatureError, type PaymentPort } from './payment.port.js';
import { PaymobPaymentAdapter } from './paymob.adapter.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const PAY_BY = new Date('2026-10-08T10:30:00Z');
/** Far enough ahead that an order created now has a lifetime. */
const PAY_BY_LATER = new Date('2099-01-01T00:00:00Z');

const base: PaymentConfig = { PAYMENT_GATEWAY: 'fake', ENCRYPTION_KEY: KEY };

async function paidEventFrom(gateway: FakePaymentAdapter) {
  const { gatewayOrderId } = await gateway.createCheckout('enr-1', piasters(100), 'EGP', PAY_BY);
  return gateway.orderEvent(gatewayOrderId, 'paid');
}

describe('payment selection (T121, FR-056)', () => {
  it('serves the stand-in when PAYMENT_GATEWAY is fake', () => {
    expect(createPaymentPort(base)).toBeInstanceOf(FakePaymentAdapter);
  });

  it('verifies under PAYMENT_GATEWAY_WEBHOOK_SECRET when it is set', async () => {
    const port = createPaymentPort({ ...base, PAYMENT_GATEWAY_WEBHOOK_SECRET: 'configured' });
    const { rawBody, headers } = await paidEventFrom(
      new FakePaymentAdapter({ webhookSecret: 'configured' }),
    );

    await expect(port.verifyAndParseEvent(rawBody, headers)).resolves.toMatchObject({
      type: 'paid',
    });
  });

  it('without it, two processes holding one ENCRYPTION_KEY verify what the other signed', async () => {
    const signer = createPaymentPort(base) as FakePaymentAdapter;
    const { rawBody, headers } = await paidEventFrom(signer);

    await expect(
      createPaymentPort(base).verifyAndParseEvent(rawBody, headers),
    ).resolves.toMatchObject({ type: 'paid' });
    await expect(
      createPaymentPort({ ...base, ENCRYPTION_KEY: OTHER_KEY }).verifyAndParseEvent(
        rawBody,
        headers,
      ),
    ).rejects.toThrow(EventSignatureError);
  });

  it('derives a secret that is not the encryption key itself', async () => {
    const { rawBody, headers } = await paidEventFrom(
      new FakePaymentAdapter({ webhookSecret: KEY }),
    );

    await expect(createPaymentPort(base).verifyAndParseEvent(rawBody, headers)).rejects.toThrow(
      EventSignatureError,
    );
  });
});

describe("the stand-in's hosted page (T012, R-213)", () => {
  it('places the page on API_PUBLIC_ORIGIN when it is set', async () => {
    const port = createPaymentPort({ ...base, API_PUBLIC_ORIGIN: 'http://192.168.1.20:3000' });
    const { gatewayOrderId, checkoutUrl } = await port.createCheckout(
      'enr-1',
      piasters(100),
      'EGP',
      PAY_BY,
    );

    expect(checkoutUrl).toBe(`http://192.168.1.20:3000/stand-in/checkout/${gatewayOrderId}`);
  });

  it('hands the page its order operations only when the port is the stand-in', () => {
    const stub: PaymentPort = {
      createCheckout: () => Promise.reject(new Error('unused')),
      cancelCheckout: () => Promise.reject(new Error('unused')),
      verifyAndParseEvent: () => Promise.reject(new Error('unused')),
      registerPayoutRecipient: () => Promise.reject(new Error('unused')),
      getRecipientStatus: () => Promise.reject(new Error('unused')),
    };

    expect(standInCheckoutOf(createPaymentPort(base))).toBeDefined();
    expect(standInCheckoutOf(stub)).toBeUndefined();
  });
});

// T056 (FR-371): Paymob from its keys, no value real (R-SEC-1). Its callbacks reach the webhook on
// PUBLIC_WEBHOOK_ORIGIN, which every intention names; no hosted page of the stand-in is mounted.
describe('the gateway (T056)', () => {
  const paymob: PaymentConfig = {
    ...base,
    PAYMENT_GATEWAY: 'paymob',
    PAYMENT_GATEWAY_SECRET_KEY: 'egy_sk_test_placeholder',
    PAYMENT_GATEWAY_PUBLIC_KEY: 'egy_pk_test_placeholder',
    PAYMENT_GATEWAY_WEBHOOK_SECRET: 'hmac-placeholder',
    PAYMENT_GATEWAY_INTEGRATION_ID: 1_000_001,
    PUBLIC_WEBHOOK_ORIGIN: 'https://tunnel.example.com',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves Paymob when PAYMENT_GATEWAY is paymob, and hands no hosted page to the stand-in route', () => {
    const port = createPaymentPort(paymob);

    expect(port).toBeInstanceOf(PaymobPaymentAdapter);
    expect(standInCheckoutOf(port)).toBeUndefined();
  });

  it('names the webhook on PUBLIC_WEBHOOK_ORIGIN as every intention’s callback address', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', (_url: URL, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Promise.resolve(
        Response.json({ client_secret: 'csk', intention_order_id: 1 }, { status: 201 }),
      );
    });

    await createPaymentPort(paymob).createCheckout('enr-1', piasters(100), 'EGP', PAY_BY_LATER);

    expect(bodies).toMatchObject([
      {
        notification_url: 'https://tunnel.example.com/webhooks/payment',
        payment_methods: [1_000_001],
      },
    ]);
  });

  it.each([
    'PAYMENT_GATEWAY_SECRET_KEY',
    'PAYMENT_GATEWAY_PUBLIC_KEY',
    'PAYMENT_GATEWAY_WEBHOOK_SECRET',
    'PAYMENT_GATEWAY_INTEGRATION_ID',
    'PUBLIC_WEBHOOK_ORIGIN',
  ] as const)('refuses to build Paymob without %s, naming it', (key) => {
    const { [key]: _omitted, ...config } = paymob;

    expect(() => createPaymentPort(config)).toThrow(key);
  });
});
