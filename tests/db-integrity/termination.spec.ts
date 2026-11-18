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
//     deletion's transaction's (SC-412);
//   - T005 of specs/004-sessions (`002:T144`; FR-485, FR-486; R-313): a student's suspension, through
//     `StandingService.suspendStudent`, cancels the upcoming sessions of each confirmed enrollment
//     (two teachers'), each row naming the enrollment's one `student_suspended` case, keeps the
//     enrollments `confirmed` and freezes their open remedies (a pending counter withdrawn with one
//     `counter_withdrawn` row, `proposed_date` kept, one `remedy_frozen` row each); one that fails
//     after the subscriber leaves all of it as it was, the freeze included; a ban cancels the
//     enrollments `admin` at once, with one `student_banned` case each, a frozen remedy handed to
//     it with the others; a reinstatement raced against `users.requireIdentity` on one suspended
//     student never leaves the account `active` with a request open, in either order; and the slot
//     of another teacher whose first session falls on a frozen proposal's date and time is listed
//     for the same student by `booking.slots` (the owner's decision of 2026-11-07, item 6: it could
//     not be seen red first, and will not be until T027 reads reservations);
//   - T071 of specs/004-sessions (FR-504): a teacher's suspension pauses the teacher's confirmed
//     enrollments, kept `confirmed`, every remaining session `cancelled_by_admin` naming one
//     `teacher_suspended` case each, the open remedies frozen;
//   - T006 of specs/004-sessions (FR-482, FR-483, FR-485; R-313): a teacher's revocation and ban
//     each cancel the teacher's confirmed enrollments `teacher_suspended` with one row each,
//     every remaining session `cancelled_by_admin` (one scheduled ahead and one inside its join
//     period) with one row naming the enrollment's one `teacher_ended` case, and every open remedy,
//     a frozen one included, handed to it; one that fails after the subscriber leaves all of it as
//     it was.
//
// Every action runs its own transaction, so the rows are committed and kept, each probe with a world
// of its own, as `confirmation-world.ts`' are. All connections are the application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { piasters } from '../../packages/money/src/index';
import {
  bookingSlotsOf,
  bookingSlotsStore,
  createOngoingEnrollments,
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
  lockAccount,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import {
  createIdentityRequestStore,
  createVerificationAdminServices,
  openRequestOf,
} from '../../apps/api/src/modules/verification/index.js';
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
import {
  bindToTransaction,
  RequestLive,
  unboundBus,
} from '../../apps/api/src/platform/live/live-publisher.js';
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

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

const KEY = randomBytes(32).toString('base64');
const PASSWORD = 'a long probe passphrase 41';
const FEMALE = 'female' as RequesterGender;
/** A logger that writes nothing: the line's fields are the subscriber's unit spec's. */
const SILENT = { info: () => undefined, warn: () => undefined };
const identitySettings: SettingsReader = {
  read: async (key, schema) => schema.parse({ idempotency_key_ttl_hours: 24 }[key]),
};

let watcher: Db;
let database: Database;
let webhook: Webhook;
let standing: StandingService;
let standingOver: (registry: AccountConsequences) => StandingService;
let review: ReturnType<typeof createVerificationAdminServices>;
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
  consequences.subscribe(
    terminationSubscriber({ orders: orderStandingsOf, now: () => NOW, log: SILENT }),
  );
  // The standing as `createAdminServices` builds it, verification's open request read (T113).
  standingOver = (registry) =>
    new StandingService({
      store: standingStoreOver(database),
      consequences: registry,
      revokeSubjects,
      hasOpenIdentityRequest: async (tx, userId) => (await openRequestOf(tx, userId)) !== null,
    });
  standing = standingOver(consequences);
  const unreachable = () => Promise.reject(new Error('probe: not reached'));
  review = createVerificationAdminServices({
    database,
    storage: { temporaryLink: unreachable },
    cipher: { decrypt: () => unreachable() as never },
    settings: { read: unreachable },
    standing,
  });
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
      log: { warn: () => undefined, info: () => undefined },
      payment: { registerPayoutRecipient: unreachable },
      idempotency: new IdempotencyService<Transaction>({
        store: new IdempotencyRepository(database),
        settings: identitySettings,
      }),
      consequences: registry,
      report: () => undefined,
      // T080 of specs/004-sessions (rule d): booking's count bound as `main.ts` binds it.
      // 005:T031 (rule d; Q-D6 (a)): the teacher's deletion with confirmed enrollments and the one that
      // fails after the subscriber (the cases at `:534-541` and `:655-668` before this block) delete a
      // teacher over confirmed enrollments to prove booking's subscriber, so `live` and the two counts
      // answer none here; the refusals are `teacher-deletion.spec.ts`'.
      ongoingEnrollments: {
        ...createOngoingEnrollments({ settings: identitySettings }),
        live: async () => false,
      },
      openIjazahRequests: { count: async () => 0 },
      openCases: { count: async () => 0 },
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
    const job = confirmEnrollment({ database, settings, notices: NO_PUSH, clock: () => NOW });
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

    await deleteByAdministrator(studentId);

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
// T081 of specs/004-sessions (Q-R12 (a)): an administrator's deletion at the owner's request, the
// only one that reaches confirmed enrollments since T080 (`deleteByAdministrator` below).

/** A confirmed enrollment of `studentId` on the offer's slot: hold, Pay, a paid order, the job. */
async function confirmed(on: Offer, slotId: string, studentId: string): Promise<string> {
  const enrollmentId = await pay(on, studentId, await hold(on, slotId, studentId));
  await confirmEnrollment({ database, settings, notices: NO_PUSH, clock: () => NOW }).handle({
    paymentId: await order(enrollmentId),
  });
  expect(await enrollmentOf(enrollmentId)).toMatchObject({ status: 'confirmed' });
  return enrollmentId;
}

/**
 * T081 of specs/004-sessions (Q-R12 (a), an approved change): since T080 refuses a person's own
 * deletion over an ongoing enrollment, a deletion over live enrollments is an administrator's at the
 * owner's request, run as the administrator kind runs it: on its transaction, its request's list
 * bound to it and flushed after the commit, dropped on a rollback.
 */
async function deleteByAdministrator(userId: string, over = deletion): Promise<void> {
  const { id: adminId } = await database.adminUser.create({
    data: {
      email: `probe-admin-${randomUUID()}@example.invalid`,
      passwordHash: 'probe-hash',
      mfaSecretEncrypted: Buffer.from('probe'),
      displayName: 'Probe administrator',
      isActive: true,
    },
    select: { id: true },
  });
  const live = new RequestLive(unboundBus, SILENT);
  try {
    await database.$transaction(
      async (tx) => {
        const unbind = bindToTransaction(tx, live);
        try {
          await over.deleteByAdministrator(tx, adminId, {
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
  } catch (error: unknown) {
    live.drop();
    throw error;
  }
  live.flush();
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
    await deleteByAdministrator(on.teacherId);

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

    await deleteByAdministrator(studentId);

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

    await deleteByAdministrator(studentId);

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
    const failing = new AccountConsequences();
    failing.subscribe(
      terminationSubscriber({ orders: orderStandingsOf, now: () => NOW, log: SILENT }),
    );
    failing.subscribe(async () => {
      throw new Error('probe: the deletion fails after the subscriber');
    });
    const before = await sessionStates(enrollmentId);

    await expect(deleteByAdministrator(on.teacherId, deletionOver(failing))).rejects.toThrow(
      'probe: the deletion fails after the subscriber',
    );

    expect(await enrollmentOf(enrollmentId)).toMatchObject({ status: 'confirmed' });
    expect(await sessionStates(enrollmentId)).toEqual(before);
    expect(await casesOf(enrollmentId)).toEqual([]);
    expect(await sessionEventsOf(enrollmentId)).toEqual([]);
    expect(await remedyOf(remedyId)).toMatchObject({ status: 'awaiting_choice', caseId: null });
  });
});

// T005 of specs/004-sessions (`002:T144`; FR-421, FR-485, FR-486; R-313, R-311 "Frozen"; plan.md
// decision 1; the notes under T005): a student's suspension, ban and reinstatement through identity's
// real standing and booking's subscriber, each change in the action's transaction.

/** A live person with the student role (ADR 0016 D3), as onboarding writes one. */
async function student(): Promise<string> {
  const userId = await person();
  await database.userRole.create({ data: { userId, role: 'student', status: 'active' } });
  return userId;
}

const TEN = new Date('1970-01-01T10:00:00Z');
const PROPOSED_DATE = new Date('2026-11-05T00:00:00Z');

/** The session settled as a Teacher-No-Show, and an open remedy on it in `status`. */
async function openRemedy(
  sessionId: string,
  status: 'awaiting_choice' | 'proposed' | 'counter_proposed' | 'frozen',
  counterSlotId?: string,
): Promise<string> {
  await database.session.update({ where: { id: sessionId }, data: { status: 'teacher_no_show' } });
  const { id } = await database.sessionRemedy.create({
    data: {
      sessionId,
      kind: 'makeup',
      status,
      proposedDate: status === 'awaiting_choice' ? null : PROPOSED_DATE,
      offeredAt: new Date('2026-11-03T07:00:00Z'),
      choiceClosesAt: new Date('2026-11-10T07:00:00Z'),
      snapshotAnswerWindowHours: 72,
      snapshotFirstSessionLeadHours: 24,
      ...(status === 'counter_proposed'
        ? {
            counterSlotId: counterSlotId ?? '',
            counterDate: new Date('2026-12-03T00:00:00Z'),
            counterStartTimeLocal: TEN,
            counterTimezone: CAIRO,
            counterProposedAt: new Date('2026-11-03T07:30:00Z'),
          }
        : {}),
    },
    select: { id: true },
  });
  return id;
}

async function frozenView(id: string) {
  return database.sessionRemedy.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      caseId: true,
      decidedAt: true,
      proposedDate: true,
      counterSlotId: true,
      counterDate: true,
      counterStartTimeLocal: true,
      counterTimezone: true,
      counterProposedAt: true,
    },
  });
}

