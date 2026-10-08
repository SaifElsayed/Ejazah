// T117: the payment port and its stand-in (contracts/ports.md, ADR 0007, ADR 0010 D6).
//
// The port's operations are exactly five, and none reads a balance, moves funds or issues a refund:
// the type check below fails the moment a sixth appears. The stand-in keeps orders and recipients in
// memory and can produce a correctly and an incorrectly signed event for any order or recipient it
// created, so the signature guard of FR-074 (T133) is testable without a network. It records every
// operation it was asked to do and fails one when told (T122).
//
// The type check is enforced by `pnpm typecheck` (CI stage 1), not by vitest.
import { createHmac } from 'node:crypto';
import { piasters } from '@ijazah/money';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { FakePaymentAdapter } from './fake.adapter.js';
import { StandInFailure } from '../stand-in.js';
import {
  EventSignatureError,
  MalformedEventError,
  type GatewayEvent,
  type PaymentPort,
} from './payment.port.js';

const SECRET = 'stand-in-webhook-secret';
const PAY_BY = new Date('2026-10-07T10:30:00Z');

function gateway(): FakePaymentAdapter {
  return new FakePaymentAdapter({ webhookSecret: SECRET });
}

describe('the payment port (T117, ADR 0007)', () => {
  it('has exactly five operations: no balance, transfer or refund exists', () => {
    expectTypeOf<keyof PaymentPort>().toEqualTypeOf<
      | 'createCheckout'
      | 'cancelCheckout'
      | 'verifyAndParseEvent'
      | 'registerPayoutRecipient'
      | 'getRecipientStatus'
    >();
  });

  it('takes the raw body, so a parsed object cannot skip the signature (R-MONEY-9)', () => {
    expectTypeOf<Parameters<PaymentPort['verifyAndParseEvent']>[0]>().toEqualTypeOf<Buffer>();
  });

  it('a recipient operation returns a reference, never account data (R-DB-8)', () => {
    expectTypeOf<ReturnType<PaymentPort['registerPayoutRecipient']>>().toEqualTypeOf<
      Promise<string>
    >();
  });
});

describe('the payment stand-in: checkout (T117, ADR 0010 D6)', () => {
  it('creates an order and a hosted checkout location for it', async () => {
    const checkout = await gateway().createCheckout('enr-1', piasters(25_000), 'EGP', PAY_BY);

    expect(checkout.gatewayOrderId).toMatch(/^fake_ord_/);
    expect(new URL(checkout.checkoutUrl).hostname).toBe('checkout.fake.invalid');
  });

  it('gives every order its own identifier', async () => {
    const payments = gateway();
    const first = await payments.createCheckout('enr-1', piasters(100), 'EGP', PAY_BY);
    const second = await payments.createCheckout('enr-1', piasters(100), 'EGP', PAY_BY);

    expect(first.gatewayOrderId).not.toBe(second.gatewayOrderId);
  });

  it('refuses a currency that is not three capital letters', async () => {
    await expect(gateway().createCheckout('enr-1', piasters(100), 'egp', PAY_BY)).rejects.toThrow(
      RangeError,
    );
  });

  it('cancels an unpaid order, and answers cancelled again once it is', async () => {
    const payments = gateway();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);

    expect(await payments.cancelCheckout(gatewayOrderId)).toBe('cancelled');
    expect(await payments.cancelCheckout(gatewayOrderId)).toBe('cancelled');
  });

  it('answers cancelled for an expired order and paid for a paid one, moving no money', async () => {
    const payments = gateway();
    const expired = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);
    const paid = await payments.createCheckout('enr-2', piasters(1), 'EGP', PAY_BY);
    payments.orderEvent(expired.gatewayOrderId, 'expired');
    payments.orderEvent(paid.gatewayOrderId, 'paid');

    expect(await payments.cancelCheckout(expired.gatewayOrderId)).toBe('cancelled');
    expect(await payments.cancelCheckout(paid.gatewayOrderId)).toBe('paid');
  });

  it('refuses to cancel an order it never created', async () => {
    await expect(gateway().cancelCheckout('fake_ord_unknown')).rejects.toThrow('unknown order');
  });
});

