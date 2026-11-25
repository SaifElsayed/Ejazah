// 006:T014 of specs/006-programme/tasks.md (FR-714, FR-716, FR-717; R-509; SRS DEC-110, DEC-113;
// PR #153 r1 Major 3, r3 Major 1, r1 Minor 1; Q-2 (a) amended, Q-10 (a) adjusted; SC-707): the
// automatic charge over the real tables, as the application role, with the stand-in as the gateway:
// - order before call: `record` writes the month's order `created`, automatic, its attempt, no
//   gateway id, `expires_at` = the database's clock + 10 minutes, the month's gross and the share at
//   the assessment's rate; with no saved card nothing; in live mode with no payee a `failed`/`hard`
//   order with no gateway id, no call, no push, never expired by the sweep;
// - the call: never under a database lock (both rows locked NOWAIT from another connection while
//   the gateway is called), the gateway's order id committed before the payment, the payment sent
//   once; an unanswered first step expired at once (a soft decline); a refusal recorded `failed`/
//   `hard` with no push; an inquiry that expires the order while its first step is in flight leaves
//   the payment unsent (the race on the id's conditional write);
// - the inquiry: nothing asked before the expiry; a crash between the commit and the call expired
//   with no question; paid recorded through the webhook's branch (the confirm step enqueued, the late
//   callback a replay); a failed callback then the inquiry's kind written; no answer changes nothing;
//   no transaction expires the order; a manual order with a gateway id past its expiry refused before
//   any question (006:T022, PR #160 r2 Minor 1, ADR 0026);
// - `expire-pending-payments` leaves automatic orders to the inquiry;
// - SC-707: no token in a log line, a result or an enqueued payload.
//
// Committed worlds of their own (the entry runs its own transactions), as `programme-cards.spec.ts`'.
// Amounts are compared in SQL and never named here (R-MONEY-6).
//
// Observed red: every case against the entry's stub, the webhook's decline kind and the expiry sweep
// before T014 (`R/lane-b`); the negatives under named mutants, restored and `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPaymentWebhookRoute,
  createProgrammeCharges,
  expiredOrderIds,
  markOrdersExpired,
  PAYMENT_WEBHOOK_PATH,
} from '../../apps/api/src/modules/payments/index';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import { addMinutes } from '../../packages/time/src/index.js';
import {
  createPaymentPort,
  type PaymentConfig,
} from '../../apps/api/src/platform/ports/payment/index';
import {
  ChargeRefusedError,
  type PaymentPort,
} from '../../apps/api/src/platform/ports/payment/payment.port';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader';
import { piasters } from '../../packages/money/src/index';
import { CAIRO, confirmationWorld, SETTINGS, THURSDAY_0900 } from './confirmation-world';

const KEY = Buffer.alloc(32, 9).toString('base64');
const cipher = new ColumnCipher(KEY);
const PAYMENT: PaymentConfig = {
  PAYMENT_GATEWAY: 'fake',
  PAYMENT_MODE: 'test',
  ENCRYPTION_KEY: KEY,
};
const TOKEN = 'placeholder-card-token';
const TEN_MINUTES = 10;

/** What this spec drives of the stand-in behind the port (`fake.adapter.ts`), named structurally. */
interface StandInGateway extends PaymentPort {
  readonly calls: readonly { readonly operation: string; readonly args: readonly unknown[] }[];
  failNext(operation: 'chargeSavedCard', error: Error): void;
  onCharge(answer: 'paid' | 'soft' | 'hard' | 'order_unanswered' | 'payment_lost'): void;
  onInquiry(gatewayOrderId: string, answer: 'none' | 'no_answer'): void;
  orderEvent(
    gatewayOrderId: string,
    type: 'paid' | 'failed',
  ): { rawBody: Buffer; headers: Record<string, string> };
}

const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};

