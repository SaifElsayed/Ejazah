// T041 — an account's end reaches its holds and pending enrollments over the real tables (R-219; SRS
// FR-PAYG-6 and FR-BOOK-9 as amended 2026-11-01 and 2026-11-03, FR-VERIFY-8, FR-AUTH-14; FR-362),
// booking's subscriber bound to identity's registry as `main.ts` binds it, the actions through
// identity's real services:
//
//   - a revocation after a Pay, then its paid event (the owner's decision of 2026-11-03): the
//     revocation releases the hold and cancels the enrollment `teacher_suspended` with one row; the
//     paid event, through the webhook, and `confirm-enrollment` run twice leave it cancelled with that
//     reason and open exactly one compensation case (`party_restricted`, T039's refusal branch);
//   - a teacher's suspension releases the holds on every slot of the teacher, an enrollment awaiting
//     payment cancelled `teacher_suspended` with one row; another teacher's hold is untouched;
//   - a teacher's ban keeps an enrollment with a paid order awaiting payment, with no row, its hold
//     released, for the confirm job (FR-PAYG-6 as amended 2026-11-03);
//   - a student's deletion releases the student's hold and cancels its enrollment `account_deleted`.
//
// Every action runs its own transaction, so the rows are committed and kept, each probe with a world
// of its own, as `confirmation-world.ts`' are. All connections are the application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { piasters } from '../../packages/money/src/index';
import {
  enrollOnHold,
  payStoreOver,
  payTargetOf,
  type QuotedSummary,
  terminationSubscriber,
} from '../../apps/api/src/modules/booking/index.js';
import { revokeSubjects } from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  createIdentityServices,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import { hashPassword } from '../../apps/api/src/platform/crypto/hashing.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  CAIRO,
  confirmationWorld,
  LATER,
  NOW,
  settings,
  THURSDAY_0900,
} from './confirmation-world';
import { listenWebhook, plantOrder, type Webhook } from './expiry-world';
import { connectAsApplication, type Db, makeAdmin } from './harness';

const KEY = randomBytes(32).toString('base64');
const PASSWORD = 'a long probe passphrase 41';
const FEMALE = 'female' as RequesterGender;
const identitySettings: SettingsReader = {
  read: async (key, schema) => schema.parse({ idempotency_key_ttl_hours: 24 }[key]),
};

let watcher: Db;
let database: Database;
let webhook: Webhook;
let standing: StandingService;
let deletion: ReturnType<typeof createIdentityServices>['deletion'];
/** The paid orders the webhook handed to `confirm-enrollment`. */
const enqueued: string[] = [];

beforeAll(async () => {
  watcher = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  // The one registry, booking's subscriber bound to it as `main.ts` binds it.
  const consequences = new AccountConsequences();
  consequences.subscribe(terminationSubscriber({ orders: orderStandingsOf, now: () => NOW }));
  standing = new StandingService({
    store: standingStoreOver(database),
    consequences,
    revokeSubjects,
    hasOpenIdentityRequest: async () => false,
  });
  const unreachable = () => Promise.reject(new Error('probe: not reached'));
  deletion = createIdentityServices({
    database,
    settings: identitySettings,
    encryptionKey: KEY,
    cipher: new ColumnCipher(KEY),
    marks: new MemorySingleUseMarks(() => new Date()),
    signIn: {
      verifyIdentityToken: unreachable,
      exchangeAuthorization: unreachable,
      revoke: unreachable,
    },
    email: { deliver: async () => undefined },
    storage: { temporaryLink: unreachable, remove: async () => undefined },
    log: { warn: () => undefined },
    payment: { registerPayoutRecipient: unreachable },
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings: identitySettings,
    }),
    consequences,
    report: () => undefined,
  }).deletion;
  webhook = await listenWebhook(database, {
    enqueue: async (paymentId) => {
      enqueued.push(paymentId);
    },
  });
}, 60_000);

