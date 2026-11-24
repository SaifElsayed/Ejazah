// 006:T013 of specs/006-programme/tasks.md (FR-713, FR-719; R-510; SC-707; B-P3's conflict check,
// Q-4 (a)) — a programme's saved card over the real tables, as the application role:
// - the payment webhook as the application mounts it records a signed `card_saved` beside its
//   `payment_events` row and, on the same transaction, writes the card: the token encrypted by the
//   column cipher under `programme_cards.token_encrypted` with the enrollment's id bound, the last
//   four and the brand, `consented_at` copied from the paying order's `card_consent_at`; no order
//   moves and nothing is enqueued; a replay writes nothing more;
// - no card for an order that carries no consent, nor for a programme already closed (R-510), the
//   event recorded in both; a `card_saved` racing a close waits on the enrollment the close holds
//   and then writes none;
// - payments' `deleteProgrammeCard` deletes the enrollment's card on the caller's transaction and no
//   other (run in a transaction rolled back: a mutant widening its DELETE touches no committed row);
// - Q-4 (a): an administrator's deletion of a student with a saved card leaves no `programme_cards`
//   row (the close hook, through booking's termination subscriber, as `main.ts` subscribes it), and
//   a `card_saved` arriving after it writes none;
// - SC-707: no token in any log line, in the webhook's answers, or in a payload it enqueues (ids only).
//
// Committed worlds of their own (the webhook runs its own transactions), as
// `programme-windows.spec.ts`' are.
//
// Observed red: every case against T013's stubs (the writer writing nothing, the deletion deleting
// nothing); the negatives under named mutants (`R/lane-a`), restored and `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createOngoingEnrollments,
  enrollmentIdsOfTeacher,
  terminationSubscriber,
} from '../../apps/api/src/modules/booking/index';
import { openRequestCountOfTeacher } from '../../apps/api/src/modules/certification/index';
import {
  AccountConsequences,
  createIdentityServices,
} from '../../apps/api/src/modules/identity/index';
import { openCompensationCasesAmong } from '../../apps/api/src/modules/moderation/index';
import {
  createPaymentWebhookRoute,
  deleteProgrammeCard,
  orderStandingsOf,
  PAYMENT_WEBHOOK_PATH,
} from '../../apps/api/src/modules/payments/index';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { lockRows } from '../../apps/api/src/platform/db/row-lock';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import {
  bindToTransaction,
  RequestLive,
  unboundBus,
} from '../../apps/api/src/platform/live/live-publisher';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import {
  createPaymentPort,
  type PaymentConfig,
  standInWebhookSecret,
} from '../../apps/api/src/platform/ports/payment/index';
import type { PaymentPort } from '../../apps/api/src/platform/ports/payment/payment.port';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader';
import { piasters } from '../../packages/money/src/index';
import { gatewayStandIn } from '../support/gateway-stand-in';
import {
  CAIRO,
  confirmationWorld,
  SETTINGS as CONFIRMATION_SETTINGS,
  THURSDAY_0900,
} from './confirmation-world';

const KEY = Buffer.alloc(32, 7).toString('base64');
const cipher = new ColumnCipher(KEY);
const COLUMN = 'programme_cards.token_encrypted';
/** The stand-in's configuration: its webhook secret derived from the key, as the API derives it. */
const PAYMENT: PaymentConfig = {
  PAYMENT_GATEWAY: 'fake',
  PAYMENT_MODE: 'test',
  ENCRYPTION_KEY: KEY,
};
const WEBHOOK_SECRET = standInWebhookSecret(PAYMENT);
const CONSENT = new Date('2026-11-24T09:00:00Z');
const SILENT = { info: () => undefined, warn: () => undefined, error: () => undefined };

const SETTINGS: Readonly<Record<string, unknown>> = {
  ...CONFIRMATION_SETTINGS,
  otp_code_ttl_minutes: 10,
  otp_max_attempts: 5,
  onboarding_token_ttl_minutes: 15,
  session_access_ttl_minutes: 15,
  session_refresh_ttl_days: 30,
  session_refresh_grace_seconds: 30,
  provider_nonce_ttl_minutes: 10,
  idempotency_key_ttl_hours: 24,
  enrollment_restore_window_days: 14,
  ban_restore_window_days: 14,
  admin_list_page_size: 50,
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  repeated_absence_flag_count: 3,
  document_link_ttl_seconds: 300,
};
const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};