let database: Database;
let observer: pg.Client;
let server: Server;
let origin: string;
const fake = createPaymentPort(PAYMENT) as StandInGateway;
const logLines: string[] = [];
const enqueued: unknown[] = [];
const pushes: unknown[] = [];
const log = createLogger({ level: 'info', destination: { write: (line) => logLines.push(line) } });
const notices = {
  record: async (...args: unknown[]) => {
    pushes.push(args);
  },
};
const confirmations = {
  enqueue: async (paymentId: string) => {
    enqueued.push(paymentId);
  },
};
/** How far past the real clock the entry's clock reads (a case moves it past an order's expiry). */
let aheadMinutes = 0;

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  observer = new pg.Client({ connectionString: specDatabaseUrl('DATABASE_URL') });
  await observer.connect();
  const route = createPaymentWebhookRoute({
    database,
    payment: fake,
    log,
    maxBodyBytes: 1_048_576,
    confirmations,
    notices: notices as never,
    report: () => undefined,
    cipher,
  });
  server = createServer((request, response) => {
    request.url = (request.url ?? '/').slice(PAYMENT_WEBHOOK_PATH.length) || '/';
    route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await observer.end();
  await closeDatabase(database);
});

const { person } = confirmationWorld(() => database);

function charges(
  options: { readonly mode?: 'test' | 'live'; readonly payment?: PaymentPort } = {},
) {
  return createProgrammeCharges({
    database,
    payment: options.payment ?? fake,
    cipher,
    gateway: 'fake',
    paymentMode: options.mode ?? 'test',
    settings,
    log,
    confirmations,
    notices: notices as never,
    report: () => undefined,
  });
}

/** An active programme of 40 offer sessions, its assessment paid at 70 %, with a saved card. */
async function programmeWorld({ card = true }: { readonly card?: boolean } = {}) {
  const teacherId = await person('female');
  await database.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      // No verified payout account: no payee (test mode charges with none; live mode refuses).
      verificationStatus: 'approved',
    },
  });
  const { id: subjectId } = await database.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });
  const { id: packageId } = await database.package.create({
    data: {
      teacherUserId: teacherId,
      subjectId,
      track: 'ijazah_track',
      isProgramme: true,
      price30Piasters: 25_000n,
      price45Piasters: 30_000n,
      price60Piasters: 35_000n,
      isActive: true,
    },
    select: { id: true },
  });
  const { id: slotId } = await database.availabilitySlot.create({
    data: {
      teacherUserId: teacherId,
      dayOfWeek: 4,
      startTimeLocal: THURSDAY_0900,
      durationMinutes: 60,
      timezone: CAIRO,
      isActive: true,
    },
    select: { id: true },
  });
  const studentId = await person('female');
  const { id: enrollmentId } = await database.enrollment.create({
    data: {
      studentUserId: studentId,
      teacherUserId: teacherId,
      packageId,
      slotId,
      snapshotPricePiasters: 1_025_000n,
      snapshotSessionCount: 41,
      snapshotDurationMinutes: 30,
      snapshotSubjectId: subjectId,
      snapshotSlotTimezone: CAIRO,
      snapshotTrack: 'ijazah_track',
      status: 'confirmed',
      confirmedAt: new Date('2026-11-01T07:01:00Z'),
      purchasedAt: new Date('2026-11-01T07:00:00Z'),
      quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
    },
    select: { id: true },
  });
  await database.programme.create({
    data: {
      enrollmentId,
      state: 'active',
      offeredAt: new Date('2026-11-20T07:00:00Z'),
      monthCount: 10,
      paymentPlan: 'monthly',
      monthsPaid: 1,
    },
  });
  // The assessment's order, processed, with its rate (R-511); by SQL (R-MONEY-6).
  await database.$executeRaw`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency, status,
                          expires_at, kind, teacher_share_rate_percent, teacher_share_piasters,
                          confirmed_at, updated_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${`fake_ord_${randomUUID()}`}, 25000, 'EGP', 'paid',
            '2026-11-01T07:10:00Z', 'assessment', 70, 17500, '2026-11-01T07:01:00Z', now())`;
  if (card) {
    await database.programmeCard.create({
      data: {
        enrollmentId,
        tokenEncrypted: Uint8Array.from(
          cipher.encrypt(TOKEN, 'programme_cards.token_encrypted', enrollmentId),
        ),
        last4: '4242',
        brand: 'Visa',
        consentedAt: new Date('2026-11-20T08:00:00Z'),
      },
    });
  }
  return { teacherId, studentId, enrollmentId };
}

