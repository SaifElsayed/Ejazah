// T033 — holds under concurrency (R-208, FR-351, FR-352, SC-306; T005's lock rules; the note under
// T033 of B24). What needs a real commit:
//
//   - 200 students holding one slot at once leave exactly one active hold, every other answered
//     SLOT_TAKEN;
//   - one student holding two slots at once, several times over, leaves exactly one, every other
//     answered PREVIOUS_CHECKOUT (or SLOT_TAKEN on the slot the winner holds);
//   - a refused hold keeps nothing once its transaction ends: the student whose third session would
//     overlap their own session is refused, and no hold of theirs or on the slot is left;
//   - a teacher's ban racing a booking of one of the teacher's slots, each order seen waiting on the
//     other's lock: neither deadlocks, and no hold of the teacher's slots is left after the ban
//     commits (R-219). The ban runs through identity's `StandingService` with booking's T041
//     subscriber bound to its registry, as `main.ts` binds it: after the account it takes the
//     teacher's slots' key, then the holds, their enrollments and their orders (T005), the order B22
//     found deadlocking against a booking that took the slot first.
//
// HOW THE ROWS GO. The parents are committed as the application role through the API's client; the
// suite removes every row it recorded creating through an OWNER connection afterwards, the only role
// that may delete users, enrollments, sessions and `enrollment_events` (T065, ERD §15 rule 21), as
// `booking-concurrency.spec.ts` does.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bookingSlotsOf,
  bookingSlotsStore,
  type HoldsStore,
  holdsStore,
  type HoldTerms,
  placeHold,
  terminationSubscriber,
} from '../../apps/api/src/modules/booking/index.js';
import {
  AccountConsequences,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import { orderStandingsOf } from '../../apps/api/src/modules/payments/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import { connectAsApplication, type Db } from './harness';

const CAIRO = 'Africa/Cairo';
/** Tuesday 2026-11-03 10:00 in Cairo. */
const NOW = new Date('2026-11-03T08:00:00Z');
const terms: HoldTerms = {
  now: NOW,
  ttlMinutes: 10,
  graceMinutes: 5,
  leadHours: 24,
  bufferWeeks: async () => 0,
};
const HOLDERS = 200;
const TWICE_OVER = 10;
const DEADLOCK = '40P01';
/** Long enough for 200 transactions taking one teacher's lock in turn. */
const OPTIONS = { maxWait: 120_000, timeout: 120_000 };

let database: Database;
let watcher: Db;
const users: string[] = [];
const subjects: string[] = [];
const admins: string[] = [];

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 12,
    statementTimeoutMs: 60_000,
    idleInTransactionTimeoutMs: 120_000,
  });
  watcher = await connectAsApplication();
});

afterAll(async () => {
  await watcher?.end();
  await closeDatabase(database);
  if (users.length === 0) return;
  const owner = new pg.Client({
    connectionString: specDatabaseUrl('DATABASE_URL_OWNER'),
    connectionTimeoutMillis: 5_000,
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    const enrollments =
      'SELECT id FROM "enrollments" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)';
    await owner.query(`DELETE FROM "enrollment_events" WHERE enrollment_id IN (${enrollments})`, [
      users,
    ]);
    await owner.query(`DELETE FROM "payments" WHERE enrollment_id IN (${enrollments})`, [users]);
    await owner.query(
      'DELETE FROM "sessions" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
      [users],
    );
    await owner.query(
      'DELETE FROM "slot_holds" WHERE student_user_id = ANY($1) OR slot_id IN (SELECT id FROM "availability_slots" WHERE teacher_user_id = ANY($1))',
      [users],
    );
    await owner.query(
      'DELETE FROM "enrollments" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
      [users],
    );
    await owner.query('DELETE FROM "availability_slots" WHERE teacher_user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "packages" WHERE teacher_user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "teacher_profiles" WHERE user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "user_sessions" WHERE user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "subjects" WHERE id = ANY($1)', [subjects]);
    await owner.query('DELETE FROM "users" WHERE id = ANY($1)', [users]);
    await owner.query('DELETE FROM "admin_users" WHERE id = ANY($1)', [admins]);
    await owner.query('COMMIT');
  } finally {
    await owner.end();
  }
});

type Gender = 'male' | 'female';

async function student(gender: Gender = 'female'): Promise<string> {
  const { id } = await database.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      gender,
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      displayName: 'Probe person',
      preferredLanguage: 'ar',
      timezone: CAIRO,
      accountStatus: 'active',
    },
    select: { id: true },
  });
  users.push(id);
  return id;
}

interface Offer {
  readonly teacherId: string;
  readonly packageId: string;
  readonly subjectId: string;
  /** Thursday 09:00 for 60 minutes. */
  readonly slotId: string;
}

