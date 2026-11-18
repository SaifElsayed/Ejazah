// T013: the gateway stand-in's test harness over real HTTP (contracts/gateway.md "The test harness",
// R-213, FR-372, SC-302, SC-311). A receiver listens on an ephemeral port and verifies what reaches
// it with `verifyAndParseEvent` of a second port built from the same configuration, the operation
// the payments webhook calls (T077): an event that passes here passes there, and one refused here is
// refused there. The payments module's route itself, with the database, is driven by
// `tests/payments/webhook-forgery.spec.ts` through `tests/support/gateway-stand-in.ts`; a kernel spec
// imports no module, so the receiver's path is this file's own.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { piasters } from '@ijazah/money';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createGatewayStandIn,
  FORGERIES,
  type GatewayStandIn,
  type StandInEvent,
} from './gateway-stand-in.fixtures.js';
import { createPaymentPort, type PaymentConfig } from './index.js';
import { EventSignatureError, type GatewayEvent, type PaymentPort } from './payment.port.js';

const KEY = Buffer.alloc(32, 9).toString('base64');
const CONFIG: PaymentConfig = { PAYMENT_GATEWAY: 'fake', PAYMENT_MODE: 'test', ENCRYPTION_KEY: KEY };
const WEBHOOK_PATH = '/receiver';
const PAY_BY = new Date('2099-01-01T00:00:00Z');

/** What reached the receiver, in arrival order: the verified event, or the refusal's status. */
interface Arrival {
  readonly status: number;
  readonly event?: GatewayEvent;
  readonly rawBody: Buffer;
  readonly signature: string | undefined;
}

const arrivals: Arrival[] = [];
let server: Server;
let origin: string;
let payment: PaymentPort;
let stand: GatewayStandIn;

function receiver(verifier: PaymentPort) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers[name] = value;
      }
      const answer = (status: number, event?: GatewayEvent): void => {
        arrivals.push({
          status,
          rawBody,
          signature: headers['x-fake-signature'],
          ...(event === undefined ? {} : { event }),
        });
        response.statusCode = status;
        response.end();
      };
      if (request.url !== WEBHOOK_PATH || request.method !== 'POST') {
        answer(404);
        return;
      }
      verifier.verifyAndParseEvent(rawBody, headers).then(
        (event) => answer(200, event),
        (error: unknown) => answer(error instanceof EventSignatureError ? 401 : 400),
      );
    });
  };
}

