// PR #120's review, M1 (the owner's decision of 2026-11-03): every writer that can turn the bookable
// predicate from true to false locks the teacher's `users` row first, before it reads or writes
// anything, as Pay and the confirmation take it (T005). The three that did not:
//
//   - `teachers.revokeApproval` (`verification_status` to `revoked`);
//   - `teacher.payout.register` (a replacement clears `payout_verified_at`);
//   - the gateway's `recipient_rejected` (clears `payout_verified_at`).
//
// For each, both orders, staged as `account-locks.spec.ts` stages a race: transaction A runs and
// stays open, B starts and is seen waiting on A by a watcher reading `pg_stat_activity`, then A
// commits.
//
//   - Pay holding the teacher (booking's `enrollOnHold`), then the writer: the writer waits, and
//     commits after Pay's enrollment;
//   - the writer holding the teacher, then Pay: Pay waits, reads the teacher again under its lock,
//     and is refused (`NOT_FOUND`: the teacher is no longer visible), writing no enrollment.
//
// Without the writer's lock neither B waits, and the second order is the crossing the review names:
// Pay reads the teacher bookable while the writer's change is uncommitted, and enrolls.
//
// The writers run through their real services: the revocation through identity's `StandingService`
// on the spec's transaction, the registration through identity's services over the kernel's
// idempotency, the rejection through the payment webhook with the gateway stand-in's signed event.
// A writer's own transaction is held open by the spec's client, whose `$transaction` waits after
// the work, before the commit, while `holding` is set. Rows are committed and kept, each probe with
// a world of its own, as `confirmation-world.ts`' are. All connections are the application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { piasters } from '../../packages/money/src/index';
import {
  enrollOnHold,
  payStoreOver,
  type PayTarget,
  payTargetOf,
  type QuotedSummary,
} from '../../apps/api/src/modules/booking/index.js';
import { revokeSubjects } from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  createIdentityServices,
  payoutRefHash,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { CAIRO, LATER, NOW, THURSDAY_0900 } from './confirmation-world';
import { listenWebhook, type Webhook } from './expiry-world';
import { connectAsApplication, type Db, makeAdmin } from './harness';

const KEY = randomBytes(32).toString('base64');
const SETTINGS: Readonly<Record<string, unknown>> = { idempotency_key_ttl_hours: 24 };
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const OPTIONS = { maxWait: 5_000, timeout: 15_000 };
const FEMALE = 'female' as RequesterGender;

let watcher: Db;
let database: Database;
/** The spec's client whose `$transaction` waits before its commit while `holding` is set. */
let holdable: Database;
let standing: StandingService;
let payout: ReturnType<typeof createIdentityServices>['payout'];
let webhook: Webhook;
/** The reference the registration's port answers next. */
let nextRecipientRef = '';

/** A transaction held open after its work: its backend's id once it ran, and its release. */
interface Hold {
  readonly ran: Promise<number>;
  readonly release: () => void;
}

let holding: { readonly ran: (pid: number) => void; readonly released: Promise<void> } | undefined;

/** The next transaction of `holdable` stays open after its work until released. */
function holdNext(): Hold {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ran = (_pid: number): void => undefined;
  const pid = new Promise<number>((resolve) => {
    ran = resolve;
  });
  holding = { ran, released };
  return { ran: pid, release };
}

/** Runs at the end of `holdable`'s transaction: waits there while `holding` is set. */
async function holdPoint(tx: Transaction): Promise<void> {
  const hold = holding;
  if (hold === undefined) return;
  holding = undefined;
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  hold.ran(row?.pid ?? 0);
  await hold.released;
}

