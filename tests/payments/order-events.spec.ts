// T038 — the webhook's order branch (contracts/gateway.md "The webhook's order branch", R-214, FR-360,
// FR-365, FR-367, analysis G3; ARCHITECTURE §8.1 steps 2 to 4).
//
// Real HTTP to the real route: `createPaymentWebhookRoute`, the payments module's public entry, mounted
// under `PAYMENT_WEBHOOK_PATH` as the application mounts it, over the shared spec database. Every
// event comes from the harness, `tests/support/gateway-stand-in.ts`, for an order the stand-in
// created (SC-302); no case hands the service an event. The queue producer and the error reporting
// are recorders: `confirm-enrollment` is another task's job, so what is asserted is that it is
// enqueued by name with the job id `paymentId`, after the commit (the recorder reads the order's row
// over another connection, which sees committed rows only).
//
// The planted rows (an enrollment and its `payments` row, `created`, carrying an address) are written
// through the integrity harness's builders as the application role; the order's gross is the
// builder's 0, while the stand-in's event reports its own, so an amount the branch computed from the
// row rather than copied from the event differs from the event's. The gateway's amounts are compared
// with the event's body in SQL, and never named here (R-MONEY-6).
//
// The lock order (the note under T038, PR #114's review): the branch takes the enrollment's row before
// the payment's. With the enrollment held by another transaction, the webhook is seen waiting on it,
// and the payment's row can meanwhile be locked NOWAIT: the webhook holds no lock on it yet.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { piasters } from '../../packages/money/src/index';
import {
  createPaymentWebhookRoute,
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
import { connectAsApplication, type Db, insertRow, makeEnrollment } from '../db-integrity/harness';
import {
  gatewayStandIn,
  type GatewayStandIn,
  type StandInEvent,
} from '../support/gateway-stand-in';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const PAY_BY = new Date('2099-01-01T00:00:00Z');
const ADDRESS = Buffer.from('an encrypted hosted-page address');

let db: Db;
let other: Db;
let database: Database;
let server: Server;
let payment: PaymentPort;
let stand: GatewayStandIn;
const lines: string[] = [];
const reported: Error[] = [];

/** One enqueue the branch made, with the order's status as committed when it was made. */
interface Enqueued {
  readonly paymentId: string;
  readonly committedStatus: string | undefined;
}
const enqueued: Enqueued[] = [];
let enqueueFails = false;
let reading: Promise<void> = Promise.resolve();

beforeAll(async () => {
  [db, other] = await Promise.all([connectAsApplication(), connectAsApplication()]);
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 30_000,
  });
  const log = createLogger({
    level: 'info',
    destination: { write: (line) => void lines.push(line) },
  });
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
    ENCRYPTION_KEY,
    API_PUBLIC_ORIGIN: origin,
  };
  payment = createPaymentPort(config);
  route = createPaymentWebhookRoute({
    database,
    payment,
    log,
    maxBodyBytes: 1_048_576,
    confirmations: {
      enqueue: (paymentId) => {
        if (enqueueFails) return Promise.reject(new Error('the queue is unavailable'));
        // One read at a time on the one connection, as racing deliveries enqueue together.
        const read = reading.then(async () => {
          const { rows } = await other.query<{ status: string }>(
            'SELECT status::text AS status FROM payments WHERE id = $1',
            [paymentId],
          );
          enqueued.push({ paymentId, committedStatus: rows[0]?.status });
        });
        reading = read.catch(() => undefined);
        return read;
      },
    },
    report: (error) => void reported.push(error),
  });
  stand = gatewayStandIn({ origin, config, payment });
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) =>
    server === undefined ? resolve(undefined) : server.close(resolve),
  );
  if (database !== undefined) await closeDatabase(database);
  await Promise.all([db?.end(), other?.end()]);
});

beforeEach(() => {
  enqueued.length = 0;
  reported.length = 0;
  lines.length = 0;
  enqueueFails = false;
});

interface Order {
  readonly gatewayOrderId: string;
  readonly paymentId: string;
  readonly enrollmentId: string;
  readonly holdId: string;
}

