// 005:T016 of specs/005-certification (FR-619; SRS DEC-70; the note under T016, Q-N1 (a), Q-N2 (a)):
// booking's one writer of `enrollment_events` rows hands each payment outcome to the notice port,
// on the record's own transaction, for the enrollment's student, with the enrollment's id only.
// Written before the change, and run red first. Over a client that records what it is asked; that
// the row commits with the record is tests/db-integrity/payment-notices.spec.ts'.
//
//   - the rows are written as before, in one statement, then one push per payment outcome
//     (`confirmed`, `order_failed`, `cancelled` with `payment_expired`), each to its enrollment's
//     student, read in one statement after the rows;
//   - none for any other outcome (`cancelled` with `payment_failed` or `slot_unavailable`
//     included), and then no student is read;
//   - a payment outcome with no port is refused before anything is written (no push is lost
//     silently); an outcome that pushes nothing needs none.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { type EnrollmentOutcome, recordEnrollmentEvents } from './enrollment-events.repository.js';
import type { PaymentNotice, PaymentOutcomeNotices } from './payment-outcome-notices.port.js';

const id = (n: number) => `019a4a00-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = new Date('2026-11-18T10:00:00Z');
const STUDENT_OF: Record<string, string> = {
  [id(1)]: id(101),
  [id(2)]: id(102),
  [id(3)]: id(103),
  [id(4)]: id(104),
};
const TEACHER_OF: Record<string, string> = Object.fromEntries(
  Object.keys(STUDENT_OF).map((enrollmentId) => [enrollmentId, id(900)]),
);

/** A transaction that records each statement and answers the enrollments' parties. */
function recorded() {
  const trace: string[] = [];
  const tx = {
    enrollmentEvent: {
      createMany: async ({ data }: { data: readonly { kind: string }[] }) => {
        trace.push(`events ${data.map(({ kind }) => kind).join(',')}`);
        return { count: data.length };
      },
    },
    enrollment: {
      findMany: async ({ where }: { where: { id: { in: readonly string[] } } }) => {
        trace.push(`students of ${where.id.in.join(',')}`);
        return where.id.in.map((enrollmentId) => ({
          id: enrollmentId,
          studentUserId: STUDENT_OF[enrollmentId],
          teacherUserId: TEACHER_OF[enrollmentId],
        }));
      },
    },
  } as unknown as Transaction;
  const told: PaymentNotice[] = [];
  const notices: PaymentOutcomeNotices = {
    record: async (on, notice) => {
      expect(on).toBe(tx);
      trace.push(`notify ${notice.type} for ${notice.userId}`);
      told.push(notice);
    },
  };
  return { tx, trace, told, notices };
}

const confirmed = (n: number): EnrollmentOutcome => ({
  kind: 'confirmed',
  enrollmentId: id(n),
  paymentId: id(50 + n),
  occurredAt: AT,
});

describe('recordEnrollmentEvents hands each payment outcome to the notice port (005:T016)', () => {
  it('writes the rows, then one push per payment outcome to its enrollment’s student, ids only', async () => {
    const { tx, trace, told, notices } = recorded();
    await recordEnrollmentEvents(
      tx,
      [
        confirmed(1),
        { kind: 'order_failed', enrollmentId: id(2), paymentId: id(52), occurredAt: AT },
        {
          kind: 'cancelled',
          enrollmentId: id(3),
          cancellationReason: 'payment_expired',
          occurredAt: AT,
        },
      ],
      notices,
    );
    expect(trace).toEqual([
      'events confirmed,order_failed,cancelled',
      `students of ${id(1)},${id(2)},${id(3)}`,
      `notify payment_confirmed for ${id(101)}`,
      `notify payment_failed for ${id(102)}`,
      `notify payment_expired for ${id(103)}`,
    ]);
    expect(told).toEqual([
      { userId: id(101), type: 'payment_confirmed', payload: { enrollmentId: id(1) } },
      { userId: id(102), type: 'payment_failed', payload: { enrollmentId: id(2) } },
      { userId: id(103), type: 'payment_expired', payload: { enrollmentId: id(3) } },
    ]);
  });

  it('pushes nothing for a cancellation for a failed payment, a slot unavailable, or any other outcome, and reads no student', async () => {
    const { tx, trace, told, notices } = recorded();
    await recordEnrollmentEvents(
      tx,
      [
        {
          kind: 'cancelled',
          enrollmentId: id(1),
          cancellationReason: 'payment_failed',
          occurredAt: AT,
        },
        {
          kind: 'cancelled',
          enrollmentId: id(2),
          cancellationReason: 'slot_unavailable',
          occurredAt: AT,
        },
        { kind: 'cancelled', enrollmentId: id(3), cancellationReason: 'admin', occurredAt: AT },
        { kind: 'completed', enrollmentId: id(4), occurredAt: AT },
      ],
      notices,
    );
    expect(trace).toEqual(['events cancelled,cancelled,cancelled,completed']);
    expect(told).toEqual([]);
  });

  it('pushes only the payment outcomes of a mixed batch, each once', async () => {
    const { tx, told, notices } = recorded();
    await recordEnrollmentEvents(
      tx,
      [
        {
          kind: 'cancelled',
          enrollmentId: id(1),
          cancellationReason: 'payment_failed',
          occurredAt: AT,
        },
        {
          kind: 'cancelled',
          enrollmentId: id(2),
          cancellationReason: 'payment_expired',
          occurredAt: AT,
        },
      ],
      notices,
    );
    expect(told).toEqual([
      { userId: id(102), type: 'payment_expired', payload: { enrollmentId: id(2) } },
    ]);
  });

  it('refuses a payment outcome with no port before writing anything', async () => {
    const { tx, trace } = recorded();
    await expect(recordEnrollmentEvents(tx, [confirmed(1)])).rejects.toThrow(/notice port/);
    expect(trace).toEqual([]);
  });

  it('writes an outcome that pushes nothing with no port, as before', async () => {
    const { tx, trace } = recorded();
    await recordEnrollmentEvents(tx, [
      {
        kind: 'cancelled',
        enrollmentId: id(1),
        cancellationReason: 'teacher_suspended',
        occurredAt: AT,
      },
    ]);
    expect(trace).toEqual(['events cancelled']);
  });

  it('writes nothing and asks nothing for no outcome', async () => {
    const { tx, trace, notices } = recorded();
    await recordEnrollmentEvents(tx, [], notices);
    expect(trace).toEqual([]);
  });
});
