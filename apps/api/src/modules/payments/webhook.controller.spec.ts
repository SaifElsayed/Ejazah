// T077, the payments half: `POST /webhooks/payment`, the raw-body route outside tRPC (FR-PAYG-4,
// R-MONEY-9; ARCHITECTURE §8.1 steps 1 and 2; the guard's header in
// `platform/guards/webhook-signature.guard.ts`).
//
// Each case is a real HTTP request to a Nest application mounted as `main.ts` mounts its routes (the
// body parser off, the handler under its path), over the payment port's stand-in reached through the
// port's entry, as every caller reaches it (R-API-4). Its events are written here in the stand-in's
// own form, a JSON body signed by HMAC-SHA256 in `x-fake-signature`, as the guard's spec writes
// them. What the route hands the event to is a recorder, one per service: what a recipient event does
// is `recipient-events.spec.ts`'s, what an order event does `tests/payments/order-events.spec.ts`'s
// (T038). The log is captured line by line, so "nothing of the body is
// logged" is a sweep over every line.
//
// Statuses: a recorded or replayed event 200; an absent or wrong signature 401; a signed body the
// port cannot read 400; a body over the limit 413, before it is verified; any other method 405; a
// path below the route 404; a failure while recording 500, so the gateway retries.
import { createHmac, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';

import { type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createLogger } from '../../platform/logging/logger.js';
import { createPaymentPort } from '../../platform/ports/payment/index.js';
import type { GatewayEvent } from '../../platform/ports/payment/payment.port.js';
import type { Receipt, RecordOutcome } from './recipient-events.service.js';
import { PAYMENT_WEBHOOK_PATH, paymentWebhookRoute } from './webhook.controller.js';

const SECRET = 'stand-in-webhook-secret';
const MAX_BODY_BYTES = 2048;

const port = createPaymentPort({
  PAYMENT_GATEWAY: 'fake',
  PAYMENT_GATEWAY_WEBHOOK_SECRET: SECRET,
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});

interface Recorded {
  readonly service: 'recipients' | 'orders';
  readonly event: GatewayEvent;
  readonly receipt: Receipt;
}

const recorded: Recorded[] = [];
const lines: string[] = [];
let answer: () => Promise<RecordOutcome> = () => Promise.resolve('applied');

@Module({})
class EmptyModule {}

let application: INestApplication;
let origin: string;

beforeAll(async () => {
  application = await NestFactory.create(EmptyModule, {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  application.use(
    PAYMENT_WEBHOOK_PATH,
    paymentWebhookRoute({
      verify: (rawBody, headers) => port.verifyAndParseEvent(rawBody, headers),
      events: {
        recipients: {
          record: (event, receipt) => {
            recorded.push({ service: 'recipients', event, receipt });
            return answer();
          },
        },
        orders: {
          record: async (event, receipt) => {
            recorded.push({ service: 'orders', event, receipt });
            await answer();
            return 'moved';
          },
        },
      },
      log: createLogger({ level: 'info', destination: { write: (line) => void lines.push(line) } }),
      maxBodyBytes: MAX_BODY_BYTES,
    }),
  );
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application?.close();
});

beforeEach(() => {
  recorded.length = 0;
  lines.length = 0;
  answer = () => Promise.resolve('applied');
});

const RECIPIENT = 'fake_rcp_0193d1b0-7a4e-7c55-9d2f-3b1e8a6c4f21';

function signed(body: object | string, secret = SECRET) {
  const rawBody = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    rawBody,
    headers: { 'x-fake-signature': createHmac('sha256', secret).update(rawBody).digest('hex') },
  };
}

function verifiedEvent(reason?: string) {
  const id = `fake_evt_${randomUUID()}`;
  return signed(
    reason === undefined
      ? { id, type: 'recipient_verified', recipient: RECIPIENT }
      : { id, type: 'recipient_rejected', recipient: RECIPIENT, reason },
  );
}

async function post(
  rawBody: Buffer,
  headers: Readonly<Record<string, string>>,
  path = PAYMENT_WEBHOOK_PATH,
): Promise<{ status: number; text: string; headers: Headers }> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: new Uint8Array(rawBody),
  });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

/** Nothing of a body, a signature or a reference is in any log line. */
function expectNothingLogged(...texts: string[]): void {
  for (const line of lines) {
    for (const text of texts) expect(line).not.toContain(text);
  }
}