const NO_COUNTER = {
  counterSlotId: null,
  counterDate: null,
  counterStartTimeLocal: null,
  counterTimezone: null,
  counterProposedAt: null,
};

async function accountStatusOf(userId: string): Promise<string> {
  const { accountStatus } = await database.user.findUniqueOrThrow({
    where: { id: userId },
    select: { accountStatus: true },
  });
  return accountStatus;
}

/** A student with a confirmed enrollment with each of two teachers; the second at 10:00. */
async function enrolledWithTwo() {
  const first = await offer(2);
  const second = await offer(2);
  const studentId = await student();
  const one = await confirmed(first, first.slotIds[0] ?? '', studentId);
  const two = await confirmed(second, second.slotIds[1] ?? '', studentId);
  return { first, second, studentId, one, two };
}

describe("a student's suspension (T005, FR-486, R-313, plan.md decision 1 (b))", () => {
  it('cancels the upcoming sessions naming one student_suspended case per enrollment, keeps the enrollments confirmed and freezes the open remedies', async () => {
    const { first, studentId, one, two } = await enrolledWithTwo();
    const [s1, s2] = await sessionStates(one);
    const proposed = await openRemedy(s1?.id ?? '', 'proposed');
    const countered = await openRemedy(s2?.id ?? '', 'counter_proposed', first.slotIds[1]);
    const adminId = await makeAdmin(watcher);

    await database.$transaction((tx) => standing.suspendStudent(tx, adminId, studentId));

    expect(await accountStatusOf(studentId)).toBe('suspended');
    for (const enrollmentId of [one, two]) {
      expect(await enrollmentOf(enrollmentId)).toMatchObject({
        status: 'confirmed',
        cancellationReason: null,
      });
      expect((await eventsOf(enrollmentId)).map(({ kind }) => kind)).toEqual(['confirmed']);
      const cases = await casesOf(enrollmentId);
      expect(cases.map(({ reason, status }) => [reason, status])).toEqual([
        ['student_suspended', 'open'],
      ]);
      const remaining = (await sessionStates(enrollmentId)).filter(
        ({ status }) => status !== 'teacher_no_show',
      );
      expect(remaining.length).toBeGreaterThan(0);
      expect(new Set(remaining.map(({ status }) => status))).toEqual(
        new Set(['cancelled_by_admin']),
      );
      const cancelledRows = (await sessionEventsOf(enrollmentId)).filter(
        ({ kind }) => kind === 'cancelled_by_admin',
      );
      expect(cancelledRows).toHaveLength(remaining.length);
      for (const row of cancelledRows) expect(row.caseId).toBe(cases[0]?.id);
    }
    expect(await frozenView(proposed)).toEqual({
      status: 'frozen',
      caseId: null,
      decidedAt: null,
      proposedDate: PROPOSED_DATE,
      ...NO_COUNTER,
    });
    expect(await frozenView(countered)).toEqual({
      status: 'frozen',
      caseId: null,
      decidedAt: null,
      proposedDate: PROPOSED_DATE,
      ...NO_COUNTER,
    });
    expect(
      (await sessionEventsOf(one))
        .filter(({ kind }) => kind === 'counter_withdrawn' || kind === 'remedy_frozen')
        .map(({ kind, sessionId }) => [kind, sessionId])
        .sort(),
    ).toEqual(
      [
        ['counter_withdrawn', s2?.id],
        ['remedy_frozen', s1?.id],
        ['remedy_frozen', s2?.id],
      ].sort(),
    );
  });

  it('a suspension that fails after the subscriber leaves the account, the sessions, the cases and the remedies as they were, the freeze included', async () => {
    const on = await offer(2);
    const studentId = await student();
    const enrollmentId = await confirmed(on, on.slotIds[0] ?? '', studentId);
    const [s1, s2] = await sessionStates(enrollmentId);
    const proposed = await openRemedy(s1?.id ?? '', 'proposed');
    const countered = await openRemedy(s2?.id ?? '', 'counter_proposed', on.slotIds[1]);
    const before = {
      proposed: await frozenView(proposed),
      countered: await frozenView(countered),
      sessions: await sessionStates(enrollmentId),
    };
    const failing = new AccountConsequences();
    failing.subscribe(
      terminationSubscriber({ orders: orderStandingsOf, now: () => NOW, log: SILENT }),
    );
    failing.subscribe(async () => {
      throw new Error('probe: the suspension fails after the subscriber');
    });
    const adminId = await makeAdmin(watcher);

    await expect(
      database.$transaction((tx) => standingOver(failing).suspendStudent(tx, adminId, studentId)),
    ).rejects.toThrow();

    expect(await accountStatusOf(studentId)).toBe('active');
    expect(await sessionStates(enrollmentId)).toEqual(before.sessions);
    expect(await casesOf(enrollmentId)).toEqual([]);
    expect(await sessionEventsOf(enrollmentId)).toEqual([]);
    expect(await frozenView(proposed)).toEqual(before.proposed);
    expect(await frozenView(countered)).toEqual(before.countered);
  });

  it('the slot of another teacher whose first session falls on a frozen proposal’s date and time is listed for the same student (the owner’s decision of 2026-11-07, item 6)', async () => {
    // The proposal is on the enrollment's own slot, Thursday 09:00 Cairo, on 2026-11-05; another
    // teacher's Thursday 09:00 slot's first session falls on it. Not red first: `booking.slots`
    // reads no reservation until T027, which hides a `proposed` one's time and not a frozen one's.
    const on = await offer();
    const studentId = await student();
    const enrollmentId = await confirmed(on, on.slotIds[0] ?? '', studentId);
    const sessions = await sessionStates(enrollmentId);
    // The remedy on the last session, so the other teacher's three weeks before it are free once the
    // suspension has cancelled them.
    const remedyId = await openRemedy(sessions.at(-1)?.id ?? '', 'proposed');
    const elsewhere = await offer();
    const { id: threeWeeks } = await database.package.create({
      data: {
        teacherUserId: elsewhere.teacherId,
        subjectId: elsewhere.subjectId,
        sessionCount: 3,
        sessionDurationMinutes: 60,
        pricePiasters: 100_000n,
        isActive: true,
      },
      select: { id: true },
    });
    const adminId = await makeAdmin(watcher);

    await database.$transaction((tx) => standing.suspendStudent(tx, adminId, studentId));

    expect(await frozenView(remedyId)).toMatchObject({
      status: 'frozen',
      proposedDate: PROPOSED_DATE,
    });
    const { slots } = await database.$transaction((tx) =>
      bookingSlotsOf(
        tx,
        bookingSlotsStore,
        { userId: studentId, gender: FEMALE },
        { packageId: threeWeeks },
        { now: NOW, leadHours: 24, bufferWeeks: async () => 0, windowDays: async () => 14 },
      ),
    );
    const listed = slots.find(({ slotId }) => slotId === elsewhere.slotIds[0]);
    expect(listed?.firstSession.localDate).toBe('2026-11-05');
    expect(new Date(listed?.firstSession.startsAt ?? 0).toISOString()).toBe(
      '2026-11-05T07:00:00.000Z',
    );
  });
});

