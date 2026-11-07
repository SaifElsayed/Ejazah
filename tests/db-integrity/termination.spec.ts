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
//   - a student's deletion releases the student's hold and cancels its enrollment `account_deleted`;
//   - T004 of specs/004-sessions (`003:T059`, FR-AUTH-14's confirmed part): a teacher's deletion with
//     two confirmed enrollments opens one `teacher_ended` case each, cancels their remaining
//     sessions `cancelled_by_admin` with one row each naming the case, hands the open remedy to it
//     and cancels the enrollments `account_deleted`; a student's opens no case, its sessions' rows
//     name none, its open remedy lapses and a chosen refund keeps its open case; and a deletion
//     that fails after the subscriber leaves all of it as it was, every change being the
//     deletion's transaction's (SC-412).
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
import { openCompensationCase } from '../../apps/api/src/modules/moderation/index.js';
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
let deletionOver: (registry: AccountConsequences) => typeof deletion;
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
  deletionOver = (registry) =>
    createIdentityServices({
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
      consequences: registry,
      report: () => undefined,
    }).deletion;
  deletion = deletionOver(consequences);
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

// T004 of specs/004-sessions/tasks.md (`003:T059`, FR-AUTH-14's confirmed part; FR-420, FR-484,
// FR-485, FR-495; R-313; SC-412): a deletion with confirmed enrollments, through identity's real
// deletion and booking's subscriber, each change in the deletion's transaction.

/** A confirmed enrollment of `studentId` on the offer's slot: hold, Pay, a paid order, the job. */
async function confirmed(on: Offer, slotId: string, studentId: string): Promise<string> {
  const enrollmentId = await pay(on, studentId, await hold(on, slotId, studentId));
  await confirmEnrollment({ database, settings, clock: () => NOW }).handle({
    paymentId: await order(enrollmentId),
  });
  expect(await enrollmentOf(enrollmentId)).toMatchObject({ status: 'confirmed' });
  return enrollmentId;
}

/** Sets a password the deletion's proof checks, on a person made without one. */
async function withPassword(userId: string): Promise<void> {
  await database.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
}

function deleteWithPassword(userId: string) {
  return deletion.deleteAccount(userId, {
    confirmation: 'DELETE',
    reauth: { kind: 'password', password: PASSWORD },
    idempotencyKey: randomUUID(),
  });
}

/** The enrollment's sessions by sequence number, with their status. */
async function sessionStates(enrollmentId: string) {
  return database.session.findMany({
    where: { enrollmentId },
    orderBy: { sequenceNumber: 'asc' },
    select: { id: true, status: true },
  });
}

/** The session's outcome settled as a Teacher-No-Show, and a remedy owed on it in `status`. */
async function owed(
  sessionId: string,
  status: 'awaiting_choice' | 'refund_case',
  caseId: string | null = null,
): Promise<string> {
  await database.session.update({ where: { id: sessionId }, data: { status: 'teacher_no_show' } });
  const { id } = await database.sessionRemedy.create({
    data: {
      sessionId,
      kind: status === 'refund_case' ? 'refund' : 'makeup',
      status,
      caseId,
      decidedAt: caseId === null ? null : NOW,
      offeredAt: new Date('2026-11-03T08:00:00Z'),
      choiceClosesAt: new Date('2026-11-10T08:00:00Z'),
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
    },
    select: { id: true },
  });
  return id;
}

async function remedyOf(id: string) {
  return database.sessionRemedy.findUniqueOrThrow({
    where: { id },
    select: { status: true, caseId: true, decidedAt: true },
  });
}

async function sessionEventsOf(enrollmentId: string) {
  return database.sessionEvent.findMany({
    where: { enrollmentId },
    orderBy: [{ kind: 'asc' }, { sessionId: 'asc' }],
    select: { kind: true, sessionId: true, caseId: true, occurredAt: true },
  });
}