/** An order the stand-in created, its `payments` row `created` with an address, and its active hold. */
async function plantOrder(): Promise<Order> {
  const { gatewayOrderId } = await payment.createCheckout(
    randomUUID(),
    piasters(25_000),
    'EGP',
    PAY_BY,
  );
  const { enrollmentId, studentId } = await makeEnrollment(db);
  const { rows } = await db.query<{
    slot_id: string;
    package_id: string;
    snapshot_session_count: number;
  }>('SELECT slot_id, package_id, snapshot_session_count FROM enrollments WHERE id = $1', [
    enrollmentId,
  ]);
  const holdId = await insertRow(db, 'slot_holds', {
    slot_id: rows[0]?.slot_id,
    // B29: a hold records the package it is for and that package's session count.
    package_id: rows[0]?.package_id,
    session_count: rows[0]?.snapshot_session_count,
    student_user_id: studentId,
    enrollment_id: enrollmentId,
    expires_at: PAY_BY,
  });
  const paymentId = await insertRow(db, 'payments', {
    enrollment_id: enrollmentId,
    gateway: 'fake',
    gateway_order_id: gatewayOrderId,
    currency: 'EGP',
    status: 'created',
    expires_at: PAY_BY,
    checkout_url_encrypted: ADDRESS,
  });
  return { gatewayOrderId, paymentId, enrollmentId, holdId };
}

interface OrderRow {
  readonly status: string;
  readonly transaction: string | null;
  readonly address: Buffer | null;
  /** The gateway's transaction id, fee and net equal the paid event's body, compared in SQL. */
  readonly as_reported: boolean | null;
}

/** The order's row; `paid` is the event whose reported values the row is compared with. */
async function orderOf(paymentId: string, paid?: StandInEvent): Promise<OrderRow | undefined> {
  const { rows } = await db.query<OrderRow>(
    `SELECT status::text AS status, gateway_transaction_id AS transaction,
            checkout_url_encrypted AS address,
            CASE WHEN $2::jsonb IS NULL THEN NULL ELSE
              gateway_transaction_id = $2::jsonb ->> 'transaction'
              AND gateway_fee_piasters = ($2::jsonb ->> 'gateway_fee_piasters')::bigint
              AND net_piasters = ($2::jsonb ->> 'net_piasters')::bigint END AS as_reported
       FROM payments WHERE id = $1`,
    [paymentId, paid === undefined ? null : paid.rawBody.toString('utf8')],
  );
  return rows[0];
}

/** Every `payment_events` row of the order, every column. */
async function eventsOf(paymentId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await db.query(
    'SELECT * FROM payment_events WHERE payment_id = $1 ORDER BY created_at, id',
    [paymentId],
  );
  return rows;
}

async function outcomesOf(enrollmentId: string) {
  const { rows } = await db.query<{
    kind: string;
    payment_id: string | null;
    cancellation_reason: string | null;
  }>(
    `SELECT kind::text AS kind, payment_id, cancellation_reason::text AS cancellation_reason
       FROM enrollment_events WHERE enrollment_id = $1 ORDER BY id`,
    [enrollmentId],
  );
  return rows;
}

