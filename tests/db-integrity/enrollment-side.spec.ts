// T008 of specs/004-sessions/tasks.md — booking's `createEnrollmentSide()`, sessions'
// `EnrollmentSide` port, over the real tables as the application role (research R-301, R-322,
// R-323 GAP-1; the third analysis, U3; data-model.md §3, "Enrollment, this phase's moves").
//
// Each move, from its source state, writes the enrollment's status and its one `enrollment_events`
// row, which the table's two checks admit (rule 39: neither an order nor a reason, but `cancelled`'s
// `admin`), and leaves `confirmed_at` as it was (R-HONEST-1); from any other state it changes
// nothing, writes no row and answers false. `lockEnrollments` holds the rows `FOR UPDATE` until the
// transaction ends. The reads answer the snapshot, the events oldest first with no order's id
// (FR-497), and keyset pages newest first under every filter at once. `slotWeekTaken` leaves the
// asking enrollment's own occupancy out and counts any active hold, even past its expiry;
// `heldTimesOf` answers a student's own and a teacher's slots' active holds, each counted from the
// read and from its expiry (the owner's decision of 2026-11-07 on lane C's questions).
//
// The enrollments are written and committed by the harness, each probe with its own (as
// `held-files.spec.ts`' are); each move runs in a transaction this file rolls back, so no event row
// and no status it writes is kept.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import { addMinutes } from '../../packages/time/src/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeEnrollment,
  makeUser,
} from './harness';

const AT = new Date('2026-11-08T09:00:00Z');
const CONFIRMED_AT = new Date('2026-10-04T07:01:00Z');
const PAGE_SIZE = 2;

let db: Db;
let database: Database;

const SETTINGS: Readonly<Record<string, number>> = {
  admin_list_page_size: PAGE_SIZE,
  slot_release_buffer_weeks: 1,
  first_session_lead_hours: 24,
};
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(SETTINGS[key]);
  },
};
const side = createEnrollmentSide({ settings, now: () => AT });

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

const ROLLED_BACK = Symbol('rolled back');

/** Runs `probe` on one transaction and rolls back whatever it wrote. */
async function rolledBack(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLED_BACK;
      },
      { timeout: 30_000 },
    );
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
}

type State =
  | 'pending_payment'
  | 'confirmed'
  | 'completed'
  | 'terminated_no_show'
  | 'cancelled_admin'
  | 'cancelled_payment_expired';

/** A committed enrollment of its own, put in `state` (confirmed once when it ever was). */
async function enrollmentIn(state: State): Promise<{
  enrollmentId: string;
  studentId: string;
  teacherId: string;
}> {
  const made = await makeEnrollment(db);
  const [status, reason] =
    state === 'cancelled_admin'
      ? ['cancelled', 'admin']
      : state === 'cancelled_payment_expired'
        ? ['cancelled', 'payment_expired']
        : [state, null];
  const everConfirmed = state !== 'pending_payment' && state !== 'cancelled_payment_expired';
  await db.query(
    `UPDATE enrollments SET status = $2::enrollment_status,
       cancellation_reason = $3::cancellation_reason, confirmed_at = $4, updated_at = now()
     WHERE id = $1`,
    [made.enrollmentId, status, reason, everConfirmed ? CONFIRMED_AT : null],
  );
  return made;
}

async function rowOf(tx: Transaction, id: string) {
  return tx.enrollment.findUniqueOrThrow({
    where: { id },
    select: { status: true, cancellationReason: true, confirmedAt: true },
  });
}

function eventsWritten(tx: Transaction, enrollmentId: string) {
  return tx.enrollmentEvent.findMany({
    where: { enrollmentId },
    select: { kind: true, cancellationReason: true, paymentId: true, occurredAt: true },
  });
}

