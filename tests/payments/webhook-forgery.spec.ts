// T013 — a forged gateway event is refused before any handler runs and writes nothing
// (contracts/gateway.md "The webhook's order branch" step 1, R-213, FR-372, SC-302, SC-311).
//
// Real HTTP to the real route: `createPaymentWebhookRoute`, the payments module's public entry over
// the identity module's real entries, mounted under `PAYMENT_WEBHOOK_PATH` as the application mounts
// it (the path taken off the request's URL as Express's `use` does; Nest is the API's dependency, not
// the test tree's), over the shared spec database. Every event comes from the harness,
// `tests/support/gateway-stand-in.ts`, the only way a spec produces one (SC-302).
//
// "Writes nothing" is read back from the database: no `payment_events` row under the event's id,
// the forged one's or any for the planted order, the order's `payments` row as it was, and the
// teacher's `teacher_profiles` row as it was. The planted rows are written through the integrity
// harness's builders as the application role; a payment's amount is the builder's, never named here
// (R-MONEY-6).
//
// The drift case (B24's note under T012): the stand-in's hosted page posts its events to the literal
// `/webhooks/payment`, since the kernel imports no module; a press of «ادفع» delivered to the route
// mounted under the payments module's own constant is the spec that fails when the two part.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { piasters } from '../../packages/money/src/index';
import { payoutRefHash } from '../../apps/api/src/modules/identity/index';
import {
  createPaymentWebhookRoute,
  PAYMENT_WEBHOOK_PATH,
} from '../../apps/api/src/modules/payments/index';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
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
  standInCheckoutOf,
} from '../../apps/api/src/platform/ports/payment/index';
import type { PaymentPort } from '../../apps/api/src/platform/ports/payment/payment.port';
import {
  connectAsApplication,
  type Db,
  insertRow,
  makeEnrollment,
  makeUser,
} from '../db-integrity/harness';
import {
  FORGERIES,
  type Forgery,
  gatewayStandIn,
  type GatewayStandIn,
  type StandInEvent,
} from '../support/gateway-stand-in';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const PAY_BY = new Date('2099-01-01T00:00:00Z');

let db: Db;
let database: Database;
let server: Server;
let origin: string;
let config: PaymentConfig;
let payment: PaymentPort;
let stand: GatewayStandIn;
const lines: string[] = [];

/** An approved teacher whose payout is configured and not yet verified, as registration leaves it. */
async function plantPendingTeacher(recipientRef: string): Promise<string> {
  const userId = await makeUser(db, { gender: 'female' });
  await insertRow(db, 'user_roles', { user_id: userId, role: 'teacher', status: 'active' });
  const profileId = randomUUID();
  await insertRow(db, 'teacher_profiles', {
    id: profileId,
    user_id: userId,
    bio: '',
    qualification_summary: 'Hafs',
    verification_status: 'approved',
    approved_at: new Date(),
    application_status: 'approved',
    application_submitted_at: new Date(),
    payout_account_ref_encrypted: new ColumnCipher(ENCRYPTION_KEY).encrypt(
      recipientRef,
      'teacher_profiles.payout_account_ref_encrypted',
      profileId,
    ),
    payout_account_ref_hash: payoutRefHash(recipientRef),
    payout_configured_at: new Date(),
  });
  return profileId;
}

/** An order the stand-in created, and its `payments` row awaiting payment. */
/**
 * The order's amount: the one the stand-in's order is created for and the one its `payments` row
 * holds, so the paid event the stand-in reports always matches the row (T056).
 */
const order_piasters = piasters(25_000);