let database: Database;
let server: Server;
let origin: string;
let adminId: string;
const gateway: PaymentPort = createPaymentPort(PAYMENT);

/** A signed event as the webhook receives it. */
interface SignedEvent {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * The stand-in's events, signed as `fake.adapter.ts` signs them (HMAC-SHA256 of the body under the
 * webhook secret, `x-fake-signature`), its wire shape held by `fake.adapter.spec.ts`. Built here:
 * `tests/support/gateway-stand-in.ts` has no `card_saved` builder yet (a follow-up of T013).
 */
function signedEvent(body: object, secret = WEBHOOK_SECRET): SignedEvent {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
  return { rawBody, headers: { 'x-fake-signature': signature } };
}

/** The gateway's word that it saved the order's card: a new placeholder token each time. */
function cardSaved(
  gatewayOrderId: string,
  {
    last4 = '4242',
    brand = 'Visa',
    signature = 'valid',
  }: { last4?: string; brand?: string; signature?: 'valid' | 'invalid' } = {},
): SignedEvent {
  return signedEvent(
    {
      id: `fake_evt_${randomUUID()}`,
      type: 'card_saved',
      order: gatewayOrderId,
      token: `fake_tok_${randomUUID()}`,
      last4,
      brand,
    },
    signature === 'valid' ? WEBHOOK_SECRET : randomBytes(32).toString('hex'),
  );
}
/** Every line the webhook's logger wrote, as written. */
const logLines: string[] = [];
/** Every value the webhook handed `confirm-enrollment`'s queue. */
const enqueued: unknown[] = [];

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  const route = createPaymentWebhookRoute({
    database,
    payment: gateway,
    log: createLogger({ level: 'info', destination: { write: (line) => logLines.push(line) } }),
    maxBodyBytes: 1_048_576,
    confirmations: {
      enqueue: async (paymentId) => {
        enqueued.push(paymentId);
      },
    },
    notices: { record: async () => undefined },
    report: () => undefined,
    cipher,
  });
  server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (!url.startsWith(PAYMENT_WEBHOOK_PATH)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    request.url = url.slice(PAYMENT_WEBHOOK_PATH.length) || '/';
    route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ id: adminId } = await database.adminUser.create({
    data: {
      email: `probe-admin-${randomUUID()}@example.invalid`,
      passwordHash: 'probe-hash',
      mfaSecretEncrypted: Buffer.from('probe'),
      displayName: 'Probe administrator',
      isActive: true,
    },
    select: { id: true },
  }));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabase(database);
});

const { person } = confirmationWorld(() => database);

/** The webhook's answers, as the gateway reads them. */
const answers: string[] = [];

/** Delivers a signed event to the webhook over HTTP; its status. */
async function deliver({ rawBody, headers }: SignedEvent): Promise<number> {
  const response = await fetch(new URL(PAYMENT_WEBHOOK_PATH, origin), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: rawBody,
  });
  answers.push(await response.text());
  return response.status;
}

/** The token a signed `card_saved` carries, read from the body this spec signed. */
function tokenOf({ rawBody }: SignedEvent): string {
  return (JSON.parse(rawBody.toString('utf8')) as { token: string }).token;
}

/**
 * A programme in `state`, its first month paid by hand on an order of the stand-in's whose checkout
 * asked `saveCard`, that order carrying the student's consent unless `consent` is false.
 */