afterAll(async () => {
  await webhook?.close();
  await watcher?.end();
  if (database !== undefined) await closeDatabase(database);
});

const { order, enrollmentOf, eventsOf, casesOf, sessionsOf } = confirmationWorld(() => database);

async function person(passwordHash?: string): Promise<string> {
  const { id } = await database.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      gender: 'female',
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      displayName: 'Probe person',
      preferredLanguage: 'ar',
      timezone: CAIRO,
      accountStatus: 'active',
      ...(passwordHash === undefined ? {} : { passwordHash }),
    },
    select: { id: true },
  });
  return id;
}

/** Thursday 09:00 and 10:00 Cairo, the local starts of an offer's slots. */
const STARTS = [THURSDAY_0900, new Date('1970-01-01T10:00:00Z')];

/** A teacher bookable by a female student, a four-session package and `slots` Thursday slots. */
async function offer(slots = 1) {
  const teacherId = await person();
  await database.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      applicationStatus: 'approved',
      payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    },
  });
  const { id: subjectId } = await database.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });
  const pkg = await database.package.create({
    data: {
      teacherUserId: teacherId,
      subjectId,
      sessionCount: 4,
      sessionDurationMinutes: 60,
      pricePiasters: 100_000n,
      isActive: true,
    },
    select: { id: true, track: true },
  });
  const slotIds: string[] = [];
  for (const startTimeLocal of STARTS.slice(0, slots)) {
    const { id } = await database.availabilitySlot.create({
      data: {
        teacherUserId: teacherId,
        dayOfWeek: 4,
        startTimeLocal,
        durationMinutes: 60,
        timezone: CAIRO,
        isActive: true,
      },
      select: { id: true },
    });
    slotIds.push(id);
  }
  return { teacherId, subjectId, packageId: pkg.id, track: pkg.track, slotIds };
}

type Offer = Awaited<ReturnType<typeof offer>>;

/** The student's running hold on the slot, before Pay. */
async function hold(on: Offer, slotId: string, studentId: string): Promise<string> {
  const { id } = await database.slotHold.create({
    data: {
      slotId,
      packageId: on.packageId,
      sessionCount: 4,
      studentUserId: studentId,
      expiresAt: LATER,
    },
    select: { id: true },
  });
  return id;
}

/** Pay on booking's side, as `checkout.pay` runs it (R-208): the enrollment's id. */
async function pay(on: Offer, studentId: string, holdId: string): Promise<string> {
  const quoted: QuotedSummary = {
    price_piasters: piasters(100_000),
    sessionCount: 4,
    sessionDurationMinutes: 60,
    track: on.track,
  };
  const store = payStoreOver();
  const target = await database.$transaction((tx) =>
    payTargetOf(tx, { studentUserId: studentId, holdId, at: NOW }, quoted, store),
  );
  const enrollmentId = randomUUID();
  await database.$transaction((tx) =>
    enrollOnHold(
      tx,
      target,
      {
        student: { userId: studentId, gender: FEMALE },
        enrollmentId,
        at: NOW,
        leadHours: 24,
        quoted,
      },
      store,
    ),
  );
  return enrollmentId;
}

async function released(holdId: string): Promise<boolean> {
  const row = await database.slotHold.findUniqueOrThrow({
    where: { id: holdId },
    select: { releasedAt: true },
  });
  return row.releasedAt !== null;
}

const cancelledRow = (reason: string) => ({
  kind: 'cancelled',
  cancellationReason: reason,
  paymentId: null,
  occurredAt: NOW,
});

