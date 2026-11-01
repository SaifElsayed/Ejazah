// T052 — a replayed provider event cannot be recorded twice, and a gateway order has one record
// (FR-036, FR-073, ERD section 15.4, 15.13, 15.14).
//
// Each probe first writes a valid row, so a rejection is the rule and not a broken row, and then
// the forbidden one: the same `provider_event_id` again (23505), a gateway event with none (23502),
// a second payment with the same `gateway_order_id` (23505). Every probe runs as the application
// role in a transaction that is rolled back.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
  insertRow,
  insertStatement,
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

/** The SQLSTATE an insert of `values` into `table` is refused with, or null when accepted. */
async function tryInsert(table: string, values: Record<string, unknown>): Promise<string | null> {
  const { sql, params } = await insertStatement(db, table, values);
  return attempt(db, sql, params);
}

/**
 * The columns of one gateway order for `enrollmentId` (ERD section 7). Its amount is left to the
 * harness, which sets a required number to 0: the order id is what these probes are about, and
 * R-MONEY-6 keeps the amount's name inside the payments module.
 */
function paymentValues(enrollmentId: string, gatewayOrderId: string): Record<string, unknown> {
  return {
    enrollment_id: enrollmentId,
    gateway: 'fake',
    gateway_order_id: gatewayOrderId,
    currency: 'EGP',
    status: 'created',
  };
}

/** The columns of one signed gateway event on `paymentId`. */
function paymentEventValues(
  paymentId: string,
  providerEventId: string | null,
): Record<string, unknown> {
  return {
    payment_id: paymentId,
    provider_event_id: providerEventId,
    event_type: 'paid',
    signature_verified_at: '2026-10-04T07:01:00Z',
    payload_hash: 'probe-payload-hash',
    received_at: '2026-10-04T07:01:00Z',
  };
}

describe('replay safety (T052)', () => {
  it('a duplicate provider_event_id on session_participant_events is refused as unique (FR-036, ERD section 15.4)', async () => {
    await inRollback(db, async () => {
      const session = await makeSession(db);
      const event = {
        session_id: session.sessionId,
        user_id: session.teacherId,
        event_type: 'joined',
        occurred_at: '2026-10-04T06:00:03Z',
        provider_event_id: 'probe-attendance-event',
      };
      expect(await tryInsert('session_participant_events', event)).toBeNull();
      expect(await tryInsert('session_participant_events', event)).toBe(SQLSTATE.uniqueViolation);
    });
  });

  it('a duplicate provider_event_id on payment_events is refused as unique (FR-073, ERD section 15.13)', async () => {
    await inRollback(db, async () => {
      const enrollment = await makeEnrollment(db);
      const paymentId = await insertRow(
        db,
        'payments',
        paymentValues(enrollment.enrollmentId, 'probe-order-1'),
      );
      const event = paymentEventValues(paymentId, 'probe-gateway-event');
      expect(await tryInsert('payment_events', event)).toBeNull();
      expect(await tryInsert('payment_events', event)).toBe(SQLSTATE.uniqueViolation);
    });
  });

  it('a NULL payment_events.provider_event_id is refused as not-null (FR-073)', async () => {
    await inRollback(db, async () => {
      const enrollment = await makeEnrollment(db);
      const paymentId = await insertRow(
        db,
        'payments',
        paymentValues(enrollment.enrollmentId, 'probe-order-1'),
      );
      expect(
        await tryInsert('payment_events', paymentEventValues(paymentId, 'probe-gateway-event')),
      ).toBeNull();
      expect(await tryInsert('payment_events', paymentEventValues(paymentId, null))).toBe(
        SQLSTATE.notNullViolation,
      );
    });
  });

  it('a duplicate payments.gateway_order_id is refused as unique (ERD section 15.14)', async () => {
    await inRollback(db, async () => {
      const enrollment = await makeEnrollment(db);
      const order = paymentValues(enrollment.enrollmentId, 'probe-order-1');
      expect(await tryInsert('payments', order)).toBeNull();
      expect(await tryInsert('payments', order)).toBe(SQLSTATE.uniqueViolation);
    });
  });
});