describe("a student's ban (T005, FR-486, R-313, plan.md decision 1 (a))", () => {
  it('cancels the enrollments admin at once with one row each, one student_banned case each, the sessions naming it and every open remedy, a frozen one included, handed to it', async () => {
    const { studentId, one, two } = await enrolledWithTwo();
    const [s1, s2] = await sessionStates(one);
    const waiting = await openRemedy(s1?.id ?? '', 'awaiting_choice');
    const frozen = await openRemedy(s2?.id ?? '', 'frozen');
    const adminId = await makeAdmin(watcher);

    await database.$transaction((tx) => standing.banStudent(tx, adminId, studentId));

    expect(await accountStatusOf(studentId)).toBe('banned');
    for (const enrollmentId of [one, two]) {
      expect(await enrollmentOf(enrollmentId)).toMatchObject({
        status: 'cancelled',
        cancellationReason: 'admin',
      });
      expect(
        (await eventsOf(enrollmentId)).map(({ kind, cancellationReason }) => [
          kind,
          cancellationReason,
        ]),
      ).toEqual([
        ['confirmed', null],
        ['cancelled', 'admin'],
      ]);
      const cases = await casesOf(enrollmentId);
      expect(cases.map(({ reason, status }) => [reason, status])).toEqual([
        ['student_banned', 'open'],
      ]);
      const cancelledRows = (await sessionEventsOf(enrollmentId)).filter(
        ({ kind }) => kind === 'cancelled_by_admin',
      );
      expect(cancelledRows.length).toBeGreaterThan(0);
      for (const row of cancelledRows) expect(row.caseId).toBe(cases[0]?.id);
    }
    const caseId = (await casesOf(one))[0]?.id;
    for (const remedyId of [waiting, frozen]) {
      expect(await remedyOf(remedyId)).toEqual({ status: 'refund_case', caseId, decidedAt: NOW });
    }
    expect(
      (await sessionEventsOf(one))
        .filter(({ kind }) => kind === 'remedy_handed_to_case')
        .map(({ sessionId }) => sessionId)
        .sort(),
    ).toEqual([s1?.id, s2?.id].sort());
  });
});

