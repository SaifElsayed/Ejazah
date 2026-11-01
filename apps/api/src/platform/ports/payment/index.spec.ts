// T121: the payment port's entry picks the adapter from `PAYMENT_GATEWAY` and gives the stand-in its
// webhook secret (note under T117): `PAYMENT_GATEWAY_WEBHOOK_SECRET` when it is set, otherwise a
// secret derived from `ENCRYPTION_KEY`, so every process of one deployment verifies what another
// signed and no credential is needed (SC-005).
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';
import { FakePaymentAdapter } from './fake.adapter.js';
import { createPaymentPort, standInCheckoutOf, type PaymentConfig } from './index.js';
import { EventSignatureError, type PaymentPort } from './payment.port.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const PAY_BY = new Date('2026-10-08T10:30:00Z');

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
