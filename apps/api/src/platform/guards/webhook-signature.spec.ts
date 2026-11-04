// T133: the webhook signature guard (FR-074, R-MONEY-9; ARCHITECTURE §8.1 step 1).
//
// Each case is a real HTTP request to a Nest application built here, whose one route stands where
// the payments webhook will (Phase 2): the raw body is captured untouched, the guard verifies it
// through the payment stand-in, and only then does the handler run. The stand-in is reached through
// the payment port's entry, as every caller reaches it, because only the port's own folder may name
// its adapter (R-API-4); so its events are written here in the stand-in's own form, a JSON body
// signed by HMAC-SHA256 in `x-fake-signature` (note under T117), under its webhook secret for a
// valid signature and under another for an invalid one. An order event that carries no amount is
// used, since amounts are named only inside the payment folders (R-MONEY-6). The handler records every call,
// so "before any handler" is asserted as "the handler was never called". Failures leave in the
// kernel's one shape through `mapError` (T101).
//
// Statuses: an unsigned or incorrectly signed event, an altered body, and any other failure of the
// verifier answer 401 `UNAUTHENTICATED` (ARCHITECTURE §8.1: "bad signature → 401"); a correctly
// signed body the port cannot read answers 400 `VALIDATION_FAILED`; a raw body the route never
// captured is the server's own fault and answers 500 `INTERNAL`.
import { createHmac, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { piasters } from '@ijazah/money';
import {
  type ArgumentsHost,
  Catch,
  Controller,
  type ExceptionFilter,
  type INestApplication,
  Module,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapError } from '../errors/error-filter.js';
import { createPaymentPort } from '../ports/payment/index.js';
import type { GatewayEvent } from '../ports/payment/payment.port.js';
import {
  verifiedEventOf,
  verifyInboundEvent,
  type WebhookRequest,
  WebhookSignatureGuard,
} from './webhook-signature.guard.js';

const SECRET = 'stand-in-webhook-secret';
const PAY_BY = new Date('2026-10-08T10:30:00Z');

const gateway = createPaymentPort({
  PAYMENT_GATEWAY: 'fake',
  PAYMENT_GATEWAY_WEBHOOK_SECRET: SECRET,
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});
const handled: GatewayEvent[] = [];

@Controller('webhooks')
class WebhookFixture {
  @Post('payment')
  @UseGuards(
    new WebhookSignatureGuard((rawBody, headers) => gateway.verifyAndParseEvent(rawBody, headers)),
  )
  receive(@Req() request: WebhookRequest): { received: true } {
    handled.push(verifiedEventOf<GatewayEvent>(request));
    return { received: true };
  }

  // A route whose raw body nobody captured: a wiring mistake, never a pass.
  @Post('uncaptured')
  @UseGuards(
    new WebhookSignatureGuard((rawBody, headers) => gateway.verifyAndParseEvent(rawBody, headers)),
  )
  uncaptured(@Req() request: WebhookRequest): { received: true } {
    handled.push(verifiedEventOf<GatewayEvent>(request));
    return { received: true };
  }
}

@Module({ controllers: [WebhookFixture] })
class WebhookFixtureModule {}

@Catch()
class OneShape implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const mapped = mapError(exception);
    const response = host.switchToHttp().getResponse<ServerResponse>();
    response.statusCode = mapped.status;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: mapped.body }));
  }
}

/** What the payments webhook route will do before the guard: keep the body exactly as it came. */
function captureRawBody(
  request: IncomingMessage,
  _response: ServerResponse,
  next: () => void,
): void {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    (request as WebhookRequest).rawBody = Buffer.concat(chunks);
    next();
  });
}

let application: INestApplication;
let origin: string;

beforeAll(async () => {
  application = await NestFactory.create(WebhookFixtureModule, {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  application.use('/webhooks/payment', captureRawBody);
  application.useGlobalFilters(new OneShape());
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application?.close();
});

async function post(
  path: string,
  rawBody: Buffer,
  headers: Readonly<Record<string, string>>,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
  });
  return { status: response.status, text: await response.text() };
}

function signedBy(secret: string, text: string) {
  const rawBody = Buffer.from(text);
  return {
    rawBody,
    headers: { 'x-fake-signature': createHmac('sha256', secret).update(rawBody).digest('hex') },
  };
}

/** The gateway reporting a failed payment on an order the stand-in created. */
async function failedEvent(secret: string = SECRET) {
  const { gatewayOrderId } = await gateway.createCheckout('enr-1', piasters(25_000), 'EGP', PAY_BY);
  const body = JSON.stringify({
    id: `fake_evt_${randomUUID()}`,
    type: 'failed',
    order: gatewayOrderId,
  });
  return { gatewayOrderId, ...signedBy(secret, body) };
}