async function plantOrder(): Promise<{ gatewayOrderId: string; paymentId: string }> {
  // The stand-in's own order, and a row for it of the same amount and currency.
  const { gatewayOrderId } = await payment.createCheckout(
    randomUUID(),
    order_piasters,
    'EGP',
    PAY_BY,
  );
  const { enrollmentId } = await makeEnrollment(db);
  // Written by SQL, as `confirmation-world.ts` writes it: the amount column is named only in
  // payments (R-MONEY-6).
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                           status, expires_at, updated_at)
     VALUES ($1, 'fake', $2, $3, 'EGP', 'created', $4, now())
     RETURNING id::text AS id`,
    [enrollmentId, gatewayOrderId, order_piasters, PAY_BY],
  );
  const paymentId = rows[0]?.id;
  if (paymentId === undefined) throw new Error('no order written');
  return { gatewayOrderId, paymentId };
}

/** Every row the webhook could have written for these events, this order and this teacher. */
async function stateOf(
  events: readonly StandInEvent[],
  paymentId: string | undefined,
  profileId: string | undefined,
) {
  const [recorded, order, teacher] = await Promise.all([
    db.query(
      `SELECT * FROM payment_events WHERE provider_event_id = ANY($1::text[]) OR payment_id = $2::uuid`,
      [events.map((event) => event.providerEventId), paymentId ?? null],
    ),
    db.query('SELECT * FROM payments WHERE id = $1::uuid', [paymentId ?? null]),
    db.query('SELECT * FROM teacher_profiles WHERE id = $1::uuid', [profileId ?? null]),
  ]);
  return { events: recorded.rows, order: order.rows, teacher: teacher.rows };
}

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 30_000,
  });
  const log = createLogger({
    level: 'info',
    destination: { write: (line) => void lines.push(line) },
  });
  // The route is bound once the origin is known: the stand-in's page sends to its origin.
  let route: ReturnType<typeof createPaymentWebhookRoute> | undefined;
  server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (
      route === undefined ||
      (url !== PAYMENT_WEBHOOK_PATH && !url.startsWith(`${PAYMENT_WEBHOOK_PATH}/`))
    ) {
      response.statusCode = 404;
      response.end();
      return;
    }
    request.url = url.slice(PAYMENT_WEBHOOK_PATH.length) || '/';
    route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config = { PAYMENT_GATEWAY: 'fake', ENCRYPTION_KEY, API_PUBLIC_ORIGIN: origin };
  payment = createPaymentPort(config);
  route = createPaymentWebhookRoute({
    database,
    payment: createPaymentPort(config),
    log,
    maxBodyBytes: 1_048_576,
    // The page's paid event reaches T038's branch, which enqueues confirmation: nothing to run here.
    confirmations: { enqueue: () => Promise.resolve() },
  });
  stand = gatewayStandIn({ origin, config, payment });
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) =>
    server === undefined ? resolve(undefined) : server.close(resolve),
  );
  if (database !== undefined) await closeDatabase(database);
  await db?.end();
});

type Kind = 'paid' | 'failed' | 'expired' | 'recipient_verified' | 'recipient_rejected';
const KINDS: readonly Kind[] = [
  'paid',
  'failed',
  'expired',
  'recipient_verified',
  'recipient_rejected',
];

/** The genuine event of `kind`, over a planted order or teacher of its own. */
async function genuine(kind: Kind) {
  if (kind === 'recipient_verified' || kind === 'recipient_rejected') {
    const recipientRef = `fake_rcp_${randomUUID()}`;
    const profileId = await plantPendingTeacher(recipientRef);
    const event =
      kind === 'recipient_verified'
        ? stand.recipientVerified(recipientRef)
        : stand.recipientRejected(recipientRef, 'name mismatch');
    return { event, profileId, paymentId: undefined };
  }
  const { gatewayOrderId, paymentId } = await plantOrder();
  return { event: stand[kind](gatewayOrderId), profileId: undefined, paymentId };
}

describe('a forged event is refused with 401 and writes nothing (T013, FR-372, SC-311)', () => {
  it.each(KINDS.flatMap((kind) => FORGERIES.map((how): [Kind, Forgery] => [kind, how])))(
    'a %s event, %s',
    async (kind, how) => {
      const { event, profileId, paymentId } = await genuine(kind);
      const forged = stand.tamper(event, how);
      const before = await stateOf([event, forged], paymentId, profileId);

      const status = await stand.deliver(forged);

      expect(status).toBe(401);
      const after = await stateOf([event, forged], paymentId, profileId);
      expect(after).toEqual(before);
      expect(after.events).toEqual([]);
    },
  );

  it('the genuine recipient event, by contrast, is recorded and verifies the teacher', async () => {
    const { event, profileId } = await genuine('recipient_verified');

    expect(await stand.deliver(event)).toBe(200);

    const after = await stateOf([event], undefined, profileId);
    expect(after.events).toHaveLength(1);
    expect(after.teacher[0]).toMatchObject({ payout_verified_at: expect.any(Date) });
  });

  it('a forged event is refused however often it is sent', async () => {
    const { event, profileId } = await genuine('recipient_verified');
    const forged = stand.tamper(event, 'wrong_secret');
    const before = await stateOf([event, forged], undefined, profileId);

    expect(await stand.deliverTwice(forged)).toEqual([401, 401]);
    expect(await stateOf([event, forged], undefined, profileId)).toEqual(before);
  });

  it('logs the refusal by its code alone, nothing of the event', async () => {
    const { event } = await genuine('recipient_rejected');
    lines.length = 0;

    await stand.deliver(stand.tamper(event, 'body_changed'));

    expect(lines.join('\n')).not.toContain(event.providerEventId);
    expect(lines.join('\n')).not.toContain(event.headers['x-fake-signature'] ?? 'no signature');
    // The code's value itself, not only the level: the signature alert counts it (the follow-up
    // under T012 of specs/004-sessions/tasks.md, 2026-11-08).
    expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        errorCode: 'UNAUTHENTICATED',
        msg: 'Payment webhook refused',
      }),
    );
  });
});

describe('the stand-in’s page reaches the payments module’s own route (T013, B24’s note under T012)', () => {
  it('a press of «ادفع» is delivered to the route mounted under PAYMENT_WEBHOOK_PATH', async () => {
    const { gatewayOrderId } = await plantOrder();
    const page = standInCheckoutOf(payment);
    if (page === undefined) throw new Error('the payment port is not the stand-in');

    await expect(page.submit(gatewayOrderId, 'pay')).resolves.toBe('delivered');
  });
});
