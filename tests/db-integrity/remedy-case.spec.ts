// T030 of specs/004-sessions/tasks.md — the refund hand-off over the real tables as the application
// role (FR-463, FR-465, FR-467; SC-410; ADR 0018 D4; R-MONEY-6; contracts/kernel.md, the row
// «`sessions.remedy.choose` … and a counter left unanswered handed to a `counter_unanswered` case»).
//
// A remedy handed over becomes `refund_case` with its enrollment's case of the reason, opened through
// moderation's `openCompensationCase` (a `compensation_case` with no session, no raiser and no
// amount: the `disputes` row has no amount column, and nothing here computes a share of a price),
// `decided_at` set, the `counter_*` columns cleared, and one `session_events` row
// `remedy_handed_to_case`. Two refunds on one enrollment join one case (the task's two specs: one
// case per refund, two refunds joining one); each reason is a case of its own. `kind` is `refund`
// for `refund_choice` and `counter_unanswered` and stays `makeup` for `makeup_refused` (Q6 (a)). A
// `frozen` remedy is refused `REMEDY_NOT_OPEN`, writing nothing.
//
// The parents are written and committed by the harness, each probe with its own users, so no row of
// another run is read; each hand-off runs in a transaction this file rolls back, so no status, case
// or event row it writes is kept.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRemedyCase } from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { Logger } from '../../apps/api/src/platform/logging/logger.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const CONFIRMED_AT = new Date('2026-10-04T07:01:00Z');

let db: Db;
let database: Database;

const remedyCase = createRemedyCase({
  log: { info: () => undefined } as unknown as Pick<Logger, 'info'>,
});

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

/** A committed confirmed enrollment of a new student and teacher, with the teacher's slot. */
async function confirmed(): Promise<{
  id: string;
  studentId: string;
  teacherId: string;
  slotId: string;
}> {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db);
  const id = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: CONFIRMED_AT,
  });
  return { id, studentId, teacherId: offer.teacherId, slotId: offer.slotId };
}

type Enrollment = Awaited<ReturnType<typeof confirmed>>;

/** A committed Teacher-No-Show session `sequence` of the enrollment, a week apart. */
function sessionOf(enrollment: Enrollment, sequence: number): Promise<string> {
  const day = 11 + 7 * (sequence - 1);
  return insertRow(db, 'sessions', {
    enrollment_id: enrollment.id,
    teacher_user_id: enrollment.teacherId,
    student_user_id: enrollment.studentId,
    sequence_number: sequence,
    scheduled_date_local: `2026-10-${String(day)}`,
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: `2026-10-${String(day)}T06:00:00Z`,
    scheduled_end_at: `2026-10-${String(day)}T07:00:00Z`,
    status: 'teacher_no_show',
  });
}

/** A committed remedy of the session in `status` (kind `makeup`), with `values`. */
function remedyOf(
  sessionId: string,
  status: string,
  values: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  return insertRow(db, 'session_remedies', {
    session_id: sessionId,
    kind: 'makeup',
    status,
    offered_at: '2026-10-20T08:00:00Z',
    choice_closes_at: '2026-10-27T08:00:00Z',
    snapshot_answer_window_hours: 72,
    snapshot_first_session_lead_hours: 24,
    proposed_date: '2026-11-15',
    ...values,
  });
}

/** A pending counter-proposal's five columns, on the teacher's slot (rule 42). */
function counterOn(slotId: string): Record<string, unknown> {
  return {
    counter_slot_id: slotId,
    counter_date: '2026-11-08',
    counter_start_time_local: '09:00:00',
    counter_timezone: 'Africa/Cairo',
    counter_proposed_at: '2026-10-22T08:00:00Z',
  };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown.code;
}