/** A committed Cairo teacher, approved and payable, with a four-session package and one slot. */
async function offer(): Promise<Offer> {
  const teacherId = await student();
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
  subjects.push(subjectId);
  const { id: packageId } = await database.package.create({
    data: {
      teacherUserId: teacherId,
      subjectId,
      sessionCount: 4,
      sessionDurationMinutes: 60,
      pricePiasters: 100_000n,
      isActive: true,
    },
    select: { id: true },
  });
  const { id: slotId } = await database.availabilitySlot.create({
    data: {
      teacherUserId: teacherId,
      dayOfWeek: 4,
      startTimeLocal: new Date('1970-01-01T09:00:00Z'),
      durationMinutes: 60,
      timezone: CAIRO,
      isActive: true,
    },
    select: { id: true },
  });
  return { teacherId, packageId, subjectId, slotId };
}

const studentOf = (id: string) => ({ userId: id, gender: 'female' as RequesterGender });

/** One placement in a transaction of its own: the hold's id, or what it threw. */
function placeAlone(who: string, on: Offer): Promise<string> {
  return database.$transaction(
    async (tx) =>
      (
        await placeHold(
          tx,
          studentOf(who),
          { packageId: on.packageId, slotId: on.slotId },
          { terms, orders: orderStandingsOf },
        )
      ).holdId,
    OPTIONS,
  );
}

function activeHolds(where: { slotId?: string; studentUserId?: string }): Promise<number> {
  return database.slotHold.count({ where: { ...where, releasedAt: null } });
}

/** The codes the refused placements answered, counted. */
function codesOf(outcomes: readonly PromiseSettledResult<string>[]): Record<string, number> {
  const codes: Record<string, number> = {};
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') continue;
    const reason: unknown = outcome.reason;
    const code = reason instanceof DomainError ? reason.code : String(reason);
    codes[code] = (codes[code] ?? 0) + 1;
  }
  return codes;
}

describe('holds at once (R-208, FR-352, SC-306)', () => {
  it(
    `${String(HOLDERS)} students holding one slot at once leave one active hold`,
    { timeout: 180_000 },
    async () => {
      const on = await offer();
      const students: string[] = [];
      for (let index = 0; index < HOLDERS; index += 1) students.push(await student());
      const outcomes = await Promise.allSettled(students.map((who) => placeAlone(who, on)));
      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(codesOf(outcomes)).toEqual({ SLOT_TAKEN: HOLDERS - 1 });
      expect(await activeHolds({ slotId: on.slotId })).toBe(1);
    },
  );

  it(
    'one student holding two slots at once, several times over, leaves one active hold',
    { timeout: 60_000 },
    async () => {
      const [first, second] = [await offer(), await offer()];
      const who = await student();
      const attempts = Array.from({ length: TWICE_OVER }, (_unused, index) =>
        placeAlone(who, index % 2 === 0 ? first : second),
      );
      const outcomes = await Promise.allSettled(attempts);
      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(codesOf(outcomes)).toEqual({ PREVIOUS_CHECKOUT: TWICE_OVER - 1 });
      expect(await activeHolds({ studentUserId: who })).toBe(1);
    },
  );
});

describe('a refused hold keeps nothing (FR-351, T033)', () => {
  it('refuses the student whose third session would overlap their own, and no hold is left', async () => {
    const on = await offer();
    const elsewhere = await offer();
    const who = await student();
    const { id: enrollmentId } = await database.enrollment.create({
      data: {
        studentUserId: who,
        teacherUserId: elsewhere.teacherId,
        packageId: elsewhere.packageId,
        slotId: elsewhere.slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: elsewhere.subjectId,
        snapshotSlotTimezone: CAIRO,
        status: 'confirmed',
        confirmedAt: new Date('2026-10-04T07:01:00Z'),
        purchasedAt: new Date('2026-10-04T07:00:00Z'),
        quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
      },
      select: { id: true },
    });
    await database.session.create({
      data: {
        enrollmentId,
        teacherUserId: elsewhere.teacherId,
        studentUserId: who,
        sequenceNumber: 1,
        scheduledDateLocal: new Date('2026-11-19T00:00:00Z'),
        scheduledStartTimeLocal: new Date('1970-01-01T09:30:00Z'),
        timezone: CAIRO,
        scheduledStartAt: new Date('2026-11-19T07:30:00Z'),
        scheduledEndAt: new Date('2026-11-19T08:30:00Z'),
        status: 'scheduled',
      },
    });
    const sheet = await database.$transaction((tx) =>
      bookingSlotsOf(
        tx,
        bookingSlotsStore,
        studentOf(who),
        { packageId: on.packageId },
        { now: NOW, leadHours: terms.leadHours, bufferWeeks: terms.bufferWeeks },
      ),
    );
    expect(sheet.slots).toEqual([]);
    await expect(placeAlone(who, on)).rejects.toEqual(new DomainError('SLOT_TAKEN'));
    expect(await activeHolds({ slotId: on.slotId })).toBe(0);
    expect(await database.slotHold.count({ where: { studentUserId: who } })).toBe(0);
  });
});