async function programmeWorld({
  state = 'active',
  consent = true,
}: { readonly state?: 'active' | 'closed'; readonly consent?: boolean } = {}) {
  const teacherId = await person('female');
  await database.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
      payoutAccountRefEncrypted: Buffer.from('probe'),
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
      price30Piasters: 20_000n,
      price45Piasters: 25_000n,
      price60Piasters: 30_000n,
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
      snapshotPricePiasters: 50_000n,
      snapshotSessionCount: 1,
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
      state,
      offeredAt: new Date('2026-11-20T07:00:00Z'),
      monthCount: 3,
      paymentPlan: 'monthly',
      monthsPaid: 1,
      ...(state === 'closed' ? { closedAt: new Date('2026-11-24T08:00:00Z') } : {}),
    },
  });
  const { gatewayOrderId } = await gateway.createCheckout(
    enrollmentId,
    piasters(100_000),
    'EGP',
    new Date('2026-11-24T10:10:00Z'),
    undefined,
    true,
  );
  // Written by SQL, as `expiry-world.ts`' orders are (the amount column is named only in payments,
  // R-MONEY-6).
  const [order] = await database.$queryRaw<{ id: string }[]>`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency, status,
                          expires_at, kind, instalment_month, card_consent_at, updated_at)
    VALUES (${enrollmentId}::uuid, 'fake', ${gatewayOrderId}, 100000, 'EGP', 'paid',
            '2026-11-24T10:10:00Z', 'instalment', 1, ${consent ? CONSENT : null}::timestamptz, now())
    RETURNING id::text AS id`;
  if (order === undefined) throw new Error('no order written');
  return { teacherId, studentId, enrollmentId, gatewayOrderId, paymentId: order.id };
}

type CardRow = {
  token_encrypted: Buffer;
  last4: string;
  brand: string;
  consented_at: Date;
};

async function cardOf(enrollmentId: string): Promise<CardRow | undefined> {
  const [row] = await database.$queryRaw<CardRow[]>`
    SELECT token_encrypted, last4, brand, consented_at
      FROM programme_cards WHERE enrollment_id = ${enrollmentId}::uuid`;
  return row;
}

async function eventsOf(paymentId: string): Promise<{ event_type: string }[]> {
  return database.$queryRaw<{ event_type: string }[]>`
    SELECT event_type::text AS event_type FROM payment_events
     WHERE payment_id = ${paymentId}::uuid ORDER BY received_at`;
}