describe('a deletion with confirmed enrollments (T004, FR-AUTH-14, R-313, SC-412)', () => {
  it("a teacher's: one teacher_ended case per enrollment, its sessions cancelled naming it, its open remedy handed to it, the enrollments cancelled account_deleted", async () => {
    const on = await offer(2);
    const [slotA = '', slotB = ''] = on.slotIds;
    const first = await confirmed(on, slotA, await person());
    const second = await confirmed(on, slotB, await person());
    const [missed] = await sessionStates(first);
    const remedyId = await owed(missed?.id ?? '', 'awaiting_choice');
    await withPassword(on.teacherId);

    await deleteWithPassword(on.teacherId);

    for (const enrollmentId of [first, second]) {
      expect(await enrollmentOf(enrollmentId)).toMatchObject({
        status: 'cancelled',
        cancellationReason: 'account_deleted',
      });
      expect((await eventsOf(enrollmentId)).map(({ kind }) => kind)).toEqual([
        'confirmed',
        'cancelled',
      ]);
      const cases = await casesOf(enrollmentId);
      expect(cases.map(({ reason, status }) => [reason, status])).toEqual([
        ['teacher_ended', 'open'],
      ]);
      const caseId = cases[0]?.id;
      const states = await sessionStates(enrollmentId);
      const remaining = states.filter(({ status }) => status !== 'teacher_no_show');
      expect(remaining.map(({ status }) => status)).toEqual(
        remaining.map(() => 'cancelled_by_admin'),
      );
      const events = await sessionEventsOf(enrollmentId);
      expect(events.filter(({ kind }) => kind === 'cancelled_by_admin')).toEqual(
        remaining
          .map(({ id }) => ({ kind: 'cancelled_by_admin', sessionId: id, caseId, occurredAt: NOW }))
          .sort((one, other) => one.sessionId.localeCompare(other.sessionId)),
      );
      if (enrollmentId === first) {
        expect(await remedyOf(remedyId)).toEqual({
          status: 'refund_case',
          caseId,
          decidedAt: NOW,
        });
        expect(events.filter(({ kind }) => kind === 'remedy_handed_to_case')).toEqual([
          { kind: 'remedy_handed_to_case', sessionId: missed?.id, caseId: null, occurredAt: NOW },
        ]);
      }
    }
  });

  it("a student's: no case, the sessions cancelled naming none, the open remedy lapsed and a chosen refund's case kept open", async () => {
    const on = await offer();
    const studentId = await person(await hashPassword(PASSWORD));
    const enrollmentId = await confirmed(on, on.slotIds[0] ?? '', studentId);
    const [missed, refused] = await sessionStates(enrollmentId);
    const lapsing = await owed(missed?.id ?? '', 'awaiting_choice');
    const { caseId: refundCase } = await database.$transaction((tx) =>
      openCompensationCase(tx, enrollmentId, 'refund_choice'),
    );
    const keeping = await owed(refused?.id ?? '', 'refund_case', refundCase);

    await deleteWithPassword(studentId);

    expect(await enrollmentOf(enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'account_deleted',
    });
    expect((await casesOf(enrollmentId)).map(({ reason, status }) => [reason, status])).toEqual([
      ['refund_choice', 'open'],
    ]);
    const remaining = (await sessionStates(enrollmentId)).filter(
      ({ status }) => status !== 'teacher_no_show',
    );
    expect(new Set(remaining.map(({ status }) => status))).toEqual(new Set(['cancelled_by_admin']));
    const events = await sessionEventsOf(enrollmentId);
    expect(events.filter(({ kind }) => kind === 'cancelled_by_admin')).toHaveLength(
      remaining.length,
    );
    for (const event of events.filter(({ kind }) => kind === 'cancelled_by_admin')) {
      expect(event.caseId).toBeNull();
    }
    expect(await remedyOf(lapsing)).toEqual({ status: 'lapsed', caseId: null, decidedAt: NOW });
    expect(events.filter(({ kind }) => kind === 'remedy_lapsed')).toEqual([
      { kind: 'remedy_lapsed', sessionId: missed?.id, caseId: null, occurredAt: NOW },
    ]);
    expect(await remedyOf(keeping)).toEqual({
      status: 'refund_case',
      caseId: refundCase,
      decidedAt: NOW,
    });
  });

  it('a remedy of a soft-deleted session is not read, so it is left as it was (R-DB-3)', async () => {
    const on = await offer();
    const studentId = await person(await hashPassword(PASSWORD));
    const enrollmentId = await confirmed(on, on.slotIds[0] ?? '', studentId);
    const [missed, removed] = await sessionStates(enrollmentId);
    const lapsing = await owed(missed?.id ?? '', 'awaiting_choice');
    const hidden = await owed(removed?.id ?? '', 'awaiting_choice');
    await database.session.update({
      where: { id: removed?.id ?? '' },
      data: { deletedAt: new Date('2026-11-03T08:00:00Z') },
    });

    await deleteWithPassword(studentId);

    expect(await remedyOf(lapsing)).toMatchObject({ status: 'lapsed' });
    expect(await remedyOf(hidden)).toEqual({
      status: 'awaiting_choice',
      caseId: null,
      decidedAt: null,
    });
    expect(
      (await sessionEventsOf(enrollmentId)).filter(({ sessionId }) => sessionId === removed?.id),
    ).toEqual([]);
  });

  it('a deletion that fails after the subscriber leaves every confirmed enrollment, session and remedy as it was', async () => {
    const on = await offer();
    const enrollmentId = await confirmed(on, on.slotIds[0] ?? '', await person());
    const [missed] = await sessionStates(enrollmentId);
    const remedyId = await owed(missed?.id ?? '', 'awaiting_choice');
    await withPassword(on.teacherId);
    const failing = new AccountConsequences();
    failing.subscribe(terminationSubscriber({ orders: orderStandingsOf, now: () => NOW }));
    failing.subscribe(async () => {
      throw new Error('probe: the deletion fails after the subscriber');
    });
    const before = await sessionStates(enrollmentId);

    await expect(
      deletionOver(failing).deleteAccount(on.teacherId, {
        confirmation: 'DELETE',
        reauth: { kind: 'password', password: PASSWORD },
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow();

    expect(await enrollmentOf(enrollmentId)).toMatchObject({ status: 'confirmed' });
    expect(await sessionStates(enrollmentId)).toEqual(before);
    expect(await casesOf(enrollmentId)).toEqual([]);
    expect(await sessionEventsOf(enrollmentId)).toEqual([]);
    expect(await remedyOf(remedyId)).toMatchObject({ status: 'awaiting_choice', caseId: null });
  });
});