const moves = [
  {
    name: 'terminateNoShow',
    call: (tx: Transaction, id: string) => side.terminateNoShow(tx, id),
    from: ['confirmed'] as const,
    wrong: ['pending_payment', 'completed', 'terminated_no_show', 'cancelled_admin'] as const,
    to: { status: 'terminated_no_show', cancellationReason: null },
    event: { kind: 'terminated_no_show', cancellationReason: null },
  },
  {
    name: 'complete',
    call: (tx: Transaction, id: string) => side.complete(tx, id),
    from: ['confirmed'] as const,
    wrong: ['pending_payment', 'completed', 'terminated_no_show', 'cancelled_admin'] as const,
    to: { status: 'completed', cancellationReason: null },
    event: { kind: 'completed', cancellationReason: null },
  },
  {
    name: 'restore',
    call: (tx: Transaction, id: string) => side.restore(tx, id),
    from: ['terminated_no_show', 'cancelled_admin'] as const,
    wrong: ['pending_payment', 'confirmed', 'completed', 'cancelled_payment_expired'] as const,
    to: { status: 'confirmed', cancellationReason: null },
    event: { kind: 'restored', cancellationReason: null },
  },
  {
    name: "cancel 'admin'",
    call: (tx: Transaction, id: string) => side.cancel(tx, id, 'admin'),
    from: ['confirmed'] as const,
    wrong: ['pending_payment', 'completed', 'terminated_no_show', 'cancelled_admin'] as const,
    to: { status: 'cancelled', cancellationReason: 'admin' },
    event: { kind: 'cancelled', cancellationReason: 'admin' },
  },
];

describe("EnrollmentSide's moves over the real tables (T008, data-model §3)", () => {
  for (const { name, call, from, wrong, to, event } of moves) {
    for (const state of from) {
      it(`${name} from ${state}: the status, one row, confirmed_at untouched, true`, async () => {
        const { enrollmentId } = await enrollmentIn(state);
        await rolledBack(async (tx) => {
          await side.lockEnrollments(tx, [enrollmentId]);
          expect(await call(tx, enrollmentId)).toBe(true);
          expect(await rowOf(tx, enrollmentId)).toEqual({ ...to, confirmedAt: CONFIRMED_AT });
          expect(await eventsWritten(tx, enrollmentId)).toEqual([
            { ...event, paymentId: null, occurredAt: AT },
          ]);
        });
      });
    }

    it(`${name} from any other state: nothing changed, no row, false`, async () => {
      for (const state of wrong) {
        const { enrollmentId } = await enrollmentIn(state);
        await rolledBack(async (tx) => {
          await side.lockEnrollments(tx, [enrollmentId]);
          const before = await rowOf(tx, enrollmentId);
          expect(await call(tx, enrollmentId)).toBe(false);
          expect(await rowOf(tx, enrollmentId)).toEqual(before);
          expect(await eventsWritten(tx, enrollmentId)).toEqual([]);
        });
      }
    });
  }
});

describe("EnrollmentSide.restore of an enrollment no payment confirmed (T008's follow-up, the owner's decision of 2026-11-07)", () => {
  it('a cancelled admin row whose confirmed_at is NULL: false, no change, no row', async () => {
    const { enrollmentId } = await enrollmentIn('cancelled_admin');
    await db.query('UPDATE enrollments SET confirmed_at = NULL, updated_at = now() WHERE id = $1', [
      enrollmentId,
    ]);
    await rolledBack(async (tx) => {
      await side.lockEnrollments(tx, [enrollmentId]);
      const before = await rowOf(tx, enrollmentId);
      expect(before).toEqual({
        status: 'cancelled',
        cancellationReason: 'admin',
        confirmedAt: null,
      });
      expect(await side.restore(tx, enrollmentId)).toBe(false);
      expect(await rowOf(tx, enrollmentId)).toEqual(before);
      expect(await eventsWritten(tx, enrollmentId)).toEqual([]);
    });
  });
});

describe('EnrollmentSide.lockEnrollments (T008, T005)', () => {
  it('holds the rows FOR UPDATE until the transaction ends', async () => {
    const one = await enrollmentIn('confirmed');
    const two = await enrollmentIn('confirmed');
    const tryLock = async (id: string): Promise<string | null> => {
      try {
        await db.query('SELECT 1 FROM enrollments WHERE id = $1 FOR UPDATE NOWAIT', [id]);
        return null;
      } catch (error: unknown) {
        return String((error as { code?: unknown }).code);
      }
    };
    await rolledBack(async (tx) => {
      await side.lockEnrollments(tx, [two.enrollmentId, one.enrollmentId]);
      expect(await tryLock(one.enrollmentId)).toBe('55P03');
      expect(await tryLock(two.enrollmentId)).toBe('55P03');
    });
    expect(await tryLock(one.enrollmentId)).toBeNull();
  });
});

