// T019 — a teacher's weekly slots over the real tables (R-206, R-207, FR-313, FR-317, FR-318, M3).
//
// Two saves of overlapping slots at the same moment leave one: the create locks the teacher's
// account, then `lockKey('teacher-slots', teacherId)`, and only then reads the teacher's active
// slots (T005's rules, the note under T019), so the second save waits and then reads the first.
// Without the locks both read no slot and both insert, which is what R-206's lock exists to stop.
// HOW THE RACE IS STAGED, as `account-locks.spec.ts` stages it: transaction A saves and stays open;
// transaction B starts its save and is seen waiting on a lock by a watcher reading
// `pg_stat_activity`, so the order is the database's, not the timing's; then A commits and B ends.
//
// Beside it: the save stores the teacher's zone and the local start in its `time` column, never an
// instant (FR-313); another teacher's slot id answers NOT_FOUND and leaves the row as it was (M3);
// a slot an enrollment awaiting payment uses keeps its day, start and length, through booking's
// answer bound as `main.ts` binds it (R-207). The rows are committed, each probe writing a teacher
// of its own; all three connections are the application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  packageEnrollmentCounts,
  packageHasEnrollment,
  slotInUse,
} from '../../apps/api/src/modules/booking/index.js';
import { createCatalogServices } from '../../apps/api/src/modules/catalog/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { connectAsApplication, type Db, insertRow, makeOffer, makeUser } from './harness';

let db: Db;
let watcher: Db;
let database: Database;

beforeAll(async () => {
  [db, watcher] = await Promise.all([connectAsApplication(), connectAsApplication()]);
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await Promise.all([db?.end(), watcher?.end()]);
  await closeDatabase(database);
});

const use = { slotInUse, packageHasEnrollment, packageEnrollmentCounts };

/**
 * The slots service as `main.ts` builds it. With `tx`, every transaction it opens is `tx` (its
 * own, and the keyed create's, the stand-in for the kernel's idempotency transaction), so a race
 * sees its waits on the transaction it watches.
 */
function slotsOn(tx?: Transaction) {
  const on: Database =
    tx === undefined
      ? database
      : (new Proxy(database, {
          get: (target, member) =>
            member === '$transaction'
              ? (work: (inner: Transaction) => Promise<unknown>) => work(tx)
              : Reflect.get(target, member),
        }) as Database);
  return createCatalogServices({
    database: on,
    use,
    idempotency: { run: (_request, effect) => on.$transaction(effect) },
  }).slots;
}

let keys = 0;
const key = () => `probe-slot-key-${String((keys += 1)).padStart(8, '0')}-${String(Date.now())}`;

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

const OPTIONS = { maxWait: 5_000, timeout: 15_000 };

