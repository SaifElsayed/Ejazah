// 006:T014 (R-509; SRS DEC-110, DEC-113): the stand-in's automatic charge and inquiry. It answers
// paid, soft, hard, an unanswered order or a lost payment on demand, records the gateway's order id
// through the caller before the payment, and answers the inquiry with the same provider event id
// its signed callback carries, so whichever is recorded first makes the other a replay.
import { piasters } from '@ijazah/money';
import { describe, expect, it, vi } from 'vitest';
import { FakePaymentAdapter } from './fake.adapter.js';
import { ChargeRefusedError } from './payment.port.js';

const SECRET = 'fake-webhook-secret-placeholder';
const PAYMENT_ID = '019a0000-0000-7000-8000-00000000c0de';
const TOKEN = 'placeholder-card-token';
const EXPIRES = new Date('2026-11-26T16:41:00.000Z');

const gateway = () => new FakePaymentAdapter({ webhookSecret: SECRET });

async function charge(
  fake: FakePaymentAdapter,
  recordOrder: (gatewayOrderId: string) => Promise<boolean> = () => Promise.resolve(true),
) {
  return fake.chargeSavedCard(
    PAYMENT_ID,
    piasters(100_000),
    'EGP',
    EXPIRES,
    TOKEN,
    undefined,
    recordOrder,
  );
}

describe('the stand-in charges a saved card (006:T014)', () => {
  it("records the gateway's order id through the caller, then answers the payment sent", async () => {
    const fake = gateway();
    const recordOrder = vi.fn(() => Promise.resolve(true));

    const charged = await charge(fake, recordOrder);

    expect(charged.step).toBe('payment_sent');
    const gatewayOrderId = charged.step === 'payment_sent' ? charged.gatewayOrderId : '';
    expect(gatewayOrderId).toMatch(/^fake_ord_/);
    expect(recordOrder).toHaveBeenCalledWith(gatewayOrderId);
    expect(fake.calls.map(({ operation }) => operation)).toEqual(['chargeSavedCard']);
  });

  it('answers order_unanswered on demand, recording nothing', async () => {
    const fake = gateway();
    fake.onCharge('order_unanswered');
    const recordOrder = vi.fn(() => Promise.resolve(true));

    await expect(charge(fake, recordOrder)).resolves.toEqual({ step: 'order_unanswered' });
    expect(recordOrder).not.toHaveBeenCalled();
  });

  it('sends no payment when the caller did not record the order: the inquiry finds none', async () => {
    const fake = gateway();

    const charged = await charge(fake, () => Promise.resolve(false));

    expect(charged.step).toBe('order_not_recorded');
    const gatewayOrderId = charged.step === 'order_not_recorded' ? charged.gatewayOrderId : '';
    await expect(fake.inquireOrder(gatewayOrderId)).resolves.toEqual({ answer: 'none' });
  });

  it('refuses as told before anything, recording no order', async () => {
    const fake = gateway();
    fake.failNext('chargeSavedCard', new ChargeRefusedError('no_payee'));
    const recordOrder = vi.fn(() => Promise.resolve(true));

    await expect(charge(fake, recordOrder)).rejects.toBeInstanceOf(ChargeRefusedError);
    expect(recordOrder).not.toHaveBeenCalled();
  });

  it('gives an automatic order no hosted page', async () => {
    const fake = gateway();
    const charged = await charge(fake);

    expect(
      fake.payableOrder(charged.step === 'payment_sent' ? charged.gatewayOrderId : ''),
    ).toBeUndefined();
  });
});

describe('the stand-in answers the inquiry (006:T014)', () => {
  const sent = async (answer?: 'paid' | 'soft' | 'hard' | 'payment_lost') => {
    const fake = gateway();
    if (answer !== undefined) fake.onCharge(answer);
    const charged = await charge(fake);
    if (charged.step !== 'payment_sent') throw new Error('not sent');
    return { fake, gatewayOrderId: charged.gatewayOrderId };
  };

  it('answers a paid charge as the paid event its signed callback carries', async () => {
    const { fake, gatewayOrderId } = await sent('paid');

    const inquiry = await fake.inquireOrder(gatewayOrderId);
    const { rawBody, headers } = fake.orderEvent(gatewayOrderId, 'paid');
    const callback = await fake.verifyAndParseEvent(rawBody, headers);

    expect(inquiry).toMatchObject({
      answer: 'transaction',
      event: { type: 'paid', gatewayOrderId, gross_piasters: 100_000, currency: 'EGP' },
    });
    expect(inquiry.answer === 'transaction' && inquiry.event.providerEventId).toBe(
      callback.providerEventId,
    );
    expect(inquiry.answer === 'transaction' && inquiry.rawBody.length).toBeGreaterThan(0);
  });

  it.each([
    ['soft', 'soft'],
    ['hard', 'hard'],
  ] as const)(
    'answers a %s decline with its kind; the signed callback carries none',
    async (answer, kind) => {
      const { fake, gatewayOrderId } = await sent(answer);

      const inquiry = await fake.inquireOrder(gatewayOrderId);
      const { rawBody, headers } = fake.orderEvent(gatewayOrderId, 'failed');
      const callback = await fake.verifyAndParseEvent(rawBody, headers);

      expect(inquiry).toMatchObject({
        answer: 'transaction',
        event: { type: 'failed', gatewayOrderId, declineKind: kind },
      });
      expect(callback).not.toHaveProperty('declineKind');
      expect(inquiry.answer === 'transaction' && inquiry.event.providerEventId).toBe(
        callback.providerEventId,
      );
    },
  );

  it('answers none for a lost payment', async () => {
    const { fake, gatewayOrderId } = await sent('payment_lost');

    await expect(fake.inquireOrder(gatewayOrderId)).resolves.toEqual({ answer: 'none' });
  });

  it('answers as told for one order: no answer, or none', async () => {
    const { fake, gatewayOrderId } = await sent('paid');

    fake.onInquiry(gatewayOrderId, 'no_answer');
    await expect(fake.inquireOrder(gatewayOrderId)).resolves.toEqual({ answer: 'no_answer' });
    fake.onInquiry(gatewayOrderId, 'none');
    await expect(fake.inquireOrder(gatewayOrderId)).resolves.toEqual({ answer: 'none' });
  });

  it('refuses an order it did not create', async () => {
    await expect(gateway().inquireOrder('fake_ord_unknown')).rejects.toThrow('unknown order');
  });

  it('keeps the token out of every answer and every event (SC-707)', async () => {
    const { fake, gatewayOrderId } = await sent('paid');

    const inquiry = await fake.inquireOrder(gatewayOrderId);
    const { rawBody } = fake.orderEvent(gatewayOrderId, 'paid');

    expect(JSON.stringify(inquiry)).not.toContain(TOKEN);
    expect(inquiry.answer === 'transaction' && inquiry.rawBody.toString('utf8')).not.toContain(
      TOKEN,
    );
    expect(rawBody.toString('utf8')).not.toContain(TOKEN);
  });
});