describe('the refund hand-off over the real tables (T030, FR-467, SC-410)', () => {
  it('hands a refund choice to one refund_choice case with no amount, one event, decided_at set', async () => {
    const enrollment = await confirmed();
    const session = await sessionOf(enrollment, 1);
    const remedy = await remedyOf(session, 'awaiting_choice');
    await rolledBack(async (tx) => {
      const handed = await remedyCase.handOff(tx, { remedyId: remedy, reason: 'refund_choice' });
      expect(handed).toMatchObject({
        remedyId: remedy,
        sessionId: session,
        enrollmentId: enrollment.id,
        caseOpened: true,
        reason: 'refund_choice',
        kind: 'refund',
      });
      const row = await tx.sessionRemedy.findUniqueOrThrow({ where: { id: remedy } });
      expect(row).toMatchObject({ status: 'refund_case', kind: 'refund', caseId: handed.caseId });
      expect(row.decidedAt).toBeInstanceOf(Date);
      const cases = await tx.dispute.findMany({ where: { enrollmentId: enrollment.id } });
      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({
        id: handed.caseId,
        kind: 'compensation_case',
        reason: 'refund_choice',
        status: 'open',
        sessionId: null,
        raisedByUserId: null,
      });
      const events = await tx.sessionEvent.findMany({ where: { enrollmentId: enrollment.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        sessionId: session,
        kind: 'remedy_handed_to_case',
        caseId: null,
      });
    });
  });

  it("joins a second refund on the enrollment to the first one's open case", async () => {
    const enrollment = await confirmed();
    const first = await sessionOf(enrollment, 1);
    const second = await sessionOf(enrollment, 2);
    const one = await remedyOf(first, 'awaiting_choice');
    const two = await remedyOf(second, 'awaiting_choice');
    await rolledBack(async (tx) => {
      const a = await remedyCase.handOff(tx, { remedyId: one, reason: 'refund_choice' });
      const b = await remedyCase.handOff(tx, { remedyId: two, reason: 'refund_choice' });
      expect(a.caseOpened).toBe(true);
      expect(b).toMatchObject({ caseId: a.caseId, caseOpened: false });
      expect(await tx.dispute.count({ where: { enrollmentId: enrollment.id } })).toBe(1);
      const remedies = await tx.sessionRemedy.findMany({
        where: { id: { in: [one, two] } },
        orderBy: { id: 'asc' },
      });
      expect(remedies.map(({ status, caseId }) => [status, caseId])).toEqual([
        ['refund_case', a.caseId],
        ['refund_case', a.caseId],
      ]);
      expect(
        await tx.sessionEvent.count({
          where: { enrollmentId: enrollment.id, kind: 'remedy_handed_to_case' },
        }),
      ).toBe(2);
    });
  });

  it('hands an unanswered counter to its own counter_unanswered case, kind refund, the counter cleared', async () => {
    const enrollment = await confirmed();
    const first = await sessionOf(enrollment, 1);
    const second = await sessionOf(enrollment, 2);
    const chosen = await remedyOf(first, 'awaiting_choice');
    const countered = await remedyOf(second, 'counter_proposed', counterOn(enrollment.slotId));
    await rolledBack(async (tx) => {
      const refund = await remedyCase.handOff(tx, { remedyId: chosen, reason: 'refund_choice' });
      const unanswered = await remedyCase.handOff(tx, {
        remedyId: countered,
        reason: 'counter_unanswered',
      });
      expect(unanswered.caseId).not.toBe(refund.caseId);
      expect(unanswered).toMatchObject({ caseOpened: true, kind: 'refund' });
      const row = await tx.sessionRemedy.findUniqueOrThrow({ where: { id: countered } });
      expect(row).toMatchObject({
        status: 'refund_case',
        kind: 'refund',
        caseId: unanswered.caseId,
        counterSlotId: null,
        counterDate: null,
        counterStartTimeLocal: null,
        counterTimezone: null,
        counterProposedAt: null,
      });
      expect(
        (await tx.dispute.findUniqueOrThrow({ where: { id: unanswered.caseId } })).reason,
      ).toBe('counter_unanswered');
    });
  });

  it('hands a refused make-up to a makeup_refused case, its kind left makeup', async () => {
    const enrollment = await confirmed();
    const session = await sessionOf(enrollment, 1);
    const remedy = await remedyOf(session, 'proposed');
    await rolledBack(async (tx) => {
      const handed = await remedyCase.handOff(tx, { remedyId: remedy, reason: 'makeup_refused' });
      expect(handed).toMatchObject({ caseOpened: true, kind: 'makeup' });
      const row = await tx.sessionRemedy.findUniqueOrThrow({ where: { id: remedy } });
      expect(row).toMatchObject({ status: 'refund_case', kind: 'makeup', caseId: handed.caseId });
      expect((await tx.dispute.findUniqueOrThrow({ where: { id: handed.caseId } })).reason).toBe(
        'makeup_refused',
      );
    });
  });

  it('refuses a frozen remedy REMEDY_NOT_OPEN, writing nothing', async () => {
    const enrollment = await confirmed();
    const session = await sessionOf(enrollment, 1);
    const remedy = await remedyOf(session, 'frozen');
    await rolledBack(async (tx) => {
      expect(
        await codeOf(remedyCase.handOff(tx, { remedyId: remedy, reason: 'refund_choice' })),
      ).toBe('REMEDY_NOT_OPEN');
    });
    await rolledBack(async (tx) => {
      expect((await tx.sessionRemedy.findUniqueOrThrow({ where: { id: remedy } })).status).toBe(
        'frozen',
      );
      expect(await tx.dispute.count({ where: { enrollmentId: enrollment.id } })).toBe(0);
      expect(await tx.sessionEvent.count({ where: { enrollmentId: enrollment.id } })).toBe(0);
    });
  });
});