/**
 * A runs `first` and stays open; B runs `second` and is seen waiting; A commits. Answers how B
 * ended: its value, or the code of what it threw.
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
  const a = database.$transaction(async (tx) => {
    await first(tx);
    ran();
    await released;
  }, OPTIONS);
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
      (value) => ({ value }),
      (thrown: unknown) => ({
        thrown: (thrown as { readonly code?: unknown }).code ?? String(thrown),
      }),
    );
  try {
    await seenWaiting(await bStarted);
  } finally {
    release();
    await a;
  }
  return b;
}

interface SlotColumns {
  day_of_week: number;
  start_time_local: string;
  duration_minutes: number;
  timezone: string;
  is_active: boolean;
  updated_at: Date;
}

async function slotsOf(teacherId: string): Promise<SlotColumns[]> {
  const { rows } = await db.query<SlotColumns>(
    `SELECT day_of_week, start_time_local::text AS start_time_local, duration_minutes, timezone,
            is_active, updated_at
       FROM availability_slots WHERE teacher_user_id = $1 ORDER BY id`,
    [teacherId],
  );
  return rows;
}

const SUNDAY_LATE = { dayOfWeek: 0, startTimeLocal: '23:30', durationMinutes: 60 } as const;
const MONDAY_MIDNIGHT = { dayOfWeek: 1, startTimeLocal: '00:00', durationMinutes: 30 } as const;

describe('two overlapping saves at the same moment leave one (R-206, FR-317)', () => {
  it('the second create waits on the first, then reads its slot and is refused SLOT_OVERLAP', async () => {
    const teacherId = await makeUser(db);
    const ended = await race(
      (tx) => slotsOn(tx).create(teacherId, { ...SUNDAY_LATE, idempotencyKey: key() }),
      (tx) => slotsOn(tx).create(teacherId, { ...MONDAY_MIDNIGHT, idempotencyKey: key() }),
    );
    expect(ended).toEqual({ thrown: 'SLOT_OVERLAP' });
    expect(await slotsOf(teacherId)).toEqual([
      expect.objectContaining({ day_of_week: 0, start_time_local: '23:30:00', is_active: true }),
    ]);
  });

  it('a reactivation waits on a create of the same teacher, then is refused SLOT_OVERLAP', async () => {
    const teacherId = await makeUser(db);
    const disabled = await insertRow(db, 'availability_slots', {
      teacher_user_id: teacherId,
      day_of_week: 1,
      start_time_local: '00:00:00',
      duration_minutes: 30,
      timezone: 'Africa/Cairo',
      is_active: false,
    });
    const ended = await race(
      (tx) => slotsOn(tx).create(teacherId, { ...SUNDAY_LATE, idempotencyKey: key() }),
      (tx) => slotsOn(tx).update(teacherId, { slotId: disabled, isActive: true }),
    );
    expect(ended).toEqual({ thrown: 'SLOT_OVERLAP' });
    expect((await slotsOf(teacherId)).map((slot) => slot.is_active)).toEqual([false, true]);
  });
});

describe('a save stores wall-clock time in the teacher’s zone (FR-313, R-TIME-3)', () => {
  it("writes the teacher's zone at creation and the local start in its time column", async () => {
    const teacherId = await makeUser(db, { timezone: 'Asia/Riyadh' });
    const slot = await slotsOn().create(teacherId, { ...SUNDAY_LATE, idempotencyKey: key() });
    expect(slot).toMatchObject({ ...SUNDAY_LATE, timezone: 'Asia/Riyadh', state: 'free' });
    expect(await slotsOf(teacherId)).toEqual([
      expect.objectContaining({
        day_of_week: 0,
        start_time_local: '23:30:00',
        duration_minutes: 60,
        timezone: 'Asia/Riyadh',
      }),
    ]);
    await expect(slotsOn().list(teacherId)).resolves.toEqual({
      timezone: 'Asia/Riyadh',
      slots: [slot],
    });
  });
});

describe("another teacher's slot (M3)", () => {
  it('answers NOT_FOUND and leaves the row as it was', async () => {
    const offer = await makeOffer(db);
    const callerId = await makeUser(db);
    const before = await slotsOf(offer.teacherId);
    for (const change of [{ isActive: false }, { dayOfWeek: 3 }, { startTimeLocal: '10:00' }]) {
      await expect(
        slotsOn().update(callerId, { slotId: offer.slotId, ...change }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await slotsOf(offer.teacherId)).toEqual(before);
    expect(await slotsOf(callerId)).toEqual([]);
  });
});

describe('a slot in use keeps its day, start and length (R-207, FR-318)', () => {
  it('refuses a new start while an enrollment awaits payment on it, and still deactivates it', async () => {
    const offer = await makeOffer(db);
    const studentId = await makeUser(db);
    await insertRow(db, 'enrollments', {
      student_user_id: studentId,
      teacher_user_id: offer.teacherId,
      package_id: offer.packageId,
      slot_id: offer.slotId,
      snapshot_price_piasters: 100_000,
      snapshot_session_count: 4,
      snapshot_duration_minutes: 60,
      snapshot_subject_id: offer.subjectId,
      snapshot_slot_timezone: 'Africa/Cairo',
      status: 'pending_payment',
      purchased_at: '2026-10-04T07:00:00Z',
      quoted_first_session_local_date: '2026-10-11',
    });
    await expect(
      slotsOn().update(offer.teacherId, { slotId: offer.slotId, startTimeLocal: '10:00' }),
    ).rejects.toMatchObject({ code: 'SLOT_IN_USE' });
    await expect(
      slotsOn().update(offer.teacherId, { slotId: offer.slotId, isActive: false }),
    ).resolves.toMatchObject({ startTimeLocal: '09:00', isActive: false, state: 'disabled' });
  });
});
