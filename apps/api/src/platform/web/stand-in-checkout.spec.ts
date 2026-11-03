// T012: the stand-in's hosted page over real HTTP (contracts/gateway.md "The stand-in's hosted page",
// R-213, FR-372, FR-374). The application is built as `main.ts` builds it (`createApplication`) and
// listened on an ephemeral port; the page is mounted from the payment port the configuration selects,
// and its origin is the listening address, as `API_PUBLIC_ORIGIN` names it in development.
//
// What the page sends reaches `/webhooks/payment` of the same application over HTTP. There a
// receiver verifies it with `verifyAndParseEvent` of a second port built from the same configuration
// (as a second process of one deployment would), which is the operation the payments webhook calls
// (T077): an event that passes here passes there. The receiver stands in for the payments module's
// route because a kernel spec does not import a module; T013's harness drives the real one.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { piasters } from '@ijazah/money';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApplication } from '../../app.module.js';
import { RateLimiter } from '../guards/rate-limit.guard.js';
import { createLogger } from '../logging/logger.js';
import {
  createPaymentPort,
  standInWebhookSecret,
  type PaymentConfig,
} from '../ports/payment/index.js';
import type { GatewayEvent, PaymentPort } from '../ports/payment/payment.port.js';
import { SettingError, type SettingsReader } from '../settings/settings-reader.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCheckoutServices,
  unusedCatalogServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { PUBLIC_PAGE_CSP, PUBLIC_PAGE_RATE_LIMIT, type NodeHandler } from './route.js';
import { STAND_IN_CHECKOUT_PATH, standInCheckoutRoutes } from './stand-in-checkout.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const PAYABLE_UNTIL = new Date('2099-01-01T00:00:00Z');
const EXPIRED_AT = new Date('2020-01-01T00:00:00Z');
// The payments module's `PAYMENT_WEBHOOK_PATH` (T077), written out: a kernel spec imports no module.
const WEBHOOK_PATH = '/webhooks/payment';

const unused = () => Promise.reject(new Error('nothing here is expected to call it'));

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key !== PUBLIC_PAGE_RATE_LIMIT) throw new SettingError(key, 'missing');
    return schema.parse({ limit: 1000, window_seconds: 60 });
  },
};
const rateLimiter = new RateLimiter({
  settings,
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32, 1),
});

const records: string[] = [];
const log = createLogger({ level: 'info', destination: { write: (line) => records.push(line) } });

async function applicationWith(
  routes: Readonly<Record<string, NodeHandler>>,
): Promise<{ application: INestApplication; origin: string }> {
  const application = await createApplication({
    log,
    readiness: { databaseReachable: async () => {} },
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: 4096,
    administration: { transactions: { run: unused }, auditWriter: { write: unused } },
    rateLimiter,
    sessions: { user: async () => null, admin: async () => null },
    services: {
      settings: { read: unused },
      publicConfig: { supportEmail: 'support@ijazah.invalid' },
      subjects: { listActive: async () => [] },
      identity: unusedIdentityServices,
      verification: unusedVerificationServices,
      catalog: unusedCatalogServices,
      teacherProfile: unusedTeacherProfileServices,
      discovery: unusedDiscoveryServices,
      booking: unusedBookingServices,
      checkout: unusedCheckoutServices,
    },
    adminServices: unusedAdminServices,
    routes,
  });
  await application.listen(0, '127.0.0.1');
  return { application, origin: (await application.getUrl()).replace('[::1]', '127.0.0.1') };
}

/** What reached the webhook: each verified event, and every signature header it carried. */
const delivered: GatewayEvent[] = [];
const signatures: string[] = [];
let webhookAnswers = 200;

function receiverOver(receiver: PaymentPort): NodeHandler {
  return (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers[name] = value;
      }
      signatures.push(headers['x-fake-signature'] ?? '');
      receiver
        .verifyAndParseEvent(Buffer.concat(chunks), headers)
        .then((event) => {
          if (request.method === 'POST' && webhookAnswers === 200) delivered.push(event);
          response.statusCode = webhookAnswers;
          response.end('{"received":true}');
        })
        .catch(() => {
          response.statusCode = 401;
          response.end();
        });
    });
  };
}

