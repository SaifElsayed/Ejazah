// T008 of specs/004-sessions/tasks.md — booking's `createEnrollmentSide()`, sessions'
// `EnrollmentSide` port, over the real tables as the application role (research R-301, R-322,
// R-323 GAP-1; the third analysis, U3; data-model.md §3, "Enrollment, this phase's moves").
//
// Each move, from its source state, writes the enrollment's status and its one `enrollment_events`
// row, which the table's two checks admit (rule 39: neither an order nor a reason, but `cancelled`'s
// `admin`), and leaves `confirmed_at` as it was (R-HONEST-1); from any other state it changes
// nothing, writes no row and answers false. `lockEnrollments` holds the rows `FOR UPDATE` until the
// transaction ends. The reads answer the snapshot, the events oldest first with no order's id
// (FR-497), and keyset pages newest first under every filter at once.
//
// The enrollments are written and committed by the harness, each probe with its own (as
// `held-files.spec.ts`' are); each move runs in a transaction this file rolls back, so no event row
// and no status it writes is kept.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { connectAsApplication, type Db, insertRow, makeEnrollment } from './harness';

const AT = new Date('2026-11-08T09:00:00Z');
const CONFIRMED_AT = new Date('2026-10-04T07:01:00Z');
const PAGE_SIZE = 2;

let db: Db;
let database: Database;

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key !== 'admin_list_page_size') throw new Error(`unexpected setting ${key}`);
    return schema.parse(PAGE_SIZE);
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
    const { rows } = await db.query<{ slot_id: string }>(
      'SELECT slot_id FROM enrollments WHERE id = $1',
      [enrollmentId],
    );
    await rolledBack(async (tx) => {
      expect(await side.enrollmentFor(tx, enrollmentId)).toEqual({
        id: enrollmentId,
        status: 'confirmed',
        slotId: rows[0]?.slot_id,
        track: 'recitation',
        timezone: 'Africa/Cairo',
        durationMinutes: 60,
        sessionCount: 4,
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