describe('EnrollmentSide.enrollmentFor (T008, FR-424)', () => {
  it("answers the snapshot's track, zone, length and count, the slot and the status", async () => {
    const { enrollmentId } = await enrollmentIn('confirmed');
    const { rows } = await db.query<{
      slot_id: string;
      student_user_id: string;
      teacher_user_id: string;
    }>('SELECT slot_id, student_user_id, teacher_user_id FROM enrollments WHERE id = $1', [
      enrollmentId,
    ]);
    await rolledBack(async (tx) => {
      expect(await side.enrollmentFor(tx, enrollmentId)).toEqual({
        id: enrollmentId,
        status: 'confirmed',
        slotId: rows[0]?.slot_id,
        track: 'recitation',
        timezone: 'Africa/Cairo',
        durationMinutes: 60,
        sessionCount: 4,
        // T064 (its B34 note): the enrollment's two parties.
        studentUserId: rows[0]?.student_user_id,
        teacherUserId: rows[0]?.teacher_user_id,
      });
    });
  });

  it('answers null for no enrollment and for a soft-deleted one (T148)', async () => {
    const { enrollmentId } = await enrollmentIn('confirmed');
    await db.query('UPDATE enrollments SET deleted_at = now(), updated_at = now() WHERE id = $1', [
      enrollmentId,
    ]);
    await rolledBack(async (tx) => {
      expect(await side.enrollmentFor(tx, enrollmentId)).toBeNull();
      expect(await side.enrollmentFor(tx, randomUUID())).toBeNull();
    });
  });
});

describe('EnrollmentSide.eventsOf (T008, R-323 GAP-1, FR-497)', () => {
  it('answers every row oldest first, a reason only on a cancellation, and no order', async () => {
    const { enrollmentId } = await enrollmentIn('cancelled_admin');
    const paymentId = await insertRow(db, 'payments', {
      enrollment_id: enrollmentId,
      gateway: 'fake',
      gateway_order_id: `probe-order-${randomUUID()}`,
      currency: 'EGP',
      status: 'paid',
      expires_at: '2026-10-04T07:10:00Z',
    });
    await insertRow(db, 'enrollment_events', {
      enrollment_id: enrollmentId,
      kind: 'confirmed',
      payment_id: paymentId,
      occurred_at: '2026-10-04T07:01:00Z',
    });
    await insertRow(db, 'enrollment_events', {
      enrollment_id: enrollmentId,
      kind: 'cancelled',
      cancellation_reason: 'admin',
      occurred_at: '2026-10-20T07:00:00Z',
    });
    await rolledBack(async (tx) => {
      expect(await side.restore(tx, enrollmentId)).toBe(true);
      const events = await side.eventsOf(tx, enrollmentId);
      expect(events).toStrictEqual([
        { kind: 'confirmed', occurredAt: new Date('2026-10-04T07:01:00Z') },
        {
          kind: 'cancelled',
          cancellationReason: 'admin',
          occurredAt: new Date('2026-10-20T07:00:00Z'),
        },
        { kind: 'restored', occurredAt: AT },
      ]);
      expect(JSON.stringify(events)).not.toContain(paymentId);
    });
  });
});