/** Month 2's first automatic charge: 4 sessions at 25,000 piasters each (40 for 1,000,000). */
const month2 = (world: { teacherId: string; enrollmentId: string }) => ({
  enrollmentId: world.enrollmentId,
  teacherUserId: world.teacherId,
  instalmentMonth: 2,
  attempt: 0,
  offerTotal_piasters: piasters(1_000_000),
  offerSessionCount: 40,
});

type OrderRow = {
  id: string;
  status: string;
  automatic: boolean;
  attempt: number | null;
  kind: string;
  instalment_month: number | null;
  gateway_order_id: string | null;
  decline_kind: string | null;
  month_gross: boolean;
  share_at_rate: boolean;
  ten_minutes: boolean;
};

/** The enrollment's automatic orders, read over another connection (committed rows only). */
async function automaticOrdersOf(enrollmentId: string): Promise<OrderRow[]> {
  const { rows } = await observer.query<OrderRow>(
    `SELECT id::text, status::text, automatic, attempt, kind::text, instalment_month,
            gateway_order_id, decline_kind::text,
            gross_piasters = 100000 AS month_gross,
            teacher_share_piasters = 70000 AND teacher_share_rate_percent = 70 AS share_at_rate,
            expires_at - created_at BETWEEN interval '9 minutes 59 seconds' AND interval '10 minutes 1 second'
              AS ten_minutes
       FROM payments WHERE enrollment_id = $1 AND automatic ORDER BY id`,
    [enrollmentId],
  );
  return rows;
}

async function eventsOf(paymentId: string): Promise<string[]> {
  const { rows } = await observer.query<{ event_type: string }>(
    'SELECT event_type::text FROM payment_events WHERE payment_id = $1 ORDER BY created_at',
    [paymentId],
  );
  return rows.map(({ event_type }) => event_type);
}

/** Both rows locked NOWAIT from another connection, then released: no other holds them. */
async function lockableNow(enrollmentId: string, paymentId: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: specDatabaseUrl('DATABASE_URL') });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM enrollments WHERE id = $1 FOR UPDATE NOWAIT', [enrollmentId]);
    await client.query('SELECT 1 FROM payments WHERE id = $1 FOR UPDATE NOWAIT', [paymentId]);
    await client.query('ROLLBACK');
    return true;
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    return false;
  } finally {
    await client.end();
  }
}

async function recorded(
  world: { teacherId: string; enrollmentId: string },
  mode?: 'test' | 'live',
) {
  return database.$transaction((tx) =>
    charges(mode === undefined ? {} : { mode }).record(tx as Transaction, month2(world)),
  );
}

async function deliver({ rawBody, headers }: { rawBody: Buffer; headers: Record<string, string> }) {
  const response = await fetch(new URL(PAYMENT_WEBHOOK_PATH, origin), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: rawBody,
  });
  await response.text();
  return response.status;
}

describe('order before call (006:T014, R-509)', () => {
  it('records the month `created`, automatic, its attempt, no gateway id, expiring in 10 minutes, at the month’s gross and the assessment’s rate', async () => {
    const world = await programmeWorld();

    const answer = await recorded(world);

    expect(answer.outcome).toBe('recorded');
    expect(await automaticOrdersOf(world.enrollmentId)).toMatchObject([
      {
        status: 'created',
        automatic: true,
        attempt: 0,
        kind: 'instalment',
        instalment_month: 2,
        gateway_order_id: null,
        decline_kind: null,
        month_gross: true,
        share_at_rate: true,
        ten_minutes: true,
      },
    ]);
  });

  it('records nothing with no saved card', async () => {
    const world = await programmeWorld({ card: false });

    await expect(recorded(world)).resolves.toEqual({ outcome: 'no_card' });
    expect(await automaticOrdersOf(world.enrollmentId)).toEqual([]);
  });

  it('in live mode with no payee, records failed/hard with no gateway id, no call, no push, never expired (PR #153 r3 Major 1)', async () => {
    const world = await programmeWorld();
    const calls = fake.calls.length;
    const pushed = pushes.length;

    const answer = await recorded(world, 'live');

    expect(answer.outcome).toBe('refused');
    const [order] = await automaticOrdersOf(world.enrollmentId);
    expect(order).toMatchObject({ status: 'failed', decline_kind: 'hard', gateway_order_id: null });
    expect(fake.calls.length).toBe(calls);
    expect(pushes.length).toBe(pushed);
    await database.$transaction(async (tx) => {
      await markOrdersExpired(
        tx as Transaction,
        [order!.id],
        new Date(addMinutes(new Date(), TEN_MINUTES * 9)),
      );
    });
    expect((await automaticOrdersOf(world.enrollmentId))[0]?.status).toBe('failed');
  });
});