describe("a teacher's ban racing a booking of the teacher's slot (the note under T033, R-219)", () => {
  let standing: StandingService;

  beforeAll(() => {
    const consequences = new AccountConsequences();
    consequences.subscribe(terminationSubscriber({ orders: orderStandingsOf, now: () => NOW }));
    standing = new StandingService({
      store: standingStoreOver(database),
      consequences,
      revokeSubjects: async () => undefined,
      hasOpenIdentityRequest: async () => false,
    });
  });

  async function admin(): Promise<string> {
    const { id } = await database.adminUser.create({
      data: {
        email: `probe-${randomUUID()}@example.invalid`,
        passwordHash: 'probe-hash',
        mfaSecretEncrypted: Buffer.from('probe'),
        displayName: 'Probe administrator',
        isActive: true,
      },
      select: { id: true },
    });
    admins.push(id);
    return id;
  }

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

  type Ended = { readonly value: unknown } | { readonly thrown: unknown };

  /** A runs `first` and stays open; B runs `second` and is seen waiting; A commits. How each ended. */
  async function race(
    first: (tx: Transaction) => Promise<unknown>,
    second: (tx: Transaction) => Promise<unknown>,
  ): Promise<{ readonly a: Ended; readonly b: Ended }> {
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ran = (): void => undefined;
    const firstRan = new Promise<void>((resolve) => {
      ran = resolve;
    });
    const a = database
      .$transaction(async (tx) => {
        const value = await first(tx);
        ran();
        await released;
        return value;
      }, OPTIONS)
      .then(
        (value): Ended => ({ value }),
        (thrown: unknown): Ended => ({ thrown }),
      );
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
      }, OPTIONS)
      .then(
        (value): Ended => ({ value }),
        (thrown: unknown): Ended => ({ thrown }),
      );
    try {
      await seenWaiting(await bStarted);
    } finally {
      release();
    }
    return { a: await a, b: await b };
  }

  const book = (who: string, on: Offer) => (tx: Transaction) =>
    placeHold(
      tx,
      studentOf(who),
      { packageId: on.packageId, slotId: on.slotId },
      { terms, orders: orderStandingsOf },
    );

  /** Whether `ended` is the database's deadlock refusal, anywhere in its causes. */
  function deadlocked(ended: Ended): boolean {
    if (!('thrown' in ended)) return false;
    return JSON.stringify(ended.thrown, Object.getOwnPropertyNames(ended.thrown)).includes(
      DEADLOCK,
    );
  }

  it('the ban first: the booking waits, then is refused as the teacher is no longer visible', async () => {
    const on = await offer();
    const who = await student();
    const adminId = await admin();
    const { a, b } = await race((tx) => standing.ban(tx, adminId, on.teacherId), book(who, on));
    expect(deadlocked(a) || deadlocked(b)).toBe(false);
    expect('value' in a).toBe(true);
    expect(b).toEqual({ thrown: new DomainError('NOT_FOUND') });
    expect(await activeHolds({ slotId: on.slotId })).toBe(0);
  });

  it('the booking paused holding the slot: the ban waits on the account, and neither deadlocks', async () => {
    // The interleaving B22 found: had the booking taken the slot before the accounts, the ban would
    // take the account, wait on the slot, and the booking would then wait on the account.
    const on = await offer();
    const who = await student();
    const adminId = await admin();
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let paused = (): void => undefined;
    const holdingSlot = new Promise<void>((resolve) => {
      paused = resolve;
    });
    const pausing: HoldsStore = {
      ...holdsStore,
      lockRows: async (tx, table, ids) => {
        await holdsStore.lockRows(tx, table, ids);
        if (table !== 'availability_slots') return;
        paused();
        await released;
      },
    };
    const booking = database
      .$transaction(
        (tx) =>
          placeHold(
            tx,
            studentOf(who),
            { packageId: on.packageId, slotId: on.slotId },
            { terms, orders: orderStandingsOf, store: pausing },
          ),
        OPTIONS,
      )
      .then(
        (value): Ended => ({ value }),
        (thrown: unknown): Ended => ({ thrown }),
      );
    await Promise.race([holdingSlot, booking]);
    let pidOfBan = (_pid: number): void => undefined;
    const banStarted = new Promise<number>((resolve) => {
      pidOfBan = resolve;
    });
    const ban = database
      .$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pidOfBan(row?.pid ?? 0);
        return standing.ban(tx, adminId, on.teacherId);
      }, OPTIONS)
      .then(
        (value): Ended => ({ value }),
        (thrown: unknown): Ended => ({ thrown }),
      );
    try {
      await seenWaiting(await banStarted);
    } finally {
      release();
    }
    const [booked, banned] = [await booking, await ban];
    expect(deadlocked(booked) || deadlocked(banned)).toBe(false);
    expect('value' in booked && 'value' in banned).toBe(true);
    expect(await activeHolds({ slotId: on.slotId })).toBe(0);
  });

  it('the booking first: the ban waits, then bans the teacher', async () => {
    const on = await offer();
    const who = await student();
    const adminId = await admin();
    const { a, b } = await race(book(who, on), (tx) => standing.ban(tx, adminId, on.teacherId));
    expect(deadlocked(a) || deadlocked(b)).toBe(false);
    expect('value' in a && 'value' in b).toBe(true);
    const { accountStatus } = await database.user.findUniqueOrThrow({
      where: { id: on.teacherId },
      select: { accountStatus: true },
    });
    expect(accountStatus).toBe('banned');
    expect(await activeHolds({ slotId: on.slotId })).toBe(0);
  });
});