describe('the payment stand-in: signed events (T117, FR-074, R-MONEY-8, R-MONEY-9)', () => {
  it('parses a correctly signed paid event, carrying the amounts the gateway reports', async () => {
    const payments = gateway();
    const { gatewayOrderId } = await payments.createCheckout(
      'enr-1',
      piasters(25_000),
      'EGP',
      PAY_BY,
    );
    const { rawBody, headers } = payments.orderEvent(gatewayOrderId, 'paid', {
      gateway_fee_piasters: piasters(750),
      net_piasters: piasters(24_250),
    });

    const event = await payments.verifyAndParseEvent(rawBody, headers);

    expect(event).toEqual({
      type: 'paid',
      providerEventId: expect.stringMatching(/^fake_evt_/) as unknown,
      gatewayOrderId,
      gatewayTransactionId: expect.stringMatching(/^fake_txn_/) as unknown,
      gross_piasters: 25_000,
      gateway_fee_piasters: 750,
      net_piasters: 24_250,
      currency: 'EGP',
    } satisfies Record<keyof Extract<GatewayEvent, { type: 'paid' }>, unknown>);
  });

  it.each(['failed', 'expired', 'refunded'] as const)(
    'parses a correctly signed %s event naming its order',
    async (type) => {
      const payments = gateway();
      const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);

      const { rawBody, headers } = payments.orderEvent(gatewayOrderId, type);
      const event = await payments.verifyAndParseEvent(rawBody, headers);

      expect(event).toEqual({
        type,
        providerEventId: expect.any(String) as unknown,
        gatewayOrderId,
      });
    },
  );

  it('throws on an incorrectly signed event, which changes nothing', async () => {
    const payments = gateway();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);
    const { rawBody, headers } = payments.orderEvent(gatewayOrderId, 'paid', {
      signature: 'invalid',
    });

    await expect(payments.verifyAndParseEvent(rawBody, headers)).rejects.toThrow(
      EventSignatureError,
    );
    expect(await payments.cancelCheckout(gatewayOrderId)).toBe('cancelled');
  });

  it('throws on an unsigned event, an altered body and a signature under another secret', async () => {
    const payments = gateway();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);
    const { rawBody, headers } = payments.orderEvent(gatewayOrderId, 'failed');
    const altered = Buffer.from(rawBody.toString('utf8').replace('failed', 'paid'));
    const elsewhere = new FakePaymentAdapter({ webhookSecret: 'another-secret' });

    await expect(payments.verifyAndParseEvent(rawBody, {})).rejects.toThrow(EventSignatureError);
    await expect(payments.verifyAndParseEvent(altered, headers)).rejects.toThrow(
      EventSignatureError,
    );
    await expect(elsewhere.verifyAndParseEvent(rawBody, headers)).rejects.toThrow(
      EventSignatureError,
    );
  });

  it('reads the signature header whatever its case', async () => {
    const payments = gateway();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);
    const { rawBody, headers } = payments.orderEvent(gatewayOrderId, 'expired');
    const shouted = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name.toUpperCase(), value]),
    );

    await expect(payments.verifyAndParseEvent(rawBody, shouted)).resolves.toMatchObject({
      type: 'expired',
    });
  });

  it('a replayed event parses to the same provider event id, for the unique column', async () => {
    const payments = gateway();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);
    const { rawBody, headers } = payments.orderEvent(gatewayOrderId, 'paid');

    const first = await payments.verifyAndParseEvent(rawBody, headers);
    const replay = await payments.verifyAndParseEvent(rawBody, headers);

    expect(replay.providerEventId).toBe(first.providerEventId);
  });

  it('gives every event its own provider event id', async () => {
    const payments = gateway();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);
    const failed = payments.orderEvent(gatewayOrderId, 'failed');
    const paid = payments.orderEvent(gatewayOrderId, 'paid');

    const ids = await Promise.all(
      [failed, paid].map(
        async ({ rawBody, headers }) =>
          (await payments.verifyAndParseEvent(rawBody, headers)).providerEventId,
      ),
    );
    expect(new Set(ids).size).toBe(2);
  });

  it('produces events only for an order or recipient it created', () => {
    const payments = gateway();
    expect(() => payments.orderEvent('fake_ord_unknown', 'paid')).toThrow('unknown order');
    expect(() => payments.recipientEvent('fake_rcp_unknown', 'recipient_verified')).toThrow(
      'unknown recipient',
    );
  });
});