beforeAll(async () => {
  server = createServer(receiver(createPaymentPort(CONFIG)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  payment = createPaymentPort(CONFIG);
  stand = createGatewayStandIn({ origin, webhookPath: WEBHOOK_PATH, config: CONFIG, payment });
});

afterAll(async () => {
  await new Promise((resolve) =>
    server === undefined ? resolve(undefined) : server.close(resolve),
  );
});

beforeEach(() => {
  arrivals.length = 0;
});

async function order(gross = 25_000): Promise<string> {
  return (await payment.createCheckout('enr-1', piasters(gross), 'EGP', PAY_BY)).gatewayOrderId;
}

const idOf = (event: StandInEvent): string =>
  (JSON.parse(event.rawBody.toString('utf8')) as { id: string }).id;

describe('the harness builds signed events the webhook accepts (T013, R-213)', () => {
  it('paid: the order’s gross and currency, a transaction, and the fee and net as reported', async () => {
    const gatewayOrderId = await order(25_000);
    const event = stand.paid(gatewayOrderId, {
      gateway_fee_piasters: piasters(750),
      net_piasters: piasters(24_250),
    });

    expect(await stand.deliver(event)).toBe(200);
    expect(arrivals.map((arrival) => arrival.event)).toEqual([
      {
        type: 'paid',
        providerEventId: event.providerEventId,
        gatewayOrderId,
        gatewayTransactionId: expect.stringMatching(/^fake_txn_/),
        gross_piasters: 25_000,
        gateway_fee_piasters: 750,
        net_piasters: 24_250,
        currency: 'EGP',
      },
    ]);
  });

  it('paid with nothing reported: no fee and the whole gross as net, as the stand-in reports', async () => {
    const gatewayOrderId = await order(10_000);

    await stand.deliver(stand.paid(gatewayOrderId));

    expect(arrivals[0]?.event).toMatchObject({ gateway_fee_piasters: 0, net_piasters: 10_000 });
  });

  it.each(['failed', 'expired'] as const)('%s: the order’s event', async (type) => {
    const gatewayOrderId = await order();
    const event = stand[type](gatewayOrderId);

    expect(await stand.deliver(event)).toBe(200);
    expect(arrivals.map((arrival) => arrival.event)).toEqual([
      { type, providerEventId: event.providerEventId, gatewayOrderId },
    ]);
  });

  // 003:T102 (DEC-82, Q-2 (a)): a refund child's amount, a part or the whole order (a void), and the
  // parent's flag with no amount.
  it('refunded: the order’s event with the refund’s amount, a part or the whole order', async () => {
    const gatewayOrderId = await order(25_000);
    const part = stand.refunded(gatewayOrderId, piasters(7_500));
    const whole = stand.refunded(gatewayOrderId, 'whole_order');

    expect(await stand.deliverInOrder([part, whole])).toEqual([200, 200]);
    expect(arrivals.map((arrival) => arrival.event)).toEqual([
      {
        type: 'refunded',
        providerEventId: part.providerEventId,
        gatewayOrderId,
        refunded_piasters: 7_500,
      },
      {
        type: 'refunded',
        providerEventId: whole.providerEventId,
        gatewayOrderId,
        refunded_piasters: 'whole_order',
      },
    ]);
  });

  it('refundReported: the order’s reported refund, with no amount', async () => {
    const gatewayOrderId = await order();
    const event = stand.refundReported(gatewayOrderId);

    expect(await stand.deliver(event)).toBe(200);
    expect(arrivals.map((arrival) => arrival.event)).toEqual([
      { type: 'refund_reported', providerEventId: event.providerEventId, gatewayOrderId },
    ]);
  });

  it('recipientVerified and recipientRejected, with and without a reason, for any reference', async () => {
    const recipientRef = 'fake_rcp_registered_by_another_process';
    const verified = stand.recipientVerified(recipientRef);
    const rejected = stand.recipientRejected(recipientRef, 'name mismatch');
    const bare = stand.recipientRejected(recipientRef);

    expect(await stand.deliverInOrder([verified, rejected, bare])).toEqual([200, 200, 200]);
    expect(arrivals.map((arrival) => arrival.event)).toEqual([
      { type: 'recipient_verified', providerEventId: verified.providerEventId, recipientRef },
      {
        type: 'recipient_rejected',
        providerEventId: rejected.providerEventId,
        recipientRef,
        reason: 'name mismatch',
      },
      { type: 'recipient_rejected', providerEventId: bare.providerEventId, recipientRef },
    ]);
  });

  it('gives every event a fresh provider event id, unless one is named', async () => {
    const gatewayOrderId = await order();
    const events = [
      stand.paid(gatewayOrderId),
      stand.paid(gatewayOrderId),
      stand.failed(gatewayOrderId),
      stand.recipientVerified('fake_rcp_1'),
      stand.recipientVerified('fake_rcp_1'),
    ];

    expect(new Set(events.map((event) => event.providerEventId)).size).toBe(events.length);
    for (const event of events) expect(idOf(event)).toBe(event.providerEventId);
    expect(
      stand.recipientVerified('fake_rcp_1', { eventId: 'fake_evt_named' }).providerEventId,
    ).toBe('fake_evt_named');
    expect(
      idOf(stand.recipientRejected('fake_rcp_1', 'closed', { eventId: 'fake_evt_named_2' })),
    ).toBe('fake_evt_named_2');
  });

  it('refuses an order the stand-in did not create', () => {
    expect(() => stand.paid('fake_ord_nobody_created')).toThrow(/unknown order/);
  });

  it('refuses an order event and onCancel without the stand-in as the port', async () => {
    const recipientsOnly = createGatewayStandIn({
      origin,
      webhookPath: WEBHOOK_PATH,
      config: CONFIG,
    });
    const anotherGateway: PaymentPort = {
      createCheckout: () => Promise.reject(new Error('unused')),
      cancelCheckout: () => Promise.reject(new Error('unused')),
      verifyAndParseEvent: () => Promise.reject(new Error('unused')),
      registerPayoutRecipient: () => Promise.reject(new Error('unused')),
      getRecipientStatus: () => Promise.reject(new Error('unused')),
    };
    const elsewhere = createGatewayStandIn({
      origin,
      webhookPath: WEBHOOK_PATH,
      config: CONFIG,
      payment: anotherGateway,
    });
    const gatewayOrderId = await order();

    expect(() => recipientsOnly.paid(gatewayOrderId)).toThrow(/stand-in/);
    expect(() => recipientsOnly.onCancel(gatewayOrderId, 'paid')).toThrow(/stand-in/);
    expect(() => elsewhere.expired(gatewayOrderId)).toThrow(/stand-in/);
    expect(recipientsOnly.recipientVerified('fake_rcp_1').providerEventId).toMatch(/^fake_evt_/);
  });
});

describe('the harness delivers over HTTP (T013, SC-311)', () => {
  it('deliver resolves with the status the webhook answered', async () => {
    const elsewhere = createGatewayStandIn({
      origin,
      webhookPath: '/not-the-webhook',
      config: CONFIG,
    });

    expect(await elsewhere.deliver(elsewhere.recipientVerified('fake_rcp_1'))).toBe(404);
  });

  it('deliverTwice sends the same body and id twice', async () => {
    const event = stand.recipientVerified('fake_rcp_twice');

    expect(await stand.deliverTwice(event)).toEqual([200, 200]);
    expect(arrivals).toHaveLength(2);
    expect(arrivals[0]?.rawBody.equals(event.rawBody)).toBe(true);
    expect(arrivals[1]?.rawBody.equals(event.rawBody)).toBe(true);
    expect(arrivals.map((arrival) => arrival.event?.providerEventId)).toEqual([
      event.providerEventId,
      event.providerEventId,
    ]);
  });

  it('deliverInOrder sends in the order given, whatever order the events were built in', async () => {
    const gatewayOrderId = await order();
    const paid = stand.paid(gatewayOrderId);
    const failed = stand.failed(gatewayOrderId);

    expect(await stand.deliverInOrder([failed, paid])).toEqual([200, 200]);
    expect(arrivals.map((arrival) => arrival.event?.type)).toEqual(['failed', 'paid']);
  });

  it('deliverAfter runs the hook to its end before it sends the event (the note under T013)', async () => {
    const paid = stand.paid(await order());
    const seenByHook: number[] = [];
    const status = await stand.deliverAfter(paid, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      seenByHook.push(arrivals.length);
    });

    expect(status).toBe(200);
    expect(seenByHook).toEqual([0]);
    expect(arrivals.map((arrival) => arrival.event?.type)).toEqual(['paid']);
  });
});

describe('tamper: each forged variant is refused by the signature check (T013, FR-372, SC-311)', () => {
  const builders = [
    ['paid', async () => stand.paid(await order())],
    ['failed', async () => stand.failed(await order())],
    ['expired', async () => stand.expired(await order())],
    ['recipient_verified', () => Promise.resolve(stand.recipientVerified('fake_rcp_forged'))],
    [
      'recipient_rejected',
      () => Promise.resolve(stand.recipientRejected('fake_rcp_forged', 'name mismatch')),
    ],
  ] as const;

  it.each(builders.flatMap(([name, build]) => FORGERIES.map((how) => [name, how, build] as const)))(
    'a %s event, %s: 401',
    async (_name, how, build) => {
      const genuine = await build();
      const forged = stand.tamper(genuine, how);

      expect(await stand.deliver(forged)).toBe(401);
      expect(arrivals.map((arrival) => arrival.status)).toEqual([401]);
      expect(await stand.deliver(genuine)).toBe(200);
    },
  );

  it('wrong_secret: the same body under another signature', async () => {
    const genuine = stand.recipientVerified('fake_rcp_1');
    const forged = stand.tamper(genuine, 'wrong_secret');

    expect(forged.rawBody.equals(genuine.rawBody)).toBe(true);
    expect(forged.providerEventId).toBe(genuine.providerEventId);
    expect(forged.headers['x-fake-signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(forged.headers['x-fake-signature']).not.toBe(genuine.headers['x-fake-signature']);
  });

  it('no_signature: the same body with no signature header', () => {
    const genuine = stand.recipientVerified('fake_rcp_1');
    const forged = stand.tamper(genuine, 'no_signature');

    expect(forged.rawBody.equals(genuine.rawBody)).toBe(true);
    expect(Object.keys(forged.headers).map((name) => name.toLowerCase())).not.toContain(
      'x-fake-signature',
    );
  });

  it('body_changed: the genuine signature over the body changed after signing, under a new id', () => {
    const genuine = stand.recipientVerified('fake_rcp_1');
    const forged = stand.tamper(genuine, 'body_changed');

    expect(forged.headers).toEqual(genuine.headers);
    expect(forged.rawBody.equals(genuine.rawBody)).toBe(false);
    expect(forged.providerEventId).not.toBe(genuine.providerEventId);
    expect(idOf(forged)).toBe(forged.providerEventId);
  });
});

describe('onCancel (T013, R-213, FR-BOOK-12)', () => {
  it.each(['cancelled', 'paid', 'in_progress', 'unsupported'] as const)(
    'sets what cancelCheckout answers for that order alone: %s',
    async (outcome) => {
      const gatewayOrderId = await order();
      const other = await order();

      stand.onCancel(gatewayOrderId, outcome);

      expect(await payment.cancelCheckout(gatewayOrderId)).toBe(outcome);
      expect(await payment.cancelCheckout(other)).toBe('cancelled');
    },
  );
});
