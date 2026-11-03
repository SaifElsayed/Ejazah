// T075, the payments half (FR-191, FR-PAYG-4, FR-PAYG-15, R-MONEY-8, R-114, R-121): a signed
// recipient event is recorded once in `payment_events` and hands its verdict to the identity
// module's two entries, on the same transaction, by the hash of the reference it carries.
//
// T013 (R-213, SC-302): every event comes from the gateway stand-in's harness
// (`platform/ports/payment/gateway-stand-in.fixtures.ts`, the test tree's
// `tests/support/gateway-stand-in.ts`) and reaches the service through the real webhook route over
// HTTP, mounted under `PAYMENT_WEBHOOK_PATH`, its signature checked on the raw body; no case hands
// the service an event. What the service answered is the route's 200 (or 500 on a failure), so each
// case reads its effect: the rows, identity's calls, the report and the log.
//
// Over the real database (the pipeline's migrated Postgres, as the identity specs run) and with the
// identity entries injected as recorders, so this spec proves what the payments module does and
// nothing of what identity does with the verdict (lane A of B15 holds those specs). Each event id
// is fresh, so specs running together never meet. The log is captured line by line and the error
// reporting recorded, so "nothing of the raw body is logged" is a sweep over both.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { piasters } from '@ijazah/money';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDatabase, openDatabase, type Database } from '../../platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../platform/db/spec-database.fixtures.js';
import { createLogger } from '../../platform/logging/logger.js';
import {
  createGatewayStandIn,
  type GatewayStandIn,
} from '../../platform/ports/payment/gateway-stand-in.fixtures.js';
import { createPaymentPort, type PaymentConfig } from '../../platform/ports/payment/index.js';
import type { NodeHandler } from '../../platform/web/route.js';
import { payoutRefHash } from '../identity/index.js';
import { EventRows } from './__fixtures__/event-rows.repository.js';
import { RecipientEventsService, type RecipientVerdicts } from './recipient-events.service.js';
import { PAYMENT_WEBHOOK_PATH, paymentWebhookRoute } from './webhook.controller.js';

const CONFIG: PaymentConfig = {
  PAYMENT_GATEWAY: 'fake',
  ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
};
const PAY_BY = new Date('2099-01-01T00:00:00Z');

let database: Database;
let server: Server;
/** The route of the case running now, over its own recorders. */
let route: NodeHandler | undefined;
const payment = createPaymentPort(CONFIG);
let stand: GatewayStandIn;

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 30_000,
  });
  server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (route === undefined || !url.startsWith(PAYMENT_WEBHOOK_PATH)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    // Mounted under its path, as Express's `use` hands it on.
    request.url = url.slice(PAYMENT_WEBHOOK_PATH.length) || '/';
    route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stand = createGatewayStandIn({
    origin,
    webhookPath: PAYMENT_WEBHOOK_PATH,
    config: CONFIG,
    payment,
  });
});

afterAll(async () => {
  await new Promise((resolve) =>
    server === undefined ? resolve(undefined) : server.close(resolve),
  );
  await closeDatabase(database);
});

/** One call identity's entries received, with whether it came on a transaction. */
interface VerdictCall {
  readonly entry: 'markPayoutVerified' | 'markPayoutRejected';
  readonly onTransaction: boolean;
  readonly refHash: string;
  readonly at?: Date;
  readonly reason?: string | undefined;
}

/** Identity's two entries as recorders, answering `matches` (false: no teacher holds the hash). */
function recordingIdentity(matches = true, failure?: Error) {
  const calls: VerdictCall[] = [];
  const answer = (): Promise<boolean> =>
    failure === undefined ? Promise.resolve(matches) : Promise.reject(failure);
  const identity: RecipientVerdicts = {
    payoutRefHash,
    markPayoutVerified: (tx, refHash, at) => {
      calls.push({ entry: 'markPayoutVerified', onTransaction: tx !== undefined, refHash, at });
      return answer();
    },
    markPayoutRejected: (tx, refHash, reason) => {
      calls.push({ entry: 'markPayoutRejected', onTransaction: tx !== undefined, refHash, reason });
      return answer();
    },
    lockPayoutHolder: async () => undefined,
  };
  return { identity, calls };
}

const RECEIVED_AT = new Date('2026-10-26T09:00:00.000Z');
const VERIFIED_AT = new Date('2026-10-26T09:00:00.250Z');

/** The route's clock: each request reads the instant it arrived, then the instant it was verified. */
function clock(): () => Date {
  let reads = 0;
  return () => (reads++ % 2 === 0 ? RECEIVED_AT : VERIFIED_AT);
}

/** The webhook route over the real service and these recorders, mounted for the case. */
function harness(identity: RecipientVerdicts) {
  const lines: string[] = [];
  const reported: Error[] = [];
  /** The order events the route handed to the order branch (T038's service, a recorder here). */
  const orders: string[] = [];
  const log = createLogger({
    level: 'info',
    destination: { write: (line: string) => void lines.push(line) },
  });
  const service = new RecipientEventsService({
    database,
    identity,
    log,
    report: (error) => void reported.push(error),
  });
  route = paymentWebhookRoute({
    verify: (rawBody, headers) => payment.verifyAndParseEvent(rawBody, headers),
    events: {
      recipients: service,
      orders: {
        record: (event) => {
          orders.push(event.type);
          return Promise.resolve('moved');
        },
      },
    },
    log,
    maxBodyBytes: 1_048_576,
    now: clock(),
  });
  return { lines, reported, orders };
}

const freshRef = (): string => `fake_rcp_${randomUUID()}`;