describe('the payment stand-in: payout recipients (T117, FR-PAYG-13, FR-PAYG-15)', () => {
  const details = {
    holderName: 'Teacher Name',
    method: 'mobile_wallet',
    accountNumber: '01000000000',
  } as const;

  it('registers a recipient, answering a reference that is pending until the gateway decides', async () => {
    const payments = gateway();
    const recipientRef = await payments.registerPayoutRecipient('teacher-1', details);

    expect(recipientRef).toMatch(/^fake_rcp_/);
    expect(recipientRef).not.toContain(details.accountNumber);
    expect(await payments.getRecipientStatus(recipientRef)).toBe('pending');
  });

  it.each([
    ['recipient_verified', 'verified'],
    ['recipient_rejected', 'rejected'],
  ] as const)(
    'a signed %s event carries the reference and settles the status',
    async (type, status) => {
      const payments = gateway();
      const recipientRef = await payments.registerPayoutRecipient('teacher-1', details);
      const { rawBody, headers } = payments.recipientEvent(recipientRef, type);

      expect(await payments.verifyAndParseEvent(rawBody, headers)).toEqual({
        type,
        providerEventId: expect.stringMatching(/^fake_evt_/) as unknown,
        recipientRef,
      });
      expect(await payments.getRecipientStatus(recipientRef)).toBe(status);
    },
  );

  it('an incorrectly signed recipient event leaves the recipient pending', async () => {
    const payments = gateway();
    const recipientRef = await payments.registerPayoutRecipient('teacher-1', details);
    const { rawBody, headers } = payments.recipientEvent(recipientRef, 'recipient_verified', {
      signature: 'invalid',
    });

    await expect(payments.verifyAndParseEvent(rawBody, headers)).rejects.toThrow(
      EventSignatureError,
    );
    expect(await payments.getRecipientStatus(recipientRef)).toBe('pending');
  });

  it('refuses the status of a recipient it never registered', async () => {
    await expect(gateway().getRecipientStatus('fake_rcp_unknown')).rejects.toThrow(
      'unknown recipient',
    );
  });
});

describe('the payment stand-in: records and induced failure (T122)', () => {
  it('records every operation it was asked to do, with its arguments', async () => {
    const payments = gateway();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(100), 'EGP', PAY_BY);
    await payments.cancelCheckout(gatewayOrderId);

    expect(payments.calls).toEqual([
      { operation: 'createCheckout', args: ['enr-1', 100, 'EGP', PAY_BY] },
      { operation: 'cancelCheckout', args: [gatewayOrderId] },
    ]);
  });

  it('fails a checkout when told, creating no order', async () => {
    const payments = gateway();
    payments.failNext('createCheckout');

    await expect(payments.createCheckout('enr-1', piasters(100), 'EGP', PAY_BY)).rejects.toThrow(
      StandInFailure,
    );
    expect(payments.calls).toHaveLength(1);
    await expect(
      payments.createCheckout('enr-1', piasters(100), 'EGP', PAY_BY),
    ).resolves.toHaveProperty('gatewayOrderId');
  });

  it('fails a cancellation when told, leaving the order payable', async () => {
    const payments = gateway();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);
    payments.failNext('cancelCheckout', new Error('gateway unreachable'));

    await expect(payments.cancelCheckout(gatewayOrderId)).rejects.toThrow('gateway unreachable');
    const { rawBody, headers } = payments.orderEvent(gatewayOrderId, 'paid');
    await expect(payments.verifyAndParseEvent(rawBody, headers)).resolves.toMatchObject({
      type: 'paid',
    });
  });

  it.each(['verifyAndParseEvent', 'registerPayoutRecipient', 'getRecipientStatus'] as const)(
    'fails %s when told',
    async (operation) => {
      const payments = gateway();
      const recipientRef = await payments.registerPayoutRecipient('teacher-1', {
        holderName: 'Teacher Name',
        method: 'bank_account',
        accountNumber: '0001',
      });
      const { rawBody, headers } = payments.recipientEvent(recipientRef, 'recipient_verified');
      payments.failNext(operation);

      const calls = {
        verifyAndParseEvent: () => payments.verifyAndParseEvent(rawBody, headers),
        registerPayoutRecipient: () =>
          payments.registerPayoutRecipient('teacher-2', {
            holderName: 'Teacher Name',
            method: 'mobile_wallet',
            accountNumber: '01000000000',
          }),
        getRecipientStatus: () => payments.getRecipientStatus(recipientRef),
      };
      await expect(calls[operation]()).rejects.toThrow(StandInFailure);
    },
  );
});

describe('the payment stand-in: a signed body it cannot read (T122, review of PR #45 m1)', () => {
  it.each([
    ['not JSON', 'student 01000000000 paid'],
    ['JSON of no known shape', '{"type":"chargeback","card":"4111111111111111"}'],
  ])(
    'rejects, never throws, a signed body that is %s, quoting nothing of it',
    async (_case, text) => {
      const rawBody = Buffer.from(text);
      const headers = {
        'x-fake-signature': createHmac('sha256', SECRET).update(rawBody).digest('hex'),
      };
      let refusal: Promise<unknown> | undefined;

      expect(() => {
        refusal = gateway().verifyAndParseEvent(rawBody, headers);
      }).not.toThrow();
      await expect(refusal).rejects.toThrow(MalformedEventError);
      await expect(refusal).rejects.not.toThrow(/01000000000|4111/);
    },
  );
});