describe('EnrollmentSide.enrollmentPage (T008, U3, R-API-6)', () => {
  it('pages newest first by id, admin_list_page_size at a time, under every filter at once', async () => {
    const made = [
      await enrollmentIn('confirmed'),
      await enrollmentIn('confirmed'),
      await enrollmentIn('confirmed'),
      await enrollmentIn('completed'),
    ];
    const ids = made.map(({ enrollmentId }) => enrollmentId);
    const confirmed = ids.slice(0, 3).sort().reverse();
    await rolledBack(async (tx) => {
      const first = await side.enrollmentPage(tx, { status: 'confirmed', enrollmentIds: ids });
      expect(first.items.map(({ enrollmentId }) => enrollmentId)).toEqual(confirmed.slice(0, 2));
      expect(first.nextCursor).toBe(confirmed[1]);
      const second = await side.enrollmentPage(
        tx,
        { status: 'confirmed', enrollmentIds: ids },
        first.nextCursor,
      );
      expect(second).toEqual({
        items: [
          {
            enrollmentId: confirmed[2],
            studentUserId: made.find(({ enrollmentId }) => enrollmentId === confirmed[2])
              ?.studentId,
            teacherUserId: made.find(({ enrollmentId }) => enrollmentId === confirmed[2])
              ?.teacherId,
            status: 'confirmed',
            track: 'recitation',
            sessionCount: 4,
            // T074 FU4 (rule d): the page's two new columns.
            cancellationReason: null,
            slotReleasedAt: null,
          },
        ],
      });
      const [one, two] = made;
      const byParties = await side.enrollmentPage(tx, {
        enrollmentIds: ids,
        studentUserIds: [one?.studentId ?? '', two?.studentId ?? ''],
        teacherUserIds: [two?.teacherId ?? ''],
      });
      expect(byParties.items.map(({ enrollmentId }) => enrollmentId)).toEqual([two?.enrollmentId]);
      expect(
        (await side.enrollmentPage(tx, { enrollmentIds: ids, studentUserIds: [] })).items,
      ).toEqual([]);
    });
  });
});

/** The offer an enrollment was made on: its teacher, subject, package and slot. */
async function offerOf(enrollmentId: string) {
  const { rows } = await db.query<{
    teacher_user_id: string;
    snapshot_subject_id: string;
    package_id: string;
    slot_id: string;
  }>(
    'SELECT teacher_user_id, snapshot_subject_id, package_id, slot_id FROM enrollments WHERE id = $1',
    [enrollmentId],
  );
  const [row] = rows;
  if (row === undefined) throw new Error('offerOf: no enrollment');
  return {
    teacherId: row.teacher_user_id,
    subjectId: row.snapshot_subject_id,
    packageId: row.package_id,
    slotId: row.slot_id,
  };
}

/** A committed session of the enrollment on a Sunday at 09:00 in Cairo (07:00 UTC in November). */
async function sessionOn(enrollmentId: string, localDate: string): Promise<void> {
  const { rows } = await db.query<{ student_user_id: string; teacher_user_id: string }>(
    'SELECT student_user_id, teacher_user_id FROM enrollments WHERE id = $1',
    [enrollmentId],
  );
  const [parties] = rows;
  if (parties === undefined) throw new Error('sessionOn: no enrollment');
  await insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: parties.teacher_user_id,
    student_user_id: parties.student_user_id,
    sequence_number: 1,
    scheduled_date_local: localDate,
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: `${localDate}T07:00:00Z`,
    scheduled_end_at: `${localDate}T08:00:00Z`,
    status: 'scheduled',
  });
}

/** A committed hold on the slot by `studentId`, active unless `released`. */
async function holdOn(
  on: { slotId: string; packageId: string },
  studentId: string,
  values: { sessionCount: number; expiresAt: string; released?: boolean },
): Promise<void> {
  await insertRow(db, 'slot_holds', {
    slot_id: on.slotId,
    student_user_id: studentId,
    package_id: on.packageId,
    session_count: values.sessionCount,
    expires_at: values.expiresAt,
    ...(values.released === true
      ? { released_at: values.expiresAt, release_reason: 'expired' }
      : {}),
  });
}