let application: INestApplication;
let origin: string;
let config: PaymentConfig;
let payment: PaymentPort;

beforeAll(async () => {
  // The page is bound once the origin is known: the routes are mounted before the port exists.
  let page: NodeHandler = () => {
    throw new Error('the page is bound after listening');
  };
  let webhook: NodeHandler = page;
  ({ application, origin } = await applicationWith({
    [STAND_IN_CHECKOUT_PATH]: (request, response) => page(request, response),
    [WEBHOOK_PATH]: (request, response) => webhook(request, response),
  }));
  config = { PAYMENT_GATEWAY: 'fake', ENCRYPTION_KEY: KEY, API_PUBLIC_ORIGIN: origin };
  payment = createPaymentPort(config);
  webhook = receiverOver(createPaymentPort(config));
  const routes = standInCheckoutRoutes({ payment, rateLimiter, log });
  const mounted = routes[STAND_IN_CHECKOUT_PATH];
  if (mounted === undefined) throw new Error('the stand-in was not mounted');
  page = mounted;
});

afterAll(async () => {
  await application?.close();
});

beforeEach(() => {
  delivered.length = 0;
  webhookAnswers = 200;
});

async function order(gross = 25_000, expiresAt = PAYABLE_UNTIL) {
  return payment.createCheckout('enr-1', piasters(gross), 'EGP', expiresAt);
}