const unauthenticated = {
  error: { code: 'UNAUTHENTICATED', message: 'The event signature is absent or invalid.' },
};

describe('the webhook signature guard (T133, FR-074, R-MONEY-9)', () => {
  it('lets a correctly signed event through, handing the handler the verified event', async () => {
    handled.length = 0;
    const { gatewayOrderId, rawBody, headers } = await failedEvent();

    const response = await post('/webhooks/payment', rawBody, headers);

    expect(response.status).toBe(201);
    expect(handled).toEqual([expect.objectContaining({ type: 'failed', gatewayOrderId })]);
  });

  it.each([
    ['an incorrectly signed event', async () => failedEvent('another-secret')],
    ['an unsigned event', async () => ({ ...(await failedEvent()), headers: {} })],
    [
      'an altered body',
      async () => {
        const event = await failedEvent();
        const altered = event.rawBody.toString('utf8').replace('failed', 'expired');
        return { ...event, rawBody: Buffer.from(altered) };
      },
    ],
    [
      'a signature that is not hexadecimal',
      async () => ({
        ...(await failedEvent()),
        headers: { 'x-fake-signature': 'not-a-signature' },
      }),
    ],
  ])('refuses %s with 401 before any handler runs', async (_case, make) => {
    handled.length = 0;
    const { rawBody, headers } = await make();

    const response = await post('/webhooks/payment', rawBody, headers);

    expect(response.status).toBe(401);
    expect(JSON.parse(response.text)).toEqual(unauthenticated);
    expect(handled).toEqual([]);
  });

  it('refuses a correctly signed body it cannot read with 400, quoting nothing of it', async () => {
    handled.length = 0;
    const { rawBody, headers } = signedBy(
      SECRET,
      '{"type":"chargeback","card":"4111111111111111"}',
    );

    const response = await post('/webhooks/payment', rawBody, headers);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.text)).toEqual({
      error: { code: 'VALIDATION_FAILED', message: 'The event could not be read.' },
    });
    expect(response.text).not.toContain('4111');
    expect(handled).toEqual([]);
  });

  it('answers 500 when the route captured no raw body, and never runs the handler', async () => {
    handled.length = 0;
    const { rawBody, headers } = await failedEvent();

    const response = await post('/webhooks/uncaptured', rawBody, headers);

    expect(response.status).toBe(500);
    expect(JSON.parse(response.text)).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong. Try again later.' },
    });
    expect(handled).toEqual([]);
  });

  it('never echoes the signature or the body in a refusal', async () => {
    const { rawBody, headers } = await failedEvent('another-secret');

    const response = await post('/webhooks/payment', rawBody, headers);

    expect(response.text).not.toContain(headers['x-fake-signature']);
    expect(response.text).not.toContain('fake_ord_');
  });
});

describe('verifying an inbound event (T133; review of PR #45, m1)', () => {
  const rawBody = Buffer.from('{}');

  it('treats a verifier that throws synchronously as a refusal', async () => {
    const throwing = (): Promise<never> => {
      throw new SyntaxError('Unexpected token, "{}" is not valid JSON');
    };

    await expect(verifyInboundEvent(throwing, rawBody, {})).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('treats any other rejection, such as a provider failure, as a refusal, keeping nothing of it', async () => {
    const failing = (): Promise<never> =>
      Promise.reject(new Error('gateway key fetch timed out for {"order":"fake_ord_1"}'));

    const refusal = verifyInboundEvent(failing, rawBody, {});

    await expect(refusal).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(refusal).rejects.toHaveProperty('cause', undefined);
    await expect(refusal).rejects.not.toThrow('fake_ord_1');
  });

  it('passes the verifier only single-valued headers, as the request carried them', async () => {
    let seen: Readonly<Record<string, string | undefined>> = {};
    await verifyInboundEvent(
      (_raw, headers) => {
        seen = headers;
        return Promise.resolve('ok');
      },
      rawBody,
      { 'x-fake-signature': 'abc', 'set-cookie': ['a', 'b'], absent: undefined },
    );

    expect(seen).toEqual({ 'x-fake-signature': 'abc' });
  });

  it("passes the verifier the request target's single-valued query parameters, none without one (T056)", async () => {
    const seen: Readonly<Record<string, string | undefined>>[] = [];
    const verify = (
      _raw: Buffer,
      _headers: Readonly<Record<string, string | undefined>>,
      query: Readonly<Record<string, string | undefined>>,
    ): Promise<string> => {
      seen.push(query);
      return Promise.resolve('ok');
    };

    await verifyInboundEvent(verify, rawBody, {}, '/webhooks/payment?hmac=ab%2012&x=1&x=2&empty=');
    await verifyInboundEvent(verify, rawBody, {});

    expect(seen).toEqual([{ hmac: 'ab 12', empty: '' }, {}]);
  });
});