describe("EnrollmentSide.slotWeekTaken (T008, R-205; the owner's decision of 2026-11-07)", () => {
  it("leaves the asking enrollment's own occupancy out, and counts another's until its release", async () => {
    const own = await enrollmentIn('confirmed');
    await sessionOn(own.enrollmentId, '2026-11-29');
    const on = await offerOf(own.enrollmentId);
    await rolledBack(async (tx) => {
      // Its own release, with a buffer of one week, would be 2026-12-13: left out.
      expect(await side.slotWeekTaken(tx, on.slotId, '2026-12-06', own.enrollmentId)).toBe(false);
    });
    const other = await insertRow(db, 'enrollments', {
      ...enrollmentValues(on, await makeUser(db)),
      status: 'confirmed',
      confirmed_at: CONFIRMED_AT,
    });
    await sessionOn(other, '2026-12-06');
    await rolledBack(async (tx) => {
      // Still confirmed, the other keeps the slot whatever the week (the owner's rule of
      // 2026-11-10; FR-394 as amended).
      expect(await side.slotWeekTaken(tx, on.slotId, '2027-06-06', own.enrollmentId)).toBe(true);
      await tx.enrollment.update({ where: { id: other }, data: { status: 'completed' } });
      // Completed, the other's release is 2026-12-20; its own (left out) 2026-12-13.
      expect(await side.slotWeekTaken(tx, on.slotId, '2026-12-13', own.enrollmentId)).toBe(true);
      expect(await side.slotWeekTaken(tx, on.slotId, '2026-12-20', own.enrollmentId)).toBe(false);
    });
  });

  it('an active hold takes the slot even past its expiry; a released one does not', async () => {
    const own = await enrollmentIn('terminated_no_show');
    const on = await offerOf(own.enrollmentId);
    await holdOn(on, await makeUser(db), {
      sessionCount: 4,
      expiresAt: '2026-11-01T00:00:00Z',
      released: true,
    });
    await rolledBack(async (tx) => {
      expect(await side.slotWeekTaken(tx, on.slotId, '2026-12-06', own.enrollmentId)).toBe(false);
    });
    await holdOn(on, await makeUser(db), { sessionCount: 4, expiresAt: '2026-11-01T00:00:00Z' });
    await rolledBack(async (tx) => {
      // The other's release is 2026-12-20; its own (left out) 2026-12-13.
      expect(await side.slotWeekTaken(tx, on.slotId, '2026-12-13', own.enrollmentId)).toBe(true);
    });
  });
});

describe("EnrollmentSide.heldTimesOf (T008, F5; the owner's decision of 2026-11-07)", () => {
  it("a student's own and a teacher's slots' active holds, from the read and from the expiry", async () => {
    const first = await offerOf((await makeEnrollment(db)).enrollmentId);
    const second = await offerOf((await makeEnrollment(db)).enrollmentId);
    const third = await offerOf((await makeEnrollment(db)).enrollmentId);
    await db.query(
      `UPDATE availability_slots SET start_time_local = '12:00:00', updated_at = now() WHERE id = $1`,
      [second.slotId],
    );
    const student = await makeUser(db);
    // The student's own active hold on the first slot, past its expiry: from the expiry plus 24 h
    // its first Sunday is 2026-11-08; from the read (2026-11-08T09:00Z) plus 24 h, 2026-11-15.
    await holdOn(first, student, { sessionCount: 2, expiresAt: '2026-11-01T00:00:00Z' });
    // Another student's hold on the second teacher's slot (12:00 in Cairo, 10:00 UTC).
    await holdOn(second, await makeUser(db), {
      sessionCount: 1,
      expiresAt: '2026-11-08T09:15:00Z',
    });
    // A released hold of the student's on the third slot, and an active one of a stranger there.
    await holdOn(third, student, {
      sessionCount: 4,
      expiresAt: '2026-11-08T09:15:00Z',
      released: true,
    });
    await holdOn(third, await makeUser(db), { sessionCount: 4, expiresAt: '2026-11-08T09:15:00Z' });
    const hour = (start: string) => ({
      startsAt: new Date(start),
      endsAt: new Date(addMinutes(new Date(start), 60)),
    });
    await rolledBack(async (tx) => {
      expect(
        await side.heldTimesOf(tx, [student, second.teacherId], {
          from: new Date('2026-11-01T00:00:00Z'),
          to: new Date('2027-01-01T00:00:00Z'),
        }),
      ).toEqual([
        hour('2026-11-08T07:00:00Z'),
        hour('2026-11-15T07:00:00Z'),
        hour('2026-11-15T10:00:00Z'),
        hour('2026-11-22T07:00:00Z'),
      ]);
      expect(
        await side.heldTimesOf(tx, [student], {
          from: new Date('2026-11-15T07:30:00Z'),
          to: new Date('2026-11-22T07:00:00Z'),
        }),
      ).toEqual([hour('2026-11-15T07:00:00Z')]);
    });
  });
});
