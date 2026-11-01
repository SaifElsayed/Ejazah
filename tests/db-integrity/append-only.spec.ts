// T147 — the three append-only tables cannot be rewritten by the application role (ERD section
// 15.21, data-model.md section 5).
//
// Each row records something that happened: an administrator's action, a gateway's signed event,
// a provider's attendance evidence. For each table a row is written first, so the role is shown
// to work on it, and then an UPDATE, a DELETE and a TRUNCATE of it are each refused with 42501.
// Every probe runs as the application role in a transaction that is rolled back.
//
// T135 — nor through a key update. The foreign keys of the three tables were created
// `ON UPDATE CASCADE`, so an UPDATE of a referenced key, which the role holds on the parent table,
// rewrote the event row through the cascade, past the revoked UPDATE. A migration made them
// `ON UPDATE RESTRICT`: the parent's key update is refused with 23001 and the row keeps its key.
// The catalogue probe holds every foreign key of the three tables to RESTRICT, a later one too.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
  insertRow,
  makeAdmin,
  makeEnrollment,
  makeSession,
  type Db,
} from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

/**
 * Each append-only table, a column an UPDATE would rewrite, how to write one row of it, and its
 * foreign keys with the table each references.
 */
const appendOnly: ReadonlyArray<{
  table: string;
  column: string;
  write: (db: Db) => Promise<string>;
  keys: ReadonlyArray<{ column: string; parent: string }>;
}> = [
  {
    table: 'audit_logs',
    column: 'action',
    keys: [{ column: 'admin_id', parent: 'admin_users' }],
    write: async (db) => {
      const adminId = await makeAdmin(db);
      return insertRow(db, 'audit_logs', {
        admin_id: adminId,
        action: 'probe.recorded',
        target_type: 'probe',
        target_id: adminId,
        target_label: `مشرف · ${adminId}`,
      });
    },
  },
  {
    table: 'payment_events',
    column: 'payload_hash',
    keys: [{ column: 'payment_id', parent: 'payments' }],
    write: async (db) => {
      const enrollment = await makeEnrollment(db);
      const paymentId = await insertRow(db, 'payments', {
        enrollment_id: enrollment.enrollmentId,
        gateway: 'fake',
        gateway_order_id: 'probe-order-1',
        currency: 'EGP',
        status: 'created',
      });
      return insertRow(db, 'payment_events', {
        payment_id: paymentId,
        provider_event_id: 'probe-gateway-event',
        event_type: 'paid',
        signature_verified_at: '2026-10-04T07:01:00Z',
        payload_hash: 'probe-payload-hash',
        received_at: '2026-10-04T07:01:00Z',
      });
    },
  },
  {
    table: 'session_participant_events',
    column: 'provider_event_id',
    keys: [
      { column: 'session_id', parent: 'sessions' },
      { column: 'user_id', parent: 'users' },
    ],
    write: async (db) => {
      const session = await makeSession(db);
      return insertRow(db, 'session_participant_events', {
        session_id: session.sessionId,
        user_id: session.studentId,
        event_type: 'joined',
        occurred_at: '2026-10-04T06:00:05Z',
        provider_event_id: 'probe-attendance-event',
      });
    },
  },
];

describe('append-only tables are never rewritten (T147)', () => {
  it.each(appendOnly)(
    '$table: a row is written, then UPDATE, DELETE and TRUNCATE are refused',
    async ({ table, column, write }) => {
      await inRollback(db, async () => {
        const id = await write(db);
        const quoted = `"${table}"`;
        expect(
          await attempt(db, `UPDATE ${quoted} SET "${column}" = "${column}" WHERE id = $1`, [id]),
        ).toBe(SQLSTATE.insufficientPrivilege);
        expect(await attempt(db, `DELETE FROM ${quoted} WHERE id = $1`, [id])).toBe(
          SQLSTATE.insufficientPrivilege,
        );
        expect(await attempt(db, `TRUNCATE ${quoted}`)).toBe(SQLSTATE.insufficientPrivilege);
      });
    },
  );
});

const referencedKeys = appendOnly.flatMap(({ table, write, keys }) =>
  keys.map((key) => ({ table, write, ...key })),
);

describe('an append-only row is never rewritten through a key update (T135)', () => {
  it.each(referencedKeys)(
    '$table, $column: an UPDATE of the key it references in $parent is refused',
    async ({ table, write, column, parent }) => {
      await inRollback(db, async () => {
        const id = await write(db);
        const read = async (): Promise<unknown> => {
          const { rows } = await db.query<Record<string, unknown>>(
            `SELECT "${column}" FROM "${table}" WHERE id = $1`,
            [id],
          );
          return rows[0]?.[column];
        };
        const key = await read();
        expect(
          await attempt(db, `UPDATE "${parent}" SET id = $1 WHERE id = $2`, [randomUUID(), key]),
        ).toBe(SQLSTATE.restrictViolation);
        expect(await read()).toBe(key);
      });
    },
  );

  it('every foreign key of the three tables is ON UPDATE RESTRICT', async () => {
    const { rows } = await db.query<{ name: string; onUpdate: string }>(
      `SELECT conname AS name, confupdtype AS "onUpdate"
         FROM pg_constraint
        WHERE contype = 'f' AND conrelid = ANY ($1::regclass[])
        ORDER BY conname`,
      [appendOnly.map(({ table }) => table)],
    );
    expect(rows.map(({ name }) => name)).toEqual(
      referencedKeys.map(({ table, column }) => `${table}_${column}_fkey`).sort(),
    );
    // `r` is RESTRICT; NO ACTION (`a`) would refuse too, but CASCADE (`c`) rewrites the row.
    expect(rows.filter(({ onUpdate }) => onUpdate !== 'r')).toEqual([]);
  });
});