describe('the call (006:T014, SRS DEC-113 (2))', () => {
  it('holds no lock while the gateway is called, commits the order id before the payment, and pays once', async () => {
    const world = await programmeWorld();
    const seen: { lockable: boolean[]; idBeforePay: string | null } = {
      lockable: [],
      idBeforePay: null,
    };
    const watching: PaymentPort = Object.assign(Object.create(fake) as PaymentPort, {
      inquireOrder: (id: string) => fake.inquireOrder(id),
      chargeSavedCard: async (...args: Parameters<PaymentPort['chargeSavedCard']>) => {
        const paymentId = args[0];
        seen.lockable.push(await lockableNow(world.enrollmentId, paymentId));
        const recordOrder = args[6];
        return fake.chargeSavedCard(
          args[0],
          args[1],
          args[2],
          args[3],
          args[4],
          args[5],
          async (id) => {
            const took = await recordOrder(id);
            seen.idBeforePay =
              (await automaticOrdersOf(world.enrollmentId))[0]?.gateway_order_id ?? null;
            seen.lockable.push(await lockableNow(world.enrollmentId, paymentId));
            return took;
          },
        );
      },
    });
    const viaWatching = await database.$transaction((tx) =>
      charges({ payment: watching }).record(tx as Transaction, month2(world)),
    );
    if (viaWatching.outcome !== 'recorded') throw new Error('not recorded');

    await expect(viaWatching.charge()).resolves.toBe('sent');
    await expect(viaWatching.charge()).resolves.toBe('not_sent');

    expect(seen.lockable).toEqual([true, true]);
    expect(seen.idBeforePay).toMatch(/^fake_ord_/);
    expect(
      fake.calls.filter(
        ({ operation, args }) =>
          operation === 'chargeSavedCard' && args[0] === viaWatching.paymentId,
      ),
    ).toHaveLength(1);
  });

  // PR #160 r1 Minor 3: the one database guard of «sent once» (`recordGatewayOrderId`'s
  // `gatewayOrderId: null`). Two calls for one order, as a second caller would make them: the first
  // writes its id and pays, the second's id is refused and it pays nothing.
  it('records the order id once: a second call for the same order is refused its id and sends no payment', async () => {
    const world = await programmeWorld();
    const recordedIds: boolean[] = [];
    const steps: string[] = [];
    const gatewayIds: string[] = [];
    const twice: PaymentPort = Object.assign(Object.create(fake) as PaymentPort, {
      inquireOrder: (id: string) => fake.inquireOrder(id),
      chargeSavedCard: async (...args: Parameters<PaymentPort['chargeSavedCard']>) => {
        const counting = async (id: string) => {
          const took = await args[6](id);
          recordedIds.push(took);
          return took;
        };
        const first = await fake.chargeSavedCard(
          args[0],
          args[1],
          args[2],
          args[3],
          args[4],
          args[5],
          counting,
        );
        const second = await fake.chargeSavedCard(
          args[0],
          args[1],
          args[2],
          args[3],
          args[4],
          args[5],
          counting,
        );
        for (const one of [first, second]) {
          steps.push(one.step);
          if ('gatewayOrderId' in one) gatewayIds.push(one.gatewayOrderId);
        }
        return first;
      },
    });
    const answer = await database.$transaction((tx) =>
      charges({ payment: twice }).record(tx as Transaction, month2(world)),
    );
    if (answer.outcome !== 'recorded') throw new Error('not recorded');

    await expect(answer.charge()).resolves.toBe('sent');

    expect(recordedIds).toEqual([true, false]);
    expect(steps).toEqual(['payment_sent', 'order_not_recorded']);
    expect(await automaticOrdersOf(world.enrollmentId)).toMatchObject([
      { status: 'created', gateway_order_id: gatewayIds[0] },
    ]);
    const answers = await Promise.all(gatewayIds.map((id) => fake.inquireOrder(id)));
    expect(answers.map(({ answer }) => answer)).toEqual(['transaction', 'none']);
  });

  it('expires the order at once when the gateway’s order went unanswered (a soft decline, no inquiry)', async () => {
    const world = await programmeWorld();
    const answer = await recorded(world);
    if (answer.outcome !== 'recorded') throw new Error('not recorded');
    fake.onCharge('order_unanswered');
    const asked = fake.calls.filter(({ operation }) => operation === 'inquireOrder').length;

    await expect(answer.charge()).resolves.toBe('soft_declined');

    expect(await automaticOrdersOf(world.enrollmentId)).toMatchObject([
      { status: 'expired', gateway_order_id: null },
    ]);
    expect(fake.calls.filter(({ operation }) => operation === 'inquireOrder').length).toBe(asked);
  });

  it('records a refusal before the gateway failed/hard with no gateway id and no push', async () => {
    const world = await programmeWorld();
    const answer = await recorded(world);
    if (answer.outcome !== 'recorded') throw new Error('not recorded');
    fake.failNext('chargeSavedCard', new ChargeRefusedError('charge_off'));
    const pushed = pushes.length;

    await expect(answer.charge()).resolves.toBe('refused');

    expect(await automaticOrdersOf(world.enrollmentId)).toMatchObject([
      { status: 'failed', decline_kind: 'hard', gateway_order_id: null },
    ]);
    expect(pushes.length).toBe(pushed);
  });

  it('sends no payment when the inquiry expired the order while its first step was in flight (the id’s conditional write)', async () => {
    const world = await programmeWorld();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached: () => void = () => undefined;
    const atStep1 = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const slow: PaymentPort = Object.assign(Object.create(fake) as PaymentPort, {
      inquireOrder: (id: string) => fake.inquireOrder(id),
      chargeSavedCard: async (...args: Parameters<PaymentPort['chargeSavedCard']>) =>
        fake.chargeSavedCard(args[0], args[1], args[2], args[3], args[4], args[5], async (id) => {
          reached();
          await held;
          return args[6](id);
        }),
    });
    const answer = await database.$transaction((tx) =>
      charges({ payment: slow }).record(tx as Transaction, month2(world)),
    );
    if (answer.outcome !== 'recorded') throw new Error('not recorded');

    const charging = answer.charge();
    await atStep1;
    aheadMinutes = TEN_MINUTES * 2;
    try {
      await expect(chargesAhead().inquire(answer.paymentId)).resolves.toBe('none');
    } finally {
      aheadMinutes = 0;
    }
    release();

    await expect(charging).resolves.toBe('not_sent');
    expect(await automaticOrdersOf(world.enrollmentId)).toMatchObject([
      { status: 'expired', gateway_order_id: null },
    ]);
  });
});

