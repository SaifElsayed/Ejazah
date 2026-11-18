// T039 — `confirm-enrollment` behind the real webhook (R-215, FR-361, FR-373, SC-305; ARCHITECTURE
// §8.1 steps 2 to 4). Every event comes from the stand-in's harness, `tests/support/gateway-stand-in.ts`,
// over HTTP to `createPaymentWebhookRoute` as the application mounts it (SC-302). The queue
// producer the route is handed runs the job itself for every enqueue, at most four at once (the
// worker's `QUEUE_CONCURRENCY` default), and does not drop a repeated job id as BullMQ would: a
// replay that reaches the job is the harder case.
//
//   - 100 deliveries of one paid event: one `payment_events` row, one confirmation, one converted
//     hold, one set of sessions, one `confirmed` row, no compensation case (SC-305);
//   - `deliverAfter` (the note under T013): a paid event delivered after its hold was released
//     takes the late branch and confirms the enrollment from `cancelled` (FR-PAYG-19).
//
// The worlds are committed (`tests/db-integrity/confirmation-world.ts`).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { piasters } from '../../packages/money/src/index';
import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { releaseHolds } from '../../apps/api/src/modules/booking/index';
import {
  createPaymentWebhookRoute,
  orderStandingsOf,
  PAYMENT_WEBHOOK_PATH,
} from '../../apps/api/src/modules/payments/index';
import {
  closeDatabase,
  openDatabase,
  type Database,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import {
  createPaymentPort,
  type PaymentConfig,
} from '../../apps/api/src/platform/ports/payment/index';
import type { PaymentPort } from '../../apps/api/src/platform/ports/payment/payment.port';
import {
  confirmationWorld,
  FOUR_THURSDAYS,
  LATER,
  NOW,
  settings,
} from '../db-integrity/confirmation-world';
import { gatewayStandIn, type GatewayStandIn } from '../support/gateway-stand-in';

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const REPLAYS = 100;
/** The worker's deliveries at once, `QUEUE_CONCURRENCY`'s default (T171). */
const CONCURRENCY = 4;

let database: Database;
let server: Server;
let payment: PaymentPort;
let stand: GatewayStandIn;

/** Every run the queue producer started, settled or not. */
const runs: Promise<void>[] = [];
let running = 0;
const waiting: (() => void)[] = [];

async function limited(work: () => Promise<void>): Promise<void> {
  while (running >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/** Waits for every run started so far; each must have succeeded. */
async function drained(): Promise<void> {
  const settled = await Promise.allSettled(runs.splice(0));
  expect(settled.filter(({ status }) => status === 'rejected')).toEqual([]);
}

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 8,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  const job = confirmEnrollment({ database, settings, notices: NO_PUSH, clock: () => NOW });
  let route: ReturnType<typeof createPaymentWebhookRoute> | undefined;
  server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (route === undefined || !url.startsWith(PAYMENT_WEBHOOK_PATH)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    request.url = url.slice(PAYMENT_WEBHOOK_PATH.length) || '/';
    route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config: PaymentConfig = {
    PAYMENT_GATEWAY: 'fake',
    PAYMENT_MODE: 'test',
    ENCRYPTION_KEY,
    API_PUBLIC_ORIGIN: origin,
  };
  payment = createPaymentPort(config);
  route = createPaymentWebhookRoute({
    notices: NO_PUSH,
    database,
    payment,
    log: createLogger({ level: 'error', destination: { write: () => undefined } }),
    maxBodyBytes: 1_048_576,
    confirmations: {
      enqueue: async (paymentId) => {
        runs.push(limited(() => job.handle({ paymentId })));
      },
    },
    report: () => undefined,
  });
  stand = gatewayStandIn({ origin, config, payment });
}, 60_000);

afterAll(async () => {
  await Promise.allSettled(runs);
  await new Promise((resolve) =>
    server === undefined ? resolve(undefined) : server.close(resolve),
  );
  if (database !== undefined) await closeDatabase(database);
});

const { world, order, enrollmentOf, holdsOf, sessionsOf, eventsOf, casesOf } = confirmationWorld(
  () => database,
);

/** An order the stand-in created for the enrollment, its `payments` row `created`. */
async function plantOrder(
  enrollmentId: string,
): Promise<{ gatewayOrderId: string; paymentId: string }> {
  const { gatewayOrderId } = await payment.createCheckout(
    randomUUID(),
    piasters(100_000),
    'EGP',
    LATER,
  );
  return { gatewayOrderId, paymentId: await order(enrollmentId, 'created', gatewayOrderId) };
}

describe('confirm-enrollment behind the webhook (SC-305)', () => {
  it(`${REPLAYS} deliveries of one paid event leave one confirmation, one converted hold and one set of sessions`, async () => {
    const on = await world();
    const { gatewayOrderId, paymentId } = await plantOrder(on.enrollmentId);
    const paid = stand.paid(gatewayOrderId);
    const statuses: number[] = [];
    for (let delivery = 0; delivery < REPLAYS; delivery += 1) {
      statuses.push(await stand.deliver(paid));
    }
    await drained();

    expect(new Set(statuses)).toEqual(new Set([200]));
    expect(await database.paymentEvent.count({ where: { paymentId } })).toBe(1);
    expect(await enrollmentOf(on.enrollmentId)).toEqual({
      status: 'confirmed',
      cancellationReason: null,
      confirmedAt: NOW,
    });
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: NOW }]);
    expect(await sessionsOf(on.enrollmentId)).toEqual(FOUR_THURSDAYS);
    expect(await eventsOf(on.enrollmentId)).toEqual([
      { kind: 'confirmed', cancellationReason: null, paymentId, occurredAt: NOW },
    ]);
    expect(await casesOf(on.enrollmentId)).toEqual([]);
  }, 120_000);

  it('a paid event delivered after its hold was released confirms by the late branch (deliverAfter)', async () => {
    const on = await world();
    const { gatewayOrderId, paymentId } = await plantOrder(on.enrollmentId);
    const status = await stand.deliverAfter(stand.paid(gatewayOrderId), () =>
      database.$transaction((tx) =>
        releaseHolds(tx, [on.holdId], 'checkout_abandoned', { at: NOW, orders: orderStandingsOf }),
      ),
    );
    await drained();

    expect(status).toBe(200);
    expect(await enrollmentOf(on.enrollmentId)).toEqual({
      status: 'confirmed',
      cancellationReason: null,
      confirmedAt: NOW,
    });
    const holds = await holdsOf(on.enrollmentId);
    expect(holds.map(({ releasedAt }) => releasedAt)).toEqual([NOW, NOW]);
    expect(await sessionsOf(on.enrollmentId)).toEqual(FOUR_THURSDAYS);
    expect(
      (await eventsOf(on.enrollmentId)).map(({ kind, cancellationReason, paymentId: named }) => [
        kind,
        cancellationReason,
        named,
      ]),
    ).toEqual([
      ['cancelled', 'checkout_abandoned', null],
      ['confirmed', null, paymentId],
    ]);
  }, 60_000);
});