async function statusOf(paymentId: string): Promise<string> {
  const [row] = await database.$queryRaw<{ status: string }[]>`
    SELECT status::text AS status FROM payments WHERE id = ${paymentId}::uuid`;
  return row?.status ?? 'none';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a saved card written by the webhook, beside its event (006:T013, R-510)', () => {
  it('writes the card, its token encrypted under the column and the enrollment’s id, consented_at the order’s consent; no order moves, nothing enqueued', async () => {
    const w = await programmeWorld();
    const before = enqueued.length;
    const event = cardSaved(w.gatewayOrderId, { last4: '1111', brand: 'MasterCard' });

    expect(await deliver(event)).toBe(200);
    const card = await cardOf(w.enrollmentId);
    expect(card).toMatchObject({ last4: '1111', brand: 'MasterCard', consented_at: CONSENT });
    expect(cipher.decrypt(card?.token_encrypted ?? Buffer.alloc(0), COLUMN, w.enrollmentId)).toBe(
      tokenOf(event),
    );
    expect(card?.token_encrypted.includes(Buffer.from(tokenOf(event)))).toBe(false);
    expect(await eventsOf(w.paymentId)).toEqual([{ event_type: 'card_saved' }]);
    expect(await statusOf(w.paymentId)).toBe('paid');
    expect(enqueued.length).toBe(before);
  });

  it('a replay writes nothing more: one event, the same card', async () => {
    const w = await programmeWorld();
    const event = cardSaved(w.gatewayOrderId);
    expect(await deliver(event)).toBe(200);
    const first = await cardOf(w.enrollmentId);
    expect(first).toBeDefined();

    expect(await deliver(event)).toBe(200);
    expect(await eventsOf(w.paymentId)).toEqual([{ event_type: 'card_saved' }]);
    expect(await cardOf(w.enrollmentId)).toEqual(first);
  });

  it('a later card saved on the programme replaces the row («change card»)', async () => {
    const w = await programmeWorld();
    expect(await deliver(cardSaved(w.gatewayOrderId, { last4: '1111' }))).toBe(200);
    const later = cardSaved(w.gatewayOrderId, { last4: '2222', brand: 'Meeza' });

    expect(await deliver(later)).toBe(200);
    const card = await cardOf(w.enrollmentId);
    expect(card).toMatchObject({ last4: '2222', brand: 'Meeza' });
    expect(cipher.decrypt(card?.token_encrypted ?? Buffer.alloc(0), COLUMN, w.enrollmentId)).toBe(
      tokenOf(later),
    );
  });

  it('writes no card for an order that carries no consent; the event is recorded', async () => {
    const w = await programmeWorld({ consent: false });

    expect(await deliver(cardSaved(w.gatewayOrderId))).toBe(200);
    expect(await cardOf(w.enrollmentId)).toBeUndefined();
    expect(await eventsOf(w.paymentId)).toEqual([{ event_type: 'card_saved' }]);
  });

  it('writes no card for a programme already closed; the event is recorded (R-510)', async () => {
    const w = await programmeWorld({ state: 'closed' });

    expect(await deliver(cardSaved(w.gatewayOrderId))).toBe(200);
    expect(await cardOf(w.enrollmentId)).toBeUndefined();
    expect(await eventsOf(w.paymentId)).toEqual([{ event_type: 'card_saved' }]);
  });

  it('a card_saved racing a close waits on the enrollment the close holds, then reads it closed and writes none', async () => {
    const w = await programmeWorld();
    let delivered: Promise<number> | undefined;
    // The close's order (kernel.md, 006:T008): the programme, then the enrollment; the move, then
    // the commit. The event arrives while both are held.
    await database.$transaction(async (tx) => {
      await lockRows(tx as Transaction, 'programmes', [w.enrollmentId]);
      await lockRows(tx as Transaction, 'enrollments', [w.enrollmentId]);
      await tx.$executeRaw`
        UPDATE programmes SET state = 'closed', closed_at = clock_timestamp()
         WHERE enrollment_id = ${w.enrollmentId}::uuid`;
      delivered = deliver(cardSaved(w.gatewayOrderId));
      await sleep(600);
      expect(await eventsOf(w.paymentId)).toEqual([]);
    });

    expect(await delivered).toBe(200);
    expect(await cardOf(w.enrollmentId)).toBeUndefined();
    expect(await eventsOf(w.paymentId)).toEqual([{ event_type: 'card_saved' }]);
  });
});

describe('payments’ deleteProgrammeCard (006:T013, the close hook’s entry)', () => {
  const ROLLBACK = new Error('rolled back on purpose: the probe leaves no row behind');

  it('deletes the enrollment’s card on the caller’s transaction, and no other programme’s', async () => {
    const mine = await programmeWorld();
    const other = await programmeWorld();
    const seen: { mine: number; other: number }[] = [];
    await database
      .$transaction(async (tx) => {
        for (const w of [mine, other]) {
          await tx.$executeRaw`
            INSERT INTO programme_cards (enrollment_id, token_encrypted, last4, brand, consented_at,
                                         updated_at)
            VALUES (${w.enrollmentId}::uuid, ${cipher.encrypt('tok_probe', COLUMN, w.enrollmentId)},
                    '4242', 'Visa', ${CONSENT}, now())`;
        }
        await lockRows(tx as Transaction, 'programmes', [mine.enrollmentId]);
        await deleteProgrammeCard(tx as Transaction, mine.enrollmentId);
        const count = async (enrollmentId: string) => {
          const [row] = await tx.$queryRaw<[{ n: number }]>`
            SELECT count(*)::int AS n FROM programme_cards WHERE enrollment_id = ${enrollmentId}::uuid`;
          return row.n;
        };
        seen.push({ mine: await count(mine.enrollmentId), other: await count(other.enrollmentId) });
        throw ROLLBACK;
      })
      .catch((error: unknown) => {
        if (error !== ROLLBACK) throw error;
      });

    expect(seen).toEqual([{ mine: 0, other: 1 }]);
  });
});

