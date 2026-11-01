// T004 — `enrollment_events` is append-only and says one thing per kind (ERD §15 rule 39;
// specs/003-booking/data-model.md §2.5, research R-216).
//
// Each row records an outcome a later notification needs: an enrollment confirmed by an order, an
// order that failed, an enrollment cancelled for a reason. The two checks hold a row to its kind: a
// cancellation reason exactly on `cancelled`, an order exactly on `order_failed` and `confirmed`.
// Each probe first writes the rows the checks admit, so a refusal is the rule and not a broken row,
// then each forbidden one, expecting 23514. As for the three append-only tables of rule 21, the
// application role may not UPDATE, DELETE or TRUNCATE a row (42501), and the table's foreign keys
// are `ON UPDATE RESTRICT` (`002:T135`), so an update of a referenced key is refused (23001) rather
// than cascaded into the row. Every probe runs as the application role in a transaction that is
// rolled back.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
  insertRow,
  insertStatement,
  makeEnrollment,
  type Db,
} from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

/** The SQLSTATE an insert of `values` into `table` is refused with, or null when accepted. */
async function tryInsert(table: string, values: Record<string, unknown>): Promise<string | null> {
  const { sql, params } = await insertStatement(db, table, values);
  return attempt(db, sql, params);
}

/** An enrollment and one gateway order on it: what an event row names. */
async function enrollmentWithOrder(): Promise<{ enrollmentId: string; paymentId: string }> {
  const { enrollmentId } = await makeEnrollment(db);
  const paymentId = await insertRow(db, 'payments', {
    enrollment_id: enrollmentId,
    gateway: 'fake',
    gateway_order_id: `probe-order-${randomUUID()}`,
    currency: 'EGP',
    status: 'created',
    expires_at: '2026-10-04T07:10:00Z',
  });
  return { enrollmentId, paymentId };
}

function event(
  enrollmentId: string,
  values: { kind: string; cancellation_reason?: string; payment_id?: string },
): Record<string, unknown> {
  return { enrollment_id: enrollmentId, occurred_at: '2026-10-04T07:05:00Z', ...values };
}

describe('ERD §15 rule 39: an event row says one thing per kind (T004)', () => {
  it('admits a confirmation and a failed order with their order, and a cancellation with its reason', async () => {
    await inRollback(db, async () => {
      const { enrollmentId, paymentId } = await enrollmentWithOrder();
      expect(
        await tryInsert(
          'enrollment_events',
          event(enrollmentId, { kind: 'confirmed', payment_id: paymentId }),
        ),
      ).toBeNull();
      expect(
        await tryInsert(
          'enrollment_events',
          event(enrollmentId, { kind: 'order_failed', payment_id: paymentId }),
        ),
      ).toBeNull();
      expect(
        await tryInsert(
          'enrollment_events',
          event(enrollmentId, { kind: 'cancelled', cancellation_reason: 'payment_expired' }),
        ),
      ).toBeNull();
    });
  });

  it('refuses a cancellation without its reason, and a reason on any other kind', async () => {
    await inRollback(db, async () => {
      const { enrollmentId, paymentId } = await enrollmentWithOrder();
      expect(await tryInsert('enrollment_events', event(enrollmentId, { kind: 'cancelled' }))).toBe(
        SQLSTATE.checkViolation,
      );
      for (const kind of ['confirmed', 'order_failed']) {
        expect(
          await tryInsert(
            'enrollment_events',
            event(enrollmentId, {
              kind,
              payment_id: paymentId,
              cancellation_reason: 'payment_failed',
            }),
          ),
          kind,
        ).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  it('refuses a confirmation or a failed order without its order, and an order on a cancellation', async () => {
    await inRollback(db, async () => {
      const { enrollmentId, paymentId } = await enrollmentWithOrder();
      for (const kind of ['confirmed', 'order_failed']) {
        expect(await tryInsert('enrollment_events', event(enrollmentId, { kind })), kind).toBe(
          SQLSTATE.checkViolation,
        );
      }
      expect(
        await tryInsert(
          'enrollment_events',
          event(enrollmentId, {
            kind: 'cancelled',
            cancellation_reason: 'payment_failed',
            payment_id: paymentId,
          }),
        ),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('holds both checks by name', async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT conname AS name FROM pg_constraint
        WHERE contype = 'c' AND conrelid = 'enrollment_events'::regclass ORDER BY conname`,
    );
    expect(rows.map(({ name }) => name)).toEqual([
      'enrollment_events_cancellation_reason_check',
      'enrollment_events_payment_check',
    ]);
  });
});

describe('ERD §15 rule 39: an event row is never rewritten (T004)', () => {
  it('a row is written, then UPDATE, DELETE and TRUNCATE are refused', async () => {
    await inRollback(db, async () => {
      const { enrollmentId, paymentId } = await enrollmentWithOrder();
      const id = await insertRow(
        db,
        'enrollment_events',
        event(enrollmentId, { kind: 'confirmed', payment_id: paymentId }),
      );
      expect(
        await attempt(db, 'UPDATE "enrollment_events" SET "occurred_at" = now() WHERE id = $1', [
          id,
        ]),
      ).toBe(SQLSTATE.insufficientPrivilege);
      expect(await attempt(db, 'DELETE FROM "enrollment_events" WHERE id = $1', [id])).toBe(
        SQLSTATE.insufficientPrivilege,
      );
      expect(await attempt(db, 'TRUNCATE "enrollment_events"')).toBe(
        SQLSTATE.insufficientPrivilege,
      );
    });
  });

  it.each([
    { column: 'enrollment_id', parent: 'enrollments' },
    { column: 'payment_id', parent: 'payments' },
  ])(
    '$column: an UPDATE of the key it references in $parent is refused (002:T135)',
    async ({ column, parent }) => {
      await inRollback(db, async () => {
        const { enrollmentId, paymentId } = await enrollmentWithOrder();
        const id = await insertRow(
          db,
          'enrollment_events',
          event(enrollmentId, { kind: 'confirmed', payment_id: paymentId }),
        );
        const key = column === 'enrollment_id' ? enrollmentId : paymentId;
        expect(
          await attempt(db, `UPDATE "${parent}" SET id = $1 WHERE id = $2`, [randomUUID(), key]),
        ).toBe(SQLSTATE.restrictViolation);
        const { rows } = await db.query<Record<string, unknown>>(
          `SELECT "${column}" FROM "enrollment_events" WHERE id = $1`,
          [id],
        );
        expect(rows[0]?.[column]).toBe(key);
      });
    },
  );

  it('every foreign key of the table is ON UPDATE RESTRICT and ON DELETE RESTRICT', async () => {
    const { rows } = await db.query<{ name: string; onUpdate: string; onDelete: string }>(
      `SELECT conname AS name, confupdtype AS "onUpdate", confdeltype AS "onDelete"
         FROM pg_constraint
        WHERE contype = 'f' AND conrelid = 'enrollment_events'::regclass
        ORDER BY conname`,
    );
    expect(rows).toEqual([
      { name: 'enrollment_events_enrollment_id_fkey', onUpdate: 'r', onDelete: 'r' },
      { name: 'enrollment_events_payment_id_fkey', onUpdate: 'r', onDelete: 'r' },
    ]);
  });
});
