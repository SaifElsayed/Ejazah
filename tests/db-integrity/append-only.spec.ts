// T147 — the three append-only tables cannot be rewritten by the application role (ERD section
// 15.21, data-model.md section 5).
//
// Each row records something that happened: an administrator's action, a gateway's signed event,
// a provider's attendance evidence. For each table a row is written first, so the role is shown
// to work on it, and then an UPDATE, a DELETE and a TRUNCATE of it are each refused with 42501.
// Every probe runs as the application role in a transaction that is rolled back.
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

/** Each append-only table, a column an UPDATE would rewrite, and how to write one row of it. */
const appendOnly: ReadonlyArray<{
  table: string;
  column: string;
  write: (db: Db) => Promise<string>;
}> = [
  {
    table: 'audit_logs',
    column: 'action',
    write: async (db) => {
      const adminId = await makeAdmin(db);
      return insertRow(db, 'audit_logs', {
        admin_id: adminId,
        action: 'probe.recorded',
        target_type: 'probe',
        target_id: adminId,
      });
    },
  },
  {
    table: 'payment_events',
    column: 'payload_hash',
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
