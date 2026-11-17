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
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { piasters } from '@ijazah/money';
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { FakePaymentAdapter, StandInDeliveryError } from './fake.adapter.js';
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

  it('reports no fee and no net when told the gateway reports none, as Paymob does (T056)', async () => {
    const payments = gateway();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(500), 'EGP', PAY_BY);
    const { rawBody, headers } = payments.orderEvent(gatewayOrderId, 'paid', {
      gateway_fee_piasters: null,
      net_piasters: null,
    });

    await expect(payments.verifyAndParseEvent(rawBody, headers)).resolves.toMatchObject({
      type: 'paid',
      gross_piasters: 500,
      gateway_fee_piasters: null,
      net_piasters: null,
    });
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

  it("a rejection carries the gateway's reason where it sent one (B15)", async () => {
    const payments = gateway();
    const recipientRef = await payments.registerPayoutRecipient('teacher-1', details);
    const { rawBody, headers } = payments.recipientEvent(recipientRef, 'recipient_rejected', {
      reason: 'name mismatch',
    });

    expect(await payments.verifyAndParseEvent(rawBody, headers)).toMatchObject({
      type: 'recipient_rejected',
      recipientRef,
      reason: 'name mismatch',
    });
  });

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

  it("records the payee and the teacher's share a checkout was given (T104)", async () => {
    const payments = gateway();
    const payee = { recipientRef: 'fake_rcp_1', share_piasters: piasters(70) };
    await payments.createCheckout('enr-1', piasters(100), 'EGP', PAY_BY, payee);

    expect(payments.calls).toEqual([
      { operation: 'createCheckout', args: ['enr-1', 100, 'EGP', PAY_BY, payee] },
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

// T012: the stand-in as a gateway at the boundary (R-213, FR-372, FR-374). Its hosted page lives on
// the API's public origin; what the page sends over HTTP is `platform/web/stand-in-checkout.spec.ts`'s.
describe('the payment stand-in: its hosted page and configured cancel (T012, R-213)', () => {
  const ORIGIN = 'http://192.168.1.20:3000';
  let clock = new Date('2026-10-07T10:00:00Z');
  const hosted = () =>
    new FakePaymentAdapter({ webhookSecret: SECRET, origin: ORIGIN, now: () => clock });

  it("answers the hosted page on the API's public origin and the order's expiry", async () => {
    const checkout = await hosted().createCheckout('enr-1', piasters(25_000), 'EGP', PAY_BY);

    expect(checkout.checkoutUrl).toBe(`${ORIGIN}/stand-in/checkout/${checkout.gatewayOrderId}`);
    expect(checkout.expiresAt).toEqual(PAY_BY);
  });

  it('shows a created order before its expiry as payable, with its amount and currency', async () => {
    clock = new Date('2026-10-07T10:00:00Z');
    const payments = hosted();
    const { gatewayOrderId } = await payments.createCheckout(
      'enr-1',
      piasters(25_000),
      'EGP',
      PAY_BY,
    );

    expect(payments.payableOrder(gatewayOrderId)).toEqual({
      gatewayOrderId,
      amount_piasters: 25_000,
      currency: 'EGP',
      expiresAt: PAY_BY,
    });
  });

  it('shows no payable order once it expired, was cancelled or paid, or was never created', async () => {
    clock = new Date('2026-10-07T10:00:00Z');
    const payments = hosted();
    const create = () => payments.createCheckout('enr-1', piasters(100), 'EGP', PAY_BY);
    const expiring = await create();
    const cancelled = await create();
    const paid = await create();
    await payments.cancelCheckout(cancelled.gatewayOrderId);
    payments.orderEvent(paid.gatewayOrderId, 'paid');
    clock = PAY_BY;

    expect(payments.payableOrder(expiring.gatewayOrderId)).toBeUndefined();
    clock = new Date('2026-10-07T10:00:00Z');
    expect(payments.payableOrder(expiring.gatewayOrderId)).toBeDefined();
    expect(payments.payableOrder(cancelled.gatewayOrderId)).toBeUndefined();
    expect(payments.payableOrder(paid.gatewayOrderId)).toBeUndefined();
    expect(payments.payableOrder('fake_ord_unknown')).toBeUndefined();
  });

  it.each(['cancelled', 'paid', 'in_progress', 'unsupported'] as const)(
    'answers cancelCheckout with %s for the order it was configured on, and only that one',
    async (outcome) => {
      const payments = hosted();
      const configured = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);
      const other = await payments.createCheckout('enr-2', piasters(1), 'EGP', PAY_BY);
      payments.onCancel(configured.gatewayOrderId, outcome);

      expect(await payments.cancelCheckout(configured.gatewayOrderId)).toBe(outcome);
      expect(await payments.cancelCheckout(configured.gatewayOrderId)).toBe(outcome);
      expect(await payments.cancelCheckout(other.gatewayOrderId)).toBe('cancelled');
    },
  );

  it('an order configured to refuse its cancellation stays payable', async () => {
    clock = new Date('2026-10-07T10:00:00Z');
    const payments = hosted();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);
    payments.onCancel(gatewayOrderId, 'in_progress');

    await payments.cancelCheckout(gatewayOrderId);
    expect(payments.payableOrder(gatewayOrderId)).toBeDefined();
  });

  it('refuses to configure an order it never created', () => {
    expect(() => hosted().onCancel('fake_ord_unknown', 'paid')).toThrow(/unknown order/);
  });

  it('refuses to send an event when it was given no origin to send it to', async () => {
    clock = new Date('2026-10-07T10:00:00Z');
    const payments = new FakePaymentAdapter({ webhookSecret: SECRET, now: () => clock });
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);

    await expect(payments.submit(gatewayOrderId, 'pay')).rejects.toThrow(/origin/);
    expect(payments.payableOrder(gatewayOrderId)).toBeDefined();
  });
});

// T012: what `submit` sends, over HTTP to a receiver that stands where the webhook does and verifies
// as it does, through `verifyAndParseEvent` under the same secret (FR-372, FR-374).
describe("the payment stand-in: its hosted page's events over HTTP (T012, FR-372, FR-374)", () => {
  interface Received {
    readonly method: string | undefined;
    readonly path: string | undefined;
    readonly contentType: string | undefined;
    readonly event: GatewayEvent;
  }
  const received: Received[] = [];
  let answer = 200;
  let server: Server;
  let origin: string;
  const verifier = gateway();

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(request.headers)) {
          if (typeof value === 'string') headers[name] = value;
        }
        verifier
          .verifyAndParseEvent(Buffer.concat(chunks), headers)
          .then((event) => {
            received.push({
              method: request.method,
              path: request.url,
              contentType: request.headers['content-type'],
              event,
            });
            response.statusCode = answer;
          })
          .catch(() => {
            response.statusCode = 401;
          })
          .finally(() => response.end());
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received.length = 0;
    answer = 200;
  });

  const clock = new Date('2026-10-07T10:00:00Z');
  const hosted = (at = origin) =>
    new FakePaymentAdapter({ webhookSecret: SECRET, origin: at, now: () => clock });

  it('pays: POSTs a signed paid event, with its transaction, gross, fee and net, to the webhook', async () => {
    const payments = hosted();
    const { gatewayOrderId } = await payments.createCheckout(
      'enr-1',
      piasters(25_000),
      'EGP',
      PAY_BY,
    );

    expect(await payments.submit(gatewayOrderId, 'pay')).toBe('delivered');
    expect(received).toEqual([
      {
        method: 'POST',
        path: '/webhooks/payment',
        contentType: 'application/json',
        event: {
          type: 'paid',
          providerEventId: expect.stringMatching(/^fake_evt_/),
          gatewayOrderId,
          gatewayTransactionId: expect.stringMatching(/^fake_txn_/),
          gross_piasters: 25_000,
          gateway_fee_piasters: 0,
          net_piasters: 25_000,
          currency: 'EGP',
        },
      },
    ]);
    expect(payments.payableOrder(gatewayOrderId)).toBeUndefined();
  });

  it.each(['fail', 'cancel'] as const)('%s: POSTs a signed failed event', async (action) => {
    const payments = hosted();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);

    expect(await payments.submit(gatewayOrderId, action)).toBe('delivered');
    expect(received.map(({ event }) => event)).toEqual([
      { type: 'failed', providerEventId: expect.stringMatching(/^fake_evt_/), gatewayOrderId },
    ]);
  });

  it('sends nothing for an order that is not payable', async () => {
    const payments = hosted();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);
    await payments.cancelCheckout(gatewayOrderId);

    expect(await payments.submit(gatewayOrderId, 'pay')).toBe('not_payable');
    expect(await payments.submit('fake_ord_unknown', 'pay')).toBe('not_payable');
    expect(received).toHaveLength(0);
  });

  it('a second press finds the order acted on, even while the first is in flight', async () => {
    const payments = hosted();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);

    const outcomes = await Promise.all([
      payments.submit(gatewayOrderId, 'pay'),
      payments.submit(gatewayOrderId, 'fail'),
    ]);

    expect(outcomes).toEqual(['delivered', 'not_payable']);
    expect(received).toHaveLength(1);
  });

  it('rejects with the status alone when the webhook does not take the event', async () => {
    const payments = hosted();
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);
    answer = 500;

    const refusal = payments.submit(gatewayOrderId, 'pay');

    await expect(refusal).rejects.toThrow(StandInDeliveryError);
    await expect(refusal).rejects.toThrow(/500/);
    await expect(refusal).rejects.not.toThrow(/fake_evt_|fake_txn_|fake_ord_/);
  });

  it('rejects as unreachable when nothing listens at the origin', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const payments = hosted(`http://127.0.0.1:${port}`);
    const { gatewayOrderId } = await payments.createCheckout('enr-1', piasters(1), 'EGP', PAY_BY);

    await expect(payments.submit(gatewayOrderId, 'pay')).rejects.toThrow(/unreachable/);
  });
});