async function enrollmentAndHold(order: Order) {
  const [enrollment, hold] = await Promise.all([
    db.query<{ status: string; confirmed_at: Date | null }>(
      'SELECT status::text AS status, confirmed_at FROM enrollments WHERE id = $1',
      [order.enrollmentId],
    ),
    db.query<{ released_at: Date | null }>('SELECT released_at FROM slot_holds WHERE id = $1', [
      order.holdId,
    ]),
  ]);
  return { enrollment: enrollment.rows[0], hold: hold.rows[0] };
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('a paid event (FR-360, FR-367, R-214)', () => {
  it('records the event with the hash of its body and no body, moves the order to paid as reported, clears the address, and enqueues confirmation after commit', async () => {
    const order = await plantOrder();
    const event = stand.paid(order.gatewayOrderId);

    expect(await stand.deliver(event)).toBe(200);

    const events = await eventsOf(order.paymentId);
    expect(events).toHaveLength(1);
    // Analysis G3: the row holds the body's hash and no column of it holds the body.
    expect(Object.keys(events[0] ?? {}).sort()).toEqual(
      [
        'created_at',
        'event_type',
        'id',
        'payload_hash',
        'payment_id',
        'provider_event_id',
        'received_at',
        'signature_verified_at',
      ].sort(),
    );
    expect(events[0]).toMatchObject({
      payment_id: order.paymentId,
      provider_event_id: event.providerEventId,
      event_type: 'paid',
      payload_hash: sha256(event.rawBody),
    });
    const body = event.rawBody.toString('utf8');
    for (const value of Object.values(events[0] ?? {})) expect(String(value)).not.toContain(body);

    expect(await orderOf(order.paymentId, event)).toEqual({
      status: 'paid',
      transaction: expect.stringMatching(/^fake_txn_/) as unknown,
      address: null,
      as_reported: true,
    });
    expect(enqueued).toEqual([{ paymentId: order.paymentId, committedStatus: 'paid' }]);
    // The webhook confirms nothing itself: the job does (R-HONEST-1).
    expect(await enrollmentAndHold(order)).toEqual({
      enrollment: { status: 'pending_payment', confirmed_at: null },
      hold: { released_at: null },
    });
    expect(await outcomesOf(order.enrollmentId)).toEqual([]);
    expect(reported).toEqual([]);
  });

  it('delivered twice: one row and nothing changed by the second, but confirmation enqueued again (M2)', async () => {
    const order = await plantOrder();
    const event = stand.paid(order.gatewayOrderId);

    expect(await stand.deliverTwice(event)).toEqual([200, 200]);

    expect(await eventsOf(order.paymentId)).toHaveLength(1);
    expect(await orderOf(order.paymentId, event)).toMatchObject({
      status: 'paid',
      as_reported: true,
    });
    expect(enqueued).toEqual([
      { paymentId: order.paymentId, committedStatus: 'paid' },
      { paymentId: order.paymentId, committedStatus: 'paid' },
    ]);
  });

  it('two deliveries racing leave one row and one move', async () => {
    const order = await plantOrder();
    const event = stand.paid(order.gatewayOrderId);

    expect(await Promise.all([stand.deliver(event), stand.deliver(event)])).toEqual([200, 200]);

    expect(await eventsOf(order.paymentId)).toHaveLength(1);
    expect(await orderOf(order.paymentId, event)).toMatchObject({ status: 'paid' });
  });

  it('after a failure or an expiry the gateway reported, still moves the order to paid: the paid event is the gateway’s word', async () => {
    const failedOrder = await plantOrder();
    const expiredOrder = await plantOrder();
    const failed = stand.failed(failedOrder.gatewayOrderId);
    const expired = stand.expired(expiredOrder.gatewayOrderId);
    const paidAfterFailure = stand.paid(failedOrder.gatewayOrderId);
    const paidAfterExpiry = stand.paid(expiredOrder.gatewayOrderId);

    expect(
      await stand.deliverInOrder([failed, paidAfterFailure, expired, paidAfterExpiry]),
    ).toEqual([200, 200, 200, 200]);

    expect(await orderOf(failedOrder.paymentId, paidAfterFailure)).toMatchObject({
      status: 'paid',
      as_reported: true,
    });
    expect(await orderOf(expiredOrder.paymentId, paidAfterExpiry)).toMatchObject({
      status: 'paid',
      as_reported: true,
    });
    expect(enqueued.map(({ paymentId }) => paymentId)).toEqual([
      failedOrder.paymentId,
      expiredOrder.paymentId,
    ]);
  });

  it('enqueues nothing when the queue fails, answers 500, and the gateway’s retry enqueues it (M2)', async () => {
    const order = await plantOrder();
    const event = stand.paid(order.gatewayOrderId);
    enqueueFails = true;

    expect(await stand.deliver(event)).toBe(500);

    // The event and the move were committed before the enqueue was tried.
    expect(await eventsOf(order.paymentId)).toHaveLength(1);
    expect(await orderOf(order.paymentId)).toMatchObject({ status: 'paid' });
    expect(enqueued).toEqual([]);

    enqueueFails = false;
    expect(await stand.deliver(event)).toBe(200);

    expect(await eventsOf(order.paymentId)).toHaveLength(1);
    expect(enqueued).toEqual([{ paymentId: order.paymentId, committedStatus: 'paid' }]);
  });
});

describe('a failed event (FR-365, R-214)', () => {
  it('moves the order to failed, clears the address, appends order_failed with the order, and leaves the hold and the enrollment', async () => {
    const order = await plantOrder();
    const event = stand.failed(order.gatewayOrderId);

    expect(await stand.deliver(event)).toBe(200);

    expect(await eventsOf(order.paymentId)).toMatchObject([
      { event_type: 'failed', payload_hash: sha256(event.rawBody) },
    ]);
    expect(await orderOf(order.paymentId)).toEqual({
      status: 'failed',
      transaction: null,
      address: null,
      as_reported: null,
    });
    expect(await outcomesOf(order.enrollmentId)).toEqual([
      { kind: 'order_failed', payment_id: order.paymentId, cancellation_reason: null },
    ]);
    expect(await enrollmentAndHold(order)).toEqual({
      enrollment: { status: 'pending_payment', confirmed_at: null },
      hold: { released_at: null },
    });
    expect(enqueued).toEqual([]);
  });

  it('delivered twice appends one outcome', async () => {
    const order = await plantOrder();

    expect(await stand.deliverTwice(stand.failed(order.gatewayOrderId))).toEqual([200, 200]);

    expect(await eventsOf(order.paymentId)).toHaveLength(1);
    expect(await outcomesOf(order.enrollmentId)).toHaveLength(1);
  });
});

describe('an expired event (R-214)', () => {
  it('moves the order to expired and clears the address, with no outcome and nothing enqueued', async () => {
    const order = await plantOrder();

    expect(await stand.deliver(stand.expired(order.gatewayOrderId))).toBe(200);

    expect(await orderOf(order.paymentId)).toMatchObject({ status: 'expired', address: null });
    expect(await eventsOf(order.paymentId)).toMatchObject([{ event_type: 'expired' }]);
    expect(await outcomesOf(order.enrollmentId)).toEqual([]);
    expect(enqueued).toEqual([]);
  });
});

describe('monotonic: a paid order moves only to refunded (data-model §3, FR-373)', () => {
  it.each(['failed', 'expired'] as const)(
    'a %s event after paid is recorded and changes nothing',
    async (late) => {
      const order = await plantOrder();
      const paid = stand.paid(order.gatewayOrderId);
      await stand.deliver(paid);
      enqueued.length = 0;

      expect(await stand.deliver(stand[late](order.gatewayOrderId))).toBe(200);

      expect(await orderOf(order.paymentId, paid)).toMatchObject({
        status: 'paid',
        as_reported: true,
      });
      expect((await eventsOf(order.paymentId)).map((row) => row['event_type'])).toEqual([
        'paid',
        late,
      ]);
      expect(await outcomesOf(order.enrollmentId)).toEqual([]);
      expect(enqueued).toEqual([]);
    },
  );

  it('an expired event after failed changes nothing', async () => {
    const order = await plantOrder();

    await stand.deliverInOrder([
      stand.failed(order.gatewayOrderId),
      stand.expired(order.gatewayOrderId),
    ]);

    expect(await orderOf(order.paymentId)).toMatchObject({ status: 'failed' });
    expect(await eventsOf(order.paymentId)).toHaveLength(2);
    expect(await outcomesOf(order.enrollmentId)).toHaveLength(1);
  });
});

describe('an order no payment row holds (contracts/gateway.md, ERD rule 20)', () => {
  it('is answered 200, written nowhere, enqueues nothing, and is reported without its body', async () => {
    const { gatewayOrderId } = await payment.createCheckout(
      randomUUID(),
      piasters(25_000),
      'EGP',
      PAY_BY,
    );
    const event = stand.paid(gatewayOrderId);

    expect(await stand.deliver(event)).toBe(200);

    const { rows } = await db.query('SELECT 1 FROM payment_events WHERE provider_event_id = $1', [
      event.providerEventId,
    ]);
    expect(rows).toEqual([]);
    expect(enqueued).toEqual([]);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toContain(event.providerEventId);
    expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        providerEventId: event.providerEventId,
        eventType: 'paid',
      }),
    );
    const body = event.rawBody.toString('utf8');
    for (const text of [...lines, ...reported.map((error) => `${error.message}\n${error.stack}`)]) {
      expect(text).not.toContain(body);
      expect(text).not.toContain(gatewayOrderId);
    }
  });
});