beforeAll(async () => {
  watcher = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  const transaction = (async <T>(
    work: (tx: Transaction) => Promise<T>,
    options?: Parameters<Database['$transaction']>[1],
  ): Promise<T> =>
    database.$transaction(async (tx) => {
      const result = await work(tx);
      await holdPoint(tx);
      return result;
    }, options)) as unknown as Database['$transaction'];
  holdable = new Proxy(database, {
    get: (target, property) =>
      property === '$transaction' ? transaction : Reflect.get(target, property, target),
  });
  standing = new StandingService({
    store: standingStoreOver(holdable),
    consequences: new AccountConsequences(),
    revokeSubjects,
    hasOpenIdentityRequest: async () => false,
  });
  const unreachable = () => Promise.reject(new Error('probe: not reached'));
  payout = createIdentityServices({
    database: holdable,
    settings,
    encryptionKey: KEY,
    cipher: new ColumnCipher(KEY),
    marks: new MemorySingleUseMarks(() => new Date()),
    signIn: {
      verifyIdentityToken: unreachable,
      exchangeAuthorization: unreachable,
      revoke: unreachable,
    },
    email: { deliver: async () => undefined },
    storage: { temporaryLink: unreachable, remove: unreachable },
    log: { warn: () => undefined },
    payment: { registerPayoutRecipient: async () => nextRecipientRef },
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(holdable),
      settings,
    }),
    consequences: new AccountConsequences(),
    report: () => undefined,
  }).payout;
  webhook = await listenWebhook(holdable, { enqueue: async () => undefined });
}, 60_000);

afterAll(async () => {
  await webhook?.close();
  await watcher?.end();
  if (database !== undefined) await closeDatabase(database);
});