function rowsOf(providerEventId: string) {
  return new EventRows(database).of(providerEventId);
}

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

describe('a signed recipient event (T075, FR-191, R-114)', () => {
  it('is recorded once, with the hash of its raw body and no payment, and marks the teacher verified', async () => {
    const { identity, calls } = recordingIdentity();
    harness(identity);
    const recipientRef = freshRef();
    const event = stand.recipientVerified(recipientRef);

    expect(await stand.deliver(event)).toBe(200);

    expect(await rowsOf(event.providerEventId)).toEqual([
      {
        paymentId: null,
        providerEventId: event.providerEventId,
        eventType: 'recipient_verified',
        signatureVerifiedAt: VERIFIED_AT,
        payloadHash: sha256(event.rawBody),
        receivedAt: RECEIVED_AT,
      },
    ]);
    expect(calls).toEqual([
      {
        entry: 'markPayoutVerified',
        onTransaction: true,
        refHash: sha256(recipientRef),
        at: VERIFIED_AT,
      },
    ]);
  });

  it("hands a rejection to identity with the gateway's reason", async () => {
    const { identity, calls } = recordingIdentity();
    harness(identity);
    const recipientRef = freshRef();
    const event = stand.recipientRejected(recipientRef, 'name mismatch');

    expect(await stand.deliver(event)).toBe(200);

    expect(await rowsOf(event.providerEventId)).toMatchObject([
      { eventType: 'recipient_rejected', paymentId: null },
    ]);
    expect(calls).toEqual([
      {
        entry: 'markPayoutRejected',
        onTransaction: true,
        refHash: sha256(recipientRef),
        reason: 'name mismatch',
      },
    ]);
  });

  it('hands a rejection without a reason to identity as no reason', async () => {
    const { identity, calls } = recordingIdentity();
    harness(identity);

    await stand.deliver(stand.recipientRejected(freshRef()));

    expect(calls).toMatchObject([{ entry: 'markPayoutRejected', reason: undefined }]);
  });
});

describe('a replayed provider event id (FR-PAYG-4, R-MONEY-8)', () => {
  it('changes nothing: no second row, no second verdict', async () => {
    const { identity, calls } = recordingIdentity();
    harness(identity);
    const event = stand.recipientVerified(freshRef());

    expect(await stand.deliverTwice(event)).toEqual([200, 200]);

    expect(await rowsOf(event.providerEventId)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('changes nothing when the two deliveries race', async () => {
    const { identity, calls } = recordingIdentity();
    harness(identity);
    const event = stand.recipientRejected(freshRef(), 'closed account');

    const statuses = await Promise.all([stand.deliver(event), stand.deliver(event)]);

    expect(statuses).toEqual([200, 200]);
    expect(await rowsOf(event.providerEventId)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe('a reference no teacher holds (R-114)', () => {
  it('is recorded, reported and logged without the body, and changes no row', async () => {
    const { identity, calls } = recordingIdentity(false);
    const { lines, reported } = harness(identity);
    const event = stand.recipientVerified(freshRef());

    expect(await stand.deliver(event)).toBe(200);

    expect(await rowsOf(event.providerEventId)).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toContain(event.providerEventId);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      level: 'warn',
      providerEventId: event.providerEventId,
      eventType: 'recipient_verified',
    });
  });
});

// The harness names `paid`, `failed` and `expired` (T013); `refunded` has no call of its own. Since
// T038 an order event is the order branch's (`order-events.service.ts`, its spec
// `tests/payments/order-events.spec.ts`): this service neither records it nor calls identity.
describe('an order event goes to the order branch, not to this service (T038)', () => {
  it.each(['paid', 'failed', 'expired'] as const)(
    'a %s event is handed to the order branch, writing nothing here and calling nobody',
    async (type) => {
      const { identity, calls } = recordingIdentity();
      const { lines, reported, orders } = harness(identity);
      const { gatewayOrderId } = await payment.createCheckout(
        randomUUID(),
        piasters(100),
        'EGP',
        PAY_BY,
      );
      const event = stand[type](gatewayOrderId);

      expect(await stand.deliver(event)).toBe(200);

      expect(orders).toEqual([type]);
      expect(await rowsOf(event.providerEventId)).toEqual([]);
      expect(calls).toEqual([]);
      expect(reported).toEqual([]);
      expect(lines).toEqual([]);
    },
  );
});

describe('one transaction (R-MONEY-8: the event is persisted before any action)', () => {
  it('keeps no row when identity fails, so the gateway retries the event whole', async () => {
    const { identity } = recordingIdentity(true, new Error('identity is unavailable'));
    harness(identity);
    const event = stand.recipientVerified(freshRef());

    expect(await stand.deliver(event)).toBe(500);

    expect(await rowsOf(event.providerEventId)).toEqual([]);
  });
});

describe('nothing of the raw body leaves (R-SEC-2)', () => {
  it('neither the reference, nor the reason, nor the body reaches a log line or a report', async () => {
    const { identity } = recordingIdentity(false);
    const { lines, reported } = harness(identity);
    const recipientRef = freshRef();
    const event = stand.recipientRejected(
      recipientRef,
      'IBAN EG380019000500000000263180002 closed',
    );

    await stand.deliver(event);

    const leaked = [...lines, ...reported.map((error) => `${error.message}\n${error.stack ?? ''}`)];
    expect(leaked.length).toBeGreaterThan(0);
    for (const text of leaked) {
      expect(text).not.toContain(recipientRef);
      expect(text).not.toContain('EG380019000500000000263180002');
      expect(text).not.toContain(event.rawBody.toString('utf8'));
      expect(text).not.toContain(sha256(recipientRef));
    }
  });
});