describe('the lock order: the enrollment before the payment (note under T038)', () => {
  it('waits on a held enrollment while holding no lock on the payment, then applies the event', async () => {
    const order = await plantOrder();
    const event = stand.failed(order.gatewayOrderId);
    const holder = await connectAsApplication();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM enrollments WHERE id = $1 FOR UPDATE', [
        order.enrollmentId,
      ]);
      const { rows: holderRows } = await holder.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const delivery = stand.deliver(event);

      const blocked = await blockedBy(holderRows[0]?.pid ?? 0);
      expect(blocked.query).toContain('enrollments');
      await other.query('BEGIN');
      // NOWAIT: refused at once (55P03) if the webhook already held the payment's row.
      await expect(
        other.query('SELECT 1 FROM payments WHERE id = $1 FOR UPDATE NOWAIT', [order.paymentId]),
      ).resolves.toMatchObject({ rowCount: 1 });
      await other.query('ROLLBACK');
      expect(await eventsOf(order.paymentId)).toEqual([]);

      await holder.query('COMMIT');
      expect(await delivery).toBe(200);
      expect(await orderOf(order.paymentId)).toMatchObject({ status: 'failed' });
      expect(await outcomesOf(order.enrollmentId)).toHaveLength(1);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
  });
});

/** The backend `pid` blocks, once it is seen waiting on a lock; its query. */
async function blockedBy(pid: number): Promise<{ readonly query: string }> {
  for (let look = 0; look < 250; look += 1) {
    const { rows } = await other.query<{ query: string }>(
      `SELECT query FROM pg_stat_activity
        WHERE $1 = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock'`,
      [pid],
    );
    if (rows[0] !== undefined) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no backend waited on ${String(pid)}'s lock`);
}