/** Resolves once a backend waits on a lock `pid` holds; fails after about two seconds. */
async function seenBlockedBy(pid: number): Promise<void> {
  for (let look = 0; look < 100; look += 1) {
    const { rows } = await watcher.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
      [pid],
    );
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no backend ever waited on backend ${String(pid)}`);
}

/** How a race's second party ended: its value, or what it threw. */
type Outcome<T> = { readonly value: T } | { readonly thrown: unknown };

const settle = <T>(promise: Promise<T>): Promise<Outcome<T>> =>
  promise.then(
    (value) => ({ value }),
    (thrown: unknown) => ({ thrown }),
  );

/**
 * A runs through `holdable` and stays open; B starts and is seen waiting on A; A commits. How B
 * ended.
 */
async function race<T>(
  first: () => Promise<unknown>,
  second: () => Promise<T>,
): Promise<Outcome<T>> {
  const hold = holdNext();
  const a = first();
  // A that fails before it is held is reported, not left waiting.
  const pid = await Promise.race([hold.ran, a.then(() => new Promise<never>(() => undefined))]);
  const b = settle(second());
  try {
    await seenBlockedBy(pid);
  } finally {
    hold.release();
    await a;
  }
  return b;
}

/** A teacher bookable by a female student, her offer and slot, and the student's running hold. */
interface PayWorld {
  readonly teacherId: string;
  readonly studentId: string;
  readonly holdId: string;
  readonly quoted: QuotedSummary;
  /** The reference the teacher's verified payout account holds. */
  readonly recipientRef: string;
}

async function person(): Promise<string> {
  const { id } = await database.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      gender: 'female',
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      displayName: 'Probe person',
      preferredLanguage: 'ar',
      timezone: CAIRO,
      accountStatus: 'active',
    },
    select: { id: true },
  });
  return id;
}

async function payWorld(): Promise<PayWorld> {
  const teacherId = await person();
  const recipientRef = `probe-rcp-${randomUUID()}`;
  await database.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      applicationStatus: 'approved',
      payoutAccountRefEncrypted: Uint8Array.from(randomBytes(32)),
      payoutAccountRefHash: payoutRefHash(recipientRef),
      payoutConfiguredAt: new Date('2026-10-01T00:00:00Z'),
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
  const studentId = await person();
  const { id: holdId } = await database.slotHold.create({
    data: {
      slotId,
      packageId: pkg.id,
      sessionCount: 4,
      studentUserId: studentId,
      expiresAt: LATER,
    },
    select: { id: true },
  });
  const quoted: QuotedSummary = {
    price_piasters: piasters(100_000),
    sessionCount: 4,
    sessionDurationMinutes: 60,
    track: pkg.track,
  };
  return { teacherId, studentId, holdId, quoted, recipientRef };
}

const store = payStoreOver();

/** Pay's checks before the gateway, run before the race as `checkout.pay` runs them. */
function targetOf(world: PayWorld): Promise<PayTarget> {
  return database.$transaction((tx) =>
    payTargetOf(
      tx,
      { studentUserId: world.studentId, holdId: world.holdId, at: NOW },
      world.quoted,
      store,
    ),
  );
}

/** Pay's transaction on booking's side, through `client`; the enrollment's id. */
async function pay(client: Database, world: PayWorld, target: PayTarget): Promise<string> {
  const enrollmentId = randomUUID();
  await client.$transaction(
    (tx) =>
      enrollOnHold(
        tx,
        target,
        {
          student: { userId: world.studentId, gender: FEMALE },
          enrollmentId,
          at: NOW,
          leadHours: 24,
          quoted: world.quoted,
        },
        store,
      ),
    OPTIONS,
  );
  return enrollmentId;
}

async function enrollmentsOf(studentId: string): Promise<number> {
  return database.enrollment.count({ where: { studentUserId: studentId } });
}

async function teacherNow(teacherId: string) {
  return database.teacherProfile.findUniqueOrThrow({
    where: { userId: teacherId },
    select: { verificationStatus: true, payoutVerifiedAt: true },
  });
}

/** The three writers, each through its real service, every transaction of it on `holdable`. */
const WRITERS = [
  {
    name: 'teachers.revokeApproval',
    run: async (world: PayWorld) => {
      const adminId = await makeAdmin(watcher);
      await holdable.$transaction(
        (tx) => standing.revokeApproval(tx, adminId, world.teacherId, 'Probe revocation'),
        OPTIONS,
      );
    },
    turnedFalse: async (world: PayWorld) =>
      (await teacherNow(world.teacherId)).verificationStatus === 'revoked',
  },
  {
    name: 'teacher.payout.register',
    run: async (world: PayWorld) => {
      nextRecipientRef = `probe-rcp-${randomUUID()}`;
      await payout.register(world.teacherId, {
        details: { holderName: 'Probe Teacher', method: 'bank_account', accountNumber: 'EG00' },
        idempotencyKey: randomUUID(),
      });
    },
    turnedFalse: async (world: PayWorld) =>
      (await teacherNow(world.teacherId)).payoutVerifiedAt === null,
  },
  {
    name: 'the recipient_rejected event',
    run: async (world: PayWorld) => {
      const status = await webhook.stand.deliver(
        webhook.stand.recipientRejected(world.recipientRef, 'Name mismatch'),
      );
      expect(status).toBe(200);
    },
    turnedFalse: async (world: PayWorld) =>
      (await teacherNow(world.teacherId)).payoutVerifiedAt === null,
  },
] as const;

describe.each(WRITERS)(
  '$name locks the teacher first (PR #120’s review, M1)',
  ({ run, turnedFalse }) => {
    it('waits for a Pay holding the teacher, and commits after its enrollment', async () => {
      const world = await payWorld();
      const target = await targetOf(world);
      let enrollmentId = '';
      const outcome = await race(
        async () => {
          enrollmentId = await pay(holdable, world, target);
        },
        () => run(world),
      );
      expect(outcome).toEqual({ value: undefined });
      expect(await database.enrollment.count({ where: { id: enrollmentId } })).toBe(1);
      expect(await turnedFalse(world)).toBe(true);
    }, 60_000);

    it('holding the teacher, a Pay after it waits, reads it again and enrolls nobody', async () => {
      const world = await payWorld();
      const target = await targetOf(world);
      const outcome = await race(
        () => run(world),
        () => pay(database, world, target),
      );
      expect(
        'thrown' in outcome && outcome.thrown instanceof DomainError
          ? outcome.thrown.code
          : outcome,
      ).toBe('NOT_FOUND');
      expect(await turnedFalse(world)).toBe(true);
      expect(await enrollmentsOf(world.studentId)).toBe(0);
    }, 60_000);
  },
);