/** Resolves once backend `pid` waits on a lock; fails after about two seconds. */
async function seenWaiting(pid: number): Promise<void> {
  for (let look = 0; look < 100; look += 1) {
    const { rows } = await watcher.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${String(pid)} never waited on a lock`);
}

/**
 * A runs `first` and stays open; B runs `second` and is seen waiting on a lock; A commits. Answers
 * how B ended (as `account-locks.spec.ts` stages a race: the order is the database's, not timing's).
 */
async function race<T>(
  first: (tx: Transaction) => Promise<unknown>,
  second: (tx: Transaction) => Promise<T>,
): Promise<{ readonly value: T } | { readonly thrown: unknown }> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ran = (): void => undefined;
  const firstRan = new Promise<void>((resolve) => {
    ran = resolve;
  });
  const options = { maxWait: 5_000, timeout: 15_000 };
  const a = database.$transaction(async (tx) => {
    await first(tx);
    ran();
    await released;
  }, options);
  await Promise.race([firstRan, a]);
  let pidOfB = (_pid: number): void => undefined;
  const bStarted = new Promise<number>((resolve) => {
    pidOfB = resolve;
  });
  const b = database
    .$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pidOfB(row?.pid ?? 0);
      return second(tx);
    }, options)
    .then(
      (value) => ({ value }),
      (thrown: unknown) => ({ thrown }),
    );
  try {
    await seenWaiting(await bStarted);
  } finally {
    release();
    await a;
  }
  return b;
}

async function openRequestsOf(userId: string): Promise<number> {
  return database.verificationRequest.count({ where: { userId, status: 'open' } });
}

describe("a student's reinstatement and an identity request (the note under T005; 002:T113, 002:T126)", () => {
  it('a request waits for the reinstatement holding the account, then opens on the active account: verification_required, never active with it open', async () => {
    const studentId = await student();
    await database.user.update({ where: { id: studentId }, data: { accountStatus: 'suspended' } });
    const adminId = await makeAdmin(watcher);
    const ended = await race(
      (tx) => standing.reinstateStudent(tx, adminId, studentId),
      (tx) => review.documents.requireIdentity(tx, adminId, { userId: studentId, reason: 'بلاغ' }),
    );
    expect(ended).toMatchObject({ value: { requestId: expect.any(String) } });
    expect(await accountStatusOf(studentId)).toBe('verification_required');
    expect(await openRequestsOf(studentId)).toBe(1);
  });

  it('a reinstatement waits for a request written under the account’s lock, then lands on verification_required', async () => {
    // A writes the request as `requireIdentity` writes it, the account's lock first: on a suspended
    // account `requireIdentity` itself refuses, so the request is opened as its store opens one.
    const studentId = await student();
    await database.user.update({ where: { id: studentId }, data: { accountStatus: 'suspended' } });
    const adminId = await makeAdmin(watcher);
    const requests = createIdentityRequestStore(database);
    const ended = await race(
      async (tx) => {
        await lockAccount(tx, studentId);
        await requests.openRequest(tx, { userId: studentId, adminId, reason: 'بلاغ', at: NOW });
      },
      (tx) => standing.reinstateStudent(tx, adminId, studentId),
    );
    expect(ended).toEqual({
      value: {
        before: { accountStatus: 'suspended' },
        after: { accountStatus: 'verification_required' },
      },
    });
    expect(await accountStatusOf(studentId)).toBe('verification_required');
    expect(await openRequestsOf(studentId)).toBe(1);
  });
});

// T006 of specs/004-sessions (FR-482, FR-483, FR-485; SC-412; R-313): a teacher's end through
// identity's real standing and booking's subscriber, each change in the action's transaction.

/** Moves the session inside its join period at NOW: started ten minutes before, still scheduled. */
async function inItsJoinPeriod(sessionId: string): Promise<void> {
  await database.session.update({
    where: { id: sessionId },
    data: {
      scheduledDateLocal: new Date('2026-11-03T00:00:00Z'),
      scheduledStartTimeLocal: new Date('1970-01-01T09:50:00Z'),
      scheduledStartAt: new Date('2026-11-03T07:50:00Z'),
      scheduledEndAt: new Date('2026-11-03T08:50:00Z'),
    },
  });
}

/** A teacher with two confirmed enrollments, the first with a session in its join period and two open remedies. */
async function teacherWithTwo() {
  const on = await offer(2);
  const [slotA = '', slotB = ''] = on.slotIds;
  const one = await confirmed(on, slotA, await student());
  const two = await confirmed(on, slotB, await student());
  const [joining, , frozenOn, waitingOn] = await sessionStates(one);
  await inItsJoinPeriod(joining?.id ?? '');
  const frozen = await openRemedy(frozenOn?.id ?? '', 'frozen');
  const waiting = await openRemedy(waitingOn?.id ?? '', 'awaiting_choice');
  return { on, one, two, joining: joining?.id ?? '', frozen, waiting };
}

// T071 of specs/004-sessions (rule d, an approved change): a teacher's suspension pauses now (the
// probe below); a revocation's and a ban's cases are unchanged.
const TEACHER_ENDS = [
  ['revokeApproval', 'active'],
  ['ban', 'banned'],
] as const;

// T071 of specs/004-sessions (FR-504; R-313's table as updated): the teacher `suspended` probe,
// rewritten. A teacher's suspension pauses the confirmed enrollments as a student's does: each kept
// `confirmed` with no `enrollment_events` row, every remaining session, one in its join period
// included, `cancelled_by_admin` naming one `teacher_suspended` case each, and the open remedies
// frozen, a frozen one left frozen and none handed to a case.
describe("a teacher's suspension pauses (T071, FR-504, R-313)", () => {
  it('keeps the enrollments confirmed, cancels every remaining session, one in its join period included, naming one teacher_suspended case each, and freezes the open remedies', async () => {
    const { on, one, two, joining, frozen, waiting } = await teacherWithTwo();
    const adminId = await makeAdmin(watcher);

    await database.$transaction((tx) => standing.suspend(tx, adminId, on.teacherId));

    expect(await accountStatusOf(on.teacherId)).toBe('suspended');
    for (const enrollmentId of [one, two]) {
      expect(await enrollmentOf(enrollmentId)).toMatchObject({
        status: 'confirmed',
        cancellationReason: null,
      });
      expect((await eventsOf(enrollmentId)).map(({ kind }) => kind)).toEqual(['confirmed']);
      const cases = await casesOf(enrollmentId);
      expect(cases.map(({ reason, status }) => [reason, status])).toEqual([
        ['teacher_suspended', 'open'],
      ]);
      const remaining = (await sessionStates(enrollmentId)).filter(
        ({ status }) => status !== 'teacher_no_show',
      );
      expect(remaining.length).toBeGreaterThan(0);
      expect(new Set(remaining.map(({ status }) => status))).toEqual(
        new Set(['cancelled_by_admin']),
      );
      const cancelledRows = (await sessionEventsOf(enrollmentId)).filter(
        ({ kind }) => kind === 'cancelled_by_admin',
      );
      expect(cancelledRows.map(({ sessionId }) => sessionId).sort()).toEqual(
        remaining.map(({ id }) => id).sort(),
      );
      for (const row of cancelledRows) expect(row.caseId).toBe(cases[0]?.id);
    }
    expect((await sessionStates(one)).find(({ id }) => id === joining)?.status).toBe(
      'cancelled_by_admin',
    );
    for (const remedyId of [frozen, waiting]) {
      expect(await remedyOf(remedyId)).toEqual({ status: 'frozen', caseId: null, decidedAt: null });
    }
    expect(
      (await sessionEventsOf(one)).filter(({ kind }) => kind === 'remedy_handed_to_case'),
    ).toEqual([]);
  });

  // T081's note (B42a; the review session's ruling of 2026-11-14 on lane D's report): an
  // administrator's deletion of a party of a paused enrollment (T080's check skipped) closes its open
  // `teacher_suspended` case as a ban does, the deleting administrator its closer through
  // `AccountConsequence`'s `actor`; a student's deletion has no end case, so nothing covers it.
  it('an administrator deletes a paused enrollment’s student: its teacher_suspended case closed resolved, compensation_ordered, ended_meanwhile, by the deleting administrator', async () => {
    const { on, one, two } = await teacherWithTwo();
    const adminId = await makeAdmin(watcher);
    await database.$transaction((tx) => standing.suspend(tx, adminId, on.teacherId));
    const { studentUserId } = await database.enrollment.findUniqueOrThrow({
      where: { id: one },
      select: { studentUserId: true },
    });

    await deleteByAdministrator(studentUserId);

    const [closed] = await database.dispute.findMany({
      where: { enrollmentId: one, reason: 'teacher_suspended' },
      select: {
        status: true,
        resolution: true,
        resolutionNotes: true,
        resolvedByAdminId: true,
        coveredByCaseId: true,
      },
    });
    expect(closed).toMatchObject({
      status: 'resolved',
      resolution: 'compensation_ordered',
      resolutionNotes: 'ended_meanwhile',
      coveredByCaseId: null,
    });
    const closer = await database.adminUser.findUnique({
      where: { id: closed?.resolvedByAdminId ?? randomUUID() },
      select: { displayName: true },
    });
    expect(closer).toEqual({ displayName: 'Probe administrator' });
    // The other student's paused enrollment is untouched: its case still open.
    expect((await casesOf(two)).map(({ reason, status }) => [reason, status])).toEqual([
      ['teacher_suspended', 'open'],
    ]);
  });
});

describe("a teacher's end (T006, FR-483, R-313)", () => {
  it.each(TEACHER_ENDS)(
    '%s cancels the confirmed enrollments teacher_suspended, every remaining session, one in its join period included, naming one teacher_ended case each, the open remedies, a frozen one included, handed to it',
    async (action, accountStatus) => {
      const { on, one, two, joining, frozen, waiting } = await teacherWithTwo();
      const adminId = await makeAdmin(watcher);

      await database.$transaction(async (tx) => {
        if (action === 'revokeApproval') {
          await standing.revokeApproval(tx, adminId, on.teacherId, 'Probe revocation');
        } else {
          await standing[action](tx, adminId, on.teacherId);
        }
      });

      expect(await accountStatusOf(on.teacherId)).toBe(accountStatus);
      for (const enrollmentId of [one, two]) {
        expect(await enrollmentOf(enrollmentId)).toMatchObject({
          status: 'cancelled',
          cancellationReason: 'teacher_suspended',
        });
        expect(
          (await eventsOf(enrollmentId)).map(({ kind, cancellationReason }) => [
            kind,
            cancellationReason,
          ]),
        ).toEqual([
          ['confirmed', null],
          ['cancelled', 'teacher_suspended'],
        ]);
        const cases = await casesOf(enrollmentId);
        expect(cases.map(({ reason, status }) => [reason, status])).toEqual([
          ['teacher_ended', 'open'],
        ]);
        const remaining = (await sessionStates(enrollmentId)).filter(
          ({ status }) => status !== 'teacher_no_show',
        );
        expect(remaining.length).toBeGreaterThan(0);
        expect(new Set(remaining.map(({ status }) => status))).toEqual(
          new Set(['cancelled_by_admin']),
        );
        const cancelledRows = (await sessionEventsOf(enrollmentId)).filter(
          ({ kind }) => kind === 'cancelled_by_admin',
        );
        expect(cancelledRows.map(({ sessionId }) => sessionId).sort()).toEqual(
          remaining.map(({ id }) => id).sort(),
        );
        for (const row of cancelledRows) expect(row.caseId).toBe(cases[0]?.id);
      }
      expect((await sessionStates(one)).find(({ id }) => id === joining)?.status).toBe(
        'cancelled_by_admin',
      );
      const caseId = (await casesOf(one))[0]?.id;
      for (const remedyId of [frozen, waiting]) {
        expect(await remedyOf(remedyId)).toEqual({ status: 'refund_case', caseId, decidedAt: NOW });
      }
      expect(
        (await sessionEventsOf(one)).filter(({ kind }) => kind === 'remedy_handed_to_case'),
      ).toHaveLength(2);
    },
  );

  it("a teacher's suspension that fails after the subscriber leaves every enrollment, session and remedy as it was", async () => {
    const { on, one, two, frozen, waiting } = await teacherWithTwo();
    const before = { one: await sessionStates(one), two: await sessionStates(two) };
    const failing = new AccountConsequences();
    failing.subscribe(
      terminationSubscriber({ orders: orderStandingsOf, now: () => NOW, log: SILENT }),
    );
    failing.subscribe(async () => {
      throw new Error('probe: the suspension fails after the subscriber');
    });
    const adminId = await makeAdmin(watcher);

    await expect(
      database.$transaction((tx) => standingOver(failing).suspend(tx, adminId, on.teacherId)),
    ).rejects.toThrow();

    expect(await accountStatusOf(on.teacherId)).toBe('active');
    for (const enrollmentId of [one, two]) {
      expect(await enrollmentOf(enrollmentId)).toMatchObject({ status: 'confirmed' });
      expect(await casesOf(enrollmentId)).toEqual([]);
      expect(await sessionEventsOf(enrollmentId)).toEqual([]);
    }
    expect(await sessionStates(one)).toEqual(before.one);
    expect(await sessionStates(two)).toEqual(before.two);
    expect(await remedyOf(frozen)).toMatchObject({ status: 'frozen', caseId: null });
    expect(await remedyOf(waiting)).toMatchObject({ status: 'awaiting_choice', caseId: null });
  });
});