/** The entry with its clock `aheadMinutes` past the real one. */
function chargesAhead() {
  return createProgrammeCharges({
    database,
    payment: fake,
    cipher,
    gateway: 'fake',
    paymentMode: 'test',
    settings,
    log,
    confirmations,
    notices: notices as never,
    report: () => undefined,
    now: () => new Date(addMinutes(new Date(), aheadMinutes)),
  });
}

describe('the inquiry (006:T014, SRS DEC-110, DEC-113 (1))', () => {
  async function sent(answer?: 'paid' | 'soft' | 'hard' | 'payment_lost') {
    const world = await programmeWorld();
    const recordedCharge = await recorded(world);
    if (recordedCharge.outcome !== 'recorded') throw new Error('not recorded');
    if (answer !== undefined) fake.onCharge(answer);
    await expect(recordedCharge.charge()).resolves.toBe('sent');
    const [order] = await automaticOrdersOf(world.enrollmentId);
    return {
      ...world,
      paymentId: recordedCharge.paymentId,
      gatewayOrderId: order!.gateway_order_id!,
    };
  }

  async function askLater(paymentId: string) {
    aheadMinutes = TEN_MINUTES * 2;
    try {
      return await chargesAhead().inquire(paymentId);
    } finally {
      aheadMinutes = 0;
    }
  }

  it('asks nothing before the order’s expiry', async () => {
    const { paymentId } = await sent('paid');
    const asked = fake.calls.filter(({ operation }) => operation === 'inquireOrder').length;

    await expect(chargesAhead().inquire(paymentId)).resolves.toBe('pending');
    expect(fake.calls.filter(({ operation }) => operation === 'inquireOrder').length).toBe(asked);
  });

  it('expires a crash between the commit and the call with no question: no payment was sent', async () => {
    const world = await programmeWorld();
    const answer = await recorded(world);
    if (answer.outcome !== 'recorded') throw new Error('not recorded');
    const asked = fake.calls.filter(({ operation }) => operation === 'inquireOrder').length;

    await expect(askLater(answer.paymentId)).resolves.toBe('none');

    expect(await automaticOrdersOf(world.enrollmentId)).toMatchObject([{ status: 'expired' }]);
    expect(fake.calls.filter(({ operation }) => operation === 'inquireOrder').length).toBe(asked);
  });

  it('records a paid answer through the webhook’s branch: paid, the confirm step enqueued, the late callback a replay', async () => {
    const { enrollmentId, paymentId, gatewayOrderId } = await sent('paid');

    await expect(askLater(paymentId)).resolves.toBe('paid');

    expect((await automaticOrdersOf(enrollmentId))[0]?.status).toBe('paid');
    expect(await eventsOf(paymentId)).toEqual(['paid']);
    expect(enqueued).toContain(paymentId);
    expect(await deliver(fake.orderEvent(gatewayOrderId, 'paid'))).toBe(200);
    expect(await eventsOf(paymentId)).toEqual(['paid']);
  });

  it('writes the kind the inquiry answers after a signed failed callback that carried none (Q-10 (a) adjusted)', async () => {
    const { enrollmentId, paymentId, gatewayOrderId } = await sent('soft');
    expect(await deliver(fake.orderEvent(gatewayOrderId, 'failed'))).toBe(200);
    expect(await automaticOrdersOf(enrollmentId)).toMatchObject([
      { status: 'failed', decline_kind: null },
    ]);

    await expect(askLater(paymentId)).resolves.toBe('declined_soft');

    expect(await automaticOrdersOf(enrollmentId)).toMatchObject([
      { status: 'failed', decline_kind: 'soft' },
    ]);
    expect(await eventsOf(paymentId)).toEqual(['failed']);
  });

  it('moves an unanswered order failed with its kind when the inquiry finds the decline first', async () => {
    const { enrollmentId, paymentId } = await sent('hard');

    await expect(askLater(paymentId)).resolves.toBe('declined_hard');

    expect(await automaticOrdersOf(enrollmentId)).toMatchObject([
      { status: 'failed', decline_kind: 'hard' },
    ]);
  });

  // 006:T023 (B-P4 update 1; quickstart §2 step 6, «the student gets the `payment_failed` push»):
  // a soft decline the inquiry finds is recorded through the webhook's order branch, which records
  // the failed order's push to the programme's student on the same transaction (005:T016), once.
  it('records the student’s payment_failed push once when the inquiry finds a soft decline', async () => {
    const { studentId, enrollmentId, paymentId } = await sent('soft');
    const before = pushes.length;

    await expect(askLater(paymentId)).resolves.toBe('declined_soft');

    const notices = pushes.slice(before).map((args) => (args as unknown[])[1]);
    expect(notices).toEqual([
      { userId: studentId, type: 'payment_failed', payload: { enrollmentId } },
    ]);
    expect(await eventsOf(paymentId)).toEqual(['failed']);
  });

  it('changes nothing on no answer', async () => {
    const { enrollmentId, paymentId, gatewayOrderId } = await sent('paid');
    fake.onInquiry(gatewayOrderId, 'no_answer');

    await expect(askLater(paymentId)).resolves.toBe('no_answer');

    expect(await automaticOrdersOf(enrollmentId)).toMatchObject([{ status: 'created' }]);
    expect(await eventsOf(paymentId)).toEqual([]);
  });

  it('expires the order when the gateway has no transaction (a soft decline)', async () => {
    const { enrollmentId, paymentId } = await sent('payment_lost');

    await expect(askLater(paymentId)).resolves.toBe('none');

    expect(await automaticOrdersOf(enrollmentId)).toMatchObject([{ status: 'expired' }]);
  });

  // 006:T022 (B-P4, Q-10 (a); PR #160 r2 Minor 1; ADR 0026: the inquiry's answer stands for the
  // signed webhook for an automatic charge only). A manual `instalment` order of month 2, its gateway
  // id one under which the stand-in holds a paid transaction, past its expiry: the inquiry refuses
  // it before asking, so nothing records the payment but the signed webhook.
  it('refuses a manual instalment order with a gateway id past its expiry: it stays created, no payment_events row (ADR 0026)', async () => {
    const world = await programmeWorld({ card: false });
    fake.onCharge('paid');
    const charged = await fake.chargeSavedCard(
      randomUUID(),
      piasters(100_000),
      'EGP',
      new Date(addMinutes(new Date(), TEN_MINUTES)),
      'unused-token',
      undefined,
      async () => true,
    );
    if (charged.step !== 'payment_sent') throw new Error('the stand-in made no transaction');
    const [{ id: paymentId }] = await database.$queryRaw<[{ id: string }]>`
      INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                            status, expires_at, kind, instalment_month,
                            teacher_share_rate_percent, teacher_share_piasters, updated_at)
      VALUES (${world.enrollmentId}::uuid, 'fake', ${charged.gatewayOrderId}, 100000, 'EGP',
              'created', now() + interval '10 minutes', 'instalment', 2, 70, 70000, now())
      RETURNING id::text`;
    const asked = fake.calls.filter(({ operation }) => operation === 'inquireOrder').length;

    await expect(askLater(paymentId)).rejects.toThrow(/not an automatic charge/);

    const { rows } = await observer.query<{ status: string; automatic: boolean }>(
      'SELECT status::text, automatic FROM payments WHERE id = $1',
      [paymentId],
    );
    expect(rows).toEqual([{ status: 'created', automatic: false }]);
    expect(await eventsOf(paymentId)).toEqual([]);
    expect(fake.calls.filter(({ operation }) => operation === 'inquireOrder').length).toBe(asked);
  });
});