describe('an account’s erasure reaches the card through the close hook (Q-4 (a))', () => {
  /** The deletion as `main.ts` builds it, booking's subscriber bound to payments' card entry. */
  function deletion() {
    const consequences = new AccountConsequences();
    consequences.subscribe(
      terminationSubscriber({ orders: orderStandingsOf, log: SILENT, deleteProgrammeCard }),
    );
    const unreachable = () => Promise.reject(new Error('probe: not reached'));
    return createIdentityServices({
      database,
      settings,
      encryptionKey: KEY,
      cipher,
      marks: new MemorySingleUseMarks(() => new Date()),
      signIn: {
        verifyIdentityToken: unreachable,
        exchangeAuthorization: unreachable,
        revoke: unreachable,
      },
      email: { deliver: async () => undefined },
      storage: { temporaryLink: unreachable, remove: async () => undefined },
      log: SILENT,
      payment: { registerPayoutRecipient: unreachable },
      idempotency: new IdempotencyService<Transaction>({
        store: new IdempotencyRepository(database),
        settings,
      }),
      consequences,
      fileErasures: [],
      ongoingEnrollments: createOngoingEnrollments({ settings }),
      openIjazahRequests: { count: openRequestCountOfTeacher },
      openCases: {
        count: async (tx, teacherUserId) =>
          openCompensationCasesAmong(tx, await enrollmentIdsOfTeacher(tx, teacherUserId)),
      },
      report: () => undefined,
    }).deletion;
  }

  async function deleteByAdministrator(userId: string): Promise<void> {
    const live = new RequestLive(unboundBus, SILENT);
    await database.$transaction(
      async (tx) => {
        const unbind = bindToTransaction(tx, live);
        try {
          await deletion().deleteByAdministrator(tx, adminId, {
            targetUserId: userId,
            reason: 'طلب صاحب الحساب الحذف عبر الدعم',
            idempotencyKey: randomUUID(),
          });
        } finally {
          unbind();
        }
      },
      { timeout: 30_000 },
    );
    live.flush();
  }

  it('an administrator’s deletion of a student with a saved card leaves no programme_cards row, and a card_saved after it writes none', async () => {
    const w = await programmeWorld();
    expect(await deliver(cardSaved(w.gatewayOrderId))).toBe(200);
    expect(await cardOf(w.enrollmentId)).toBeDefined();

    await deleteByAdministrator(w.studentId);
    expect(await cardOf(w.enrollmentId)).toBeUndefined();
    const [programme] = await database.$queryRaw<{ state: string }[]>`
      SELECT state::text AS state FROM programmes WHERE enrollment_id = ${w.enrollmentId}::uuid`;
    expect(programme?.state).toBe('closed');

    expect(await deliver(cardSaved(w.gatewayOrderId))).toBe(200);
    expect(await cardOf(w.enrollmentId)).toBeUndefined();
  });
});

describe('no card detail leaves the webhook (SC-707)', () => {
  it('no token in any log line or answer, and every enqueued payload an order id alone', async () => {
    const w = await programmeWorld();
    const lines = logLines.length;
    const said = answers.length;
    const queued = enqueued.length;
    const saved = cardSaved(w.gatewayOrderId);
    const token = tokenOf(saved);
    const { gatewayOrderId } = await gateway.createCheckout(
      w.enrollmentId,
      piasters(100_000),
      'EGP',
      new Date('2026-11-24T10:10:00Z'),
    );
    await database.$executeRaw`
      INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                            status, expires_at, kind, instalment_month, updated_at)
      VALUES (${w.enrollmentId}::uuid, 'fake', ${gatewayOrderId}, 100000, 'EGP', 'created',
              '2026-11-24T10:10:00Z', 'instalment', 2, now())`;

    expect(await deliver(saved)).toBe(200);
    expect(await deliver(saved)).toBe(200);
    expect(await deliver(cardSaved(w.gatewayOrderId, { signature: 'invalid' }))).toBe(401);
    const stand = gatewayStandIn({ origin, config: PAYMENT, payment: gateway });
    expect(await deliver(stand.paid(gatewayOrderId))).toBe(200);

    const written = [...logLines.slice(lines), ...answers.slice(said)].join('\n');
    expect(written).not.toContain(token);
    expect(written).not.toContain('fake_tok_');
    const payloads = enqueued.slice(queued);
    expect(payloads).toHaveLength(1);
    for (const payload of payloads) {
      expect(payload).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