describe(`POST ${PAYMENT_WEBHOOK_PATH} (T077, FR-PAYG-4, R-MONEY-9)`, () => {
  it('hands a correctly signed recipient event to the payments module with its raw body, and answers 200', async () => {
    const { rawBody, headers } = verifiedEvent('name mismatch');

    const response = await post(rawBody, headers);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual({ received: true });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.service).toBe('recipients');
    expect(recorded[0]?.event).toMatchObject({
      type: 'recipient_rejected',
      recipientRef: RECIPIENT,
      reason: 'name mismatch',
    });
    expect(recorded[0]?.receipt.rawBody.equals(rawBody)).toBe(true);
    expect(recorded[0]?.receipt.receivedAt).toBeInstanceOf(Date);
    expect(recorded[0]?.receipt.signatureVerifiedAt).toBeInstanceOf(Date);
    expect(recorded[0]!.receipt.signatureVerifiedAt.getTime()).toBeGreaterThanOrEqual(
      recorded[0]!.receipt.receivedAt.getTime(),
    );
  });

  it('hands a correctly signed order event to the order branch (T038), and answers 200', async () => {
    const { rawBody, headers } = signed({
      id: `fake_evt_${randomUUID()}`,
      type: 'failed',
      order: 'fake_ord_0193d1b0',
    });

    expect((await post(rawBody, headers)).status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.service).toBe('orders');
    expect(recorded[0]?.event).toMatchObject({
      type: 'failed',
      gatewayOrderId: 'fake_ord_0193d1b0',
    });
    expect(recorded[0]?.receipt.rawBody.equals(rawBody)).toBe(true);
  });

  it.each(['replayed', 'unmatched'] as const)(
    'acknowledges an event the payments module answered %s with 200, so the gateway stops retrying',
    async (outcome) => {
      answer = () => Promise.resolve(outcome);
      const { rawBody, headers } = verifiedEvent();

      expect((await post(rawBody, headers)).status).toBe(200);
    },
  );

  it.each([
    [
      'an incorrectly signed event',
      () => signed(verifiedEvent().rawBody.toString('utf8'), 'another-secret'),
    ],
    ['an unsigned event', () => ({ ...verifiedEvent(), headers: {} })],
  ])('refuses %s with 401, handing nothing on and logging nothing of it', async (_case, make) => {
    const { rawBody, headers } = make();

    const response = await post(rawBody, headers);

    expect(response.status).toBe(401);
    expect(JSON.parse(response.text)).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'The event signature is absent or invalid.' },
    });
    expect(recorded).toEqual([]);
    expectNothingLogged(RECIPIENT, rawBody.toString('utf8'));
  });

  it('refuses a correctly signed body the port cannot read with 400, quoting nothing of it', async () => {
    const { rawBody, headers } = signed('{"type":"chargeback","card":"4111111111111111"}');

    const response = await post(rawBody, headers);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.text)).toEqual({
      error: { code: 'VALIDATION_FAILED', message: 'The event could not be read.' },
    });
    expect(recorded).toEqual([]);
    expectNothingLogged('4111111111111111');
  });

  it('refuses a body declared over the limit with 413 before reading or verifying it', async () => {
    const { rawBody, headers } = signed({
      id: `fake_evt_${randomUUID()}`,
      type: 'recipient_verified',
      recipient: 'x'.repeat(MAX_BODY_BYTES),
    });

    const response = await post(rawBody, headers);

    expect(response.status).toBe(413);
    expect(JSON.parse(response.text)).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(recorded).toEqual([]);
  });

  it('refuses a streamed body that grows over the limit with 413, declaring no length', async () => {
    const chunk = Buffer.alloc(512, 0x61);
    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest(`${origin}${PAYMENT_WEBHOOK_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
      });
      outgoing.on('response', (incoming) => {
        incoming.resume();
        resolve(incoming.statusCode ?? 0);
      });
      // The route closes the socket after its answer; the remaining chunks may meet a closed pipe.
      outgoing.on('error', (error) => (outgoing.writableEnded ? undefined : reject(error)));
      for (let sent = 0; sent <= MAX_BODY_BYTES; sent += chunk.length) outgoing.write(chunk);
      outgoing.end();
    });

    expect(status).toBe(413);
    expect(recorded).toEqual([]);
  });

  it('answers any other method with 405, naming POST', async () => {
    const response = await fetch(`${origin}${PAYMENT_WEBHOOK_PATH}`);

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(recorded).toEqual([]);
  });

  it('answers a path below the route with 404', async () => {
    const { rawBody, headers } = verifiedEvent();

    const response = await post(rawBody, headers, `${PAYMENT_WEBHOOK_PATH}/extra`);

    expect(response.status).toBe(404);
    expect(recorded).toEqual([]);
  });

  it('answers 500 when recording fails, so the gateway retries, and logs the failure without the body', async () => {
    answer = () => Promise.reject(new Error('the database is unreachable'));
    const { rawBody, headers } = verifiedEvent('closed account');

    const response = await post(rawBody, headers);

    expect(response.status).toBe(500);
    expect(JSON.parse(response.text)).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong. Try again later.' },
    });
    expect(lines.some((line) => line.includes('the database is unreachable'))).toBe(true);
    expectNothingLogged(RECIPIENT, 'closed account', headers['x-fake-signature']);
  });
});