describe('expire-pending-payments leaves automatic orders to the inquiry (006:T014)', () => {
  it('neither lists nor expires an automatic order past its expiry', async () => {
    const world = await programmeWorld();
    const answer = await recorded(world);
    if (answer.outcome !== 'recorded') throw new Error('not recorded');
    const later = new Date(addMinutes(new Date(), TEN_MINUTES * 2));

    const ids: string[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await expiredOrderIds(database, later, after, 500);
      ids.push(...page);
      if (page.length < 500) break;
      after = page.at(-1);
    }
    expect(ids).not.toContain(answer.paymentId);
    await database.$transaction(async (tx) => {
      await markOrdersExpired(tx as Transaction, [answer.paymentId], later);
    });
    expect((await automaticOrdersOf(world.enrollmentId))[0]?.status).toBe('created');
  });
});

describe('SC-707: no card detail leaves the entry', () => {
  it('writes no token in a log line, a result or an enqueued payload', async () => {
    const world = await programmeWorld();
    const answer = await recorded(world);
    if (answer.outcome !== 'recorded') throw new Error('not recorded');
    fake.onCharge('paid');
    await answer.charge();

    expect(JSON.stringify(answer)).not.toContain(TOKEN);
    expect(logLines.join('\n')).not.toContain(TOKEN);
    expect(JSON.stringify(enqueued)).not.toContain(TOKEN);
    expect(enqueued.every((value) => typeof value === 'string')).toBe(true);
  });
});