function post(checkoutUrl: string, body: string): Promise<Response> {
  return fetch(checkoutUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe("the stand-in's hosted page: what it shows (T012, R-213)", () => {
  it('is the address createCheckout answers, showing the amount and the three choices', async () => {
    const { checkoutUrl, gatewayOrderId } = await order();

    expect(checkoutUrl).toBe(`${origin}${STAND_IN_CHECKOUT_PATH}/${gatewayOrderId}`);
    const response = await fetch(checkoutUrl);
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(PUBLIC_PAGE_CSP);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(page).toContain('lang="ar" dir="rtl"');
    expect(page).toContain('25000');
    expect(page).toContain('EGP');
    expect(page).toContain(gatewayOrderId);
    for (const [action, label] of [
      ['pay', 'ادفع'],
      ['fail', 'فشل الدفع'],
      ['cancel', 'إلغاء'],
    ]) {
      expect(page).toContain(`name="action" value="${action}"`);
      expect(page).toContain(label);
    }
    expect(page.match(/<form method="post">/g)).toHaveLength(3);
  });

  it('shows the English words on ?lang=en', async () => {
    const { checkoutUrl } = await order();

    const page = await (await fetch(`${checkoutUrl}?lang=en`)).text();

    expect(page).toContain('lang="en" dir="ltr"');
    expect(page).toContain('Pay');
    expect(page).toContain('Fail the payment');
    expect(page).toContain('Cancel');
  });

  it('carries no secret: neither the signing secret, the key it derives from, nor a signature', async () => {
    const { checkoutUrl } = await order();

    const page = await (await fetch(checkoutUrl)).text();

    expect(page).not.toContain(standInWebhookSecret(config));
    expect(page).not.toContain(KEY);
    expect(page).not.toMatch(/[0-9a-f]{64}/);
  });

  it('answers an order it never created as one that cannot be paid, escaping the id it echoes', async () => {
    const response = await fetch(
      `${origin}${STAND_IN_CHECKOUT_PATH}/${encodeURIComponent('<script>alert(1)</script>')}`,
    );
    const page = await response.text();

    expect(response.status).toBe(404);
    expect(page).toContain('لا يمكن دفع هذا الطلب');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).not.toContain('<script>');
    expect(page).not.toContain('name="action"');
  });

  it('answers an expired order as one that cannot be paid', async () => {
    const { checkoutUrl } = await order(100, EXPIRED_AT);

    const response = await fetch(checkoutUrl);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('name="action"');
  });

  it.each([STAND_IN_CHECKOUT_PATH, `${STAND_IN_CHECKOUT_PATH}/`, `${STAND_IN_CHECKOUT_PATH}/a/b`])(
    'answers %s, which names no single order, with 404',
    async (path) => {
      const response = await fetch(`${origin}${path}`);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('name="action"');
    },
  );
});

describe("the stand-in's hosted page: what it sends (T012, FR-372, FR-374)", () => {
  // The amounts the paid event reports are `fake.adapter.spec.ts`'s: a kernel file outside the
  // payment port does not name a gateway amount (R-MONEY-6).
  it('pays: a signed paid event with its transaction reaches the webhook', async () => {
    const { checkoutUrl, gatewayOrderId } = await order(25_000);

    const response = await post(checkoutUrl, 'action=pay');
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(page).toContain('href="ijazah://checkout/return"');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      type: 'paid',
      gatewayOrderId,
      gatewayTransactionId: expect.stringMatching(/^fake_txn_/),
      currency: 'EGP',
      providerEventId: expect.stringMatching(/^fake_evt_/),
    });
  });

  it.each([
    ['fail', 'failed'],
    ['cancel', 'failed'],
  ])('%s: a signed %s event reaches the webhook', async (action, type) => {
    const { checkoutUrl, gatewayOrderId } = await order();

    const response = await post(checkoutUrl, `action=${action}`);

    expect(response.status).toBe(200);
    expect(delivered).toEqual([
      { type, gatewayOrderId, providerEventId: expect.stringMatching(/^fake_evt_/) },
    ]);
  });

  it('an order acted on once cannot be paid again, and sends nothing more', async () => {
    const { checkoutUrl } = await order();
    await post(checkoutUrl, 'action=pay');

    const again = await post(checkoutUrl, 'action=pay');
    const shown = await fetch(checkoutUrl);

    expect(again.status).toBe(404);
    expect(await again.text()).toContain('لا يمكن دفع هذا الطلب');
    expect(shown.status).toBe(404);
    expect(delivered).toHaveLength(1);
  });

  it('sends nothing for an expired order', async () => {
    const { checkoutUrl } = await order(100, EXPIRED_AT);

    const response = await post(checkoutUrl, 'action=pay');

    expect(response.status).toBe(404);
    expect(delivered).toHaveLength(0);
  });

  it.each(['action=refund', 'action=', ''])(
    'refuses %j with 400, sending nothing and leaving the order payable',
    async (body) => {
      const { checkoutUrl } = await order();

      const response = await post(checkoutUrl, body);

      expect(response.status).toBe(400);
      expect(delivered).toHaveLength(0);
      expect((await fetch(checkoutUrl)).status).toBe(200);
    },
  );

  it('says the delivery failed when the webhook refuses it', async () => {
    const { checkoutUrl } = await order();
    webhookAnswers = 500;

    const response = await post(checkoutUrl, 'action=pay');

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('ijazah://checkout/return');
  });

  it('writes no secret, signature or event body to a log', () => {
    const lines = records.join('\n');

    expect(signatures.length).toBeGreaterThan(0);
    expect(lines).not.toContain(standInWebhookSecret(config));
    for (const signature of signatures) expect(lines).not.toContain(signature);
    expect(lines).not.toContain('fake_txn_');
    expect(lines).not.toContain('fake_evt_');
  });
});

describe("the stand-in's hosted page exists only with the stand-in (T012, R-213)", () => {
  const anotherGateway: PaymentPort = {
    createCheckout: unused,
    cancelCheckout: unused,
    verifyAndParseEvent: unused,
    registerPayoutRecipient: unused,
    getRecipientStatus: unused,
  };

  it('mounts nothing for another gateway', () => {
    expect(standInCheckoutRoutes({ payment: anotherGateway, rateLimiter, log })).toEqual({});
  });

  it('answers 404 at the page’s path for another gateway, GET and POST alike', async () => {
    const other = await applicationWith(
      standInCheckoutRoutes({ payment: anotherGateway, rateLimiter, log }),
    );
    try {
      const shown = await fetch(`${other.origin}${STAND_IN_CHECKOUT_PATH}/fake_ord_1`);
      const posted = await post(
        `${other.origin}${STAND_IN_CHECKOUT_PATH}/fake_ord_1`,
        'action=pay',
      );

      expect(shown.status).toBe(404);
      expect(await shown.text()).not.toContain('name="action"');
      expect(posted.status).toBe(404);
    } finally {
      await other.application.close();
    }
  });
});