describe('a revocation after a Pay, then its paid event (the owner’s decision of 2026-11-03)', () => {
  it('leaves the enrollment cancelled and opens exactly one compensation case', async () => {
    const on = await offer();
    const studentId = await person();
    const holdId = await hold(on, on.slotIds[0] ?? '', studentId);
    const enrollmentId = await pay(on, studentId, holdId);
    const { gatewayOrderId, paymentId } = await plantOrder(webhook, order, enrollmentId);
    const adminId = await makeAdmin(watcher);

    await database.$transaction((tx) =>
      standing.revokeApproval(tx, adminId, on.teacherId, 'Probe revocation'),
    );

    expect(await released(holdId)).toBe(true);
    expect(await enrollmentOf(enrollmentId)).toEqual({
      status: 'cancelled',
      cancellationReason: 'teacher_suspended',
      confirmedAt: null,
    });
    expect(await eventsOf(enrollmentId)).toEqual([cancelledRow('teacher_suspended')]);

    expect(await webhook.stand.deliver(webhook.stand.paid(gatewayOrderId))).toBe(200);
    expect(enqueued).toContain(paymentId);
    const job = confirmEnrollment({ database, settings, clock: () => NOW });
    await job.handle({ paymentId });
    await job.handle({ paymentId });

    expect(await enrollmentOf(enrollmentId)).toEqual({
      status: 'cancelled',
      cancellationReason: 'teacher_suspended',
      confirmedAt: null,
    });
    expect(await casesOf(enrollmentId)).toMatchObject([
      { kind: 'compensation_case', reason: 'party_restricted', status: 'open' },
    ]);
    expect(await sessionsOf(enrollmentId)).toEqual([]);
    expect(await database.slotHold.count({ where: { enrollmentId, releasedAt: null } })).toBe(0);
  });
});

describe("a teacher's end (R-219)", () => {
  it("a suspension releases the holds on every slot of the teacher, and no other teacher's", async () => {
    const on = await offer(2);
    const [slotA = '', slotB = ''] = on.slotIds;
    const [paying, browsing] = [await person(), await person()];
    const payingHold = await hold(on, slotA, paying);
    const enrollmentId = await pay(on, paying, payingHold);
    await order(enrollmentId, 'created');
    const browsingHold = await hold(on, slotB, browsing);
    const elsewhere = await offer();
    const otherHold = await hold(elsewhere, elsewhere.slotIds[0] ?? '', await person());
    const adminId = await makeAdmin(watcher);

    await database.$transaction((tx) => standing.suspend(tx, adminId, on.teacherId));

    expect([await released(payingHold), await released(browsingHold)]).toEqual([true, true]);
    expect(await released(otherHold)).toBe(false);
    expect(await enrollmentOf(enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'teacher_suspended',
    });
    expect(await eventsOf(enrollmentId)).toEqual([cancelledRow('teacher_suspended')]);
  });

  it('a ban keeps an enrollment with a paid order awaiting payment, its hold released, for the job', async () => {
    const on = await offer();
    const studentId = await person();
    const holdId = await hold(on, on.slotIds[0] ?? '', studentId);
    const enrollmentId = await pay(on, studentId, holdId);
    await order(enrollmentId, 'paid');
    const adminId = await makeAdmin(watcher);

    await database.$transaction((tx) => standing.ban(tx, adminId, on.teacherId));

    expect(await released(holdId)).toBe(true);
    expect(await enrollmentOf(enrollmentId)).toMatchObject({
      status: 'pending_payment',
      cancellationReason: null,
    });
    expect(await eventsOf(enrollmentId)).toEqual([]);
  });
});

describe("a student's end (R-219, FR-AUTH-14)", () => {
  it("a deletion releases the student's hold and cancels its enrollment account_deleted", async () => {
    const on = await offer();
    const studentId = await person(await hashPassword(PASSWORD));
    const holdId = await hold(on, on.slotIds[0] ?? '', studentId);
    const enrollmentId = await pay(on, studentId, holdId);
    await order(enrollmentId, 'created');

    await deletion.deleteAccount(studentId, {
      confirmation: 'DELETE',
      reauth: { kind: 'password', password: PASSWORD },
      idempotencyKey: randomUUID(),
    });

    expect(await released(holdId)).toBe(true);
    expect(await enrollmentOf(enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'account_deleted',
    });
    expect(await eventsOf(enrollmentId)).toEqual([cancelledRow('account_deleted')]);
  });
});
