// T064 of specs/004-sessions/tasks.md — the manual compensation case over the real tables as the
// application role (FR-471 (c), FR-493; SRS FR-ADMIN-20 (c); research R-326; contracts/kernel.md,
// the two manual-case rows; the notes under T064).
//
// - Phase 2's covering rule reads none of the manual reasons (R-326; T004's narrowing): with an
//   `admin_opened_for_student` or `admin_opened_for_teacher` case open, and again closed, on an
//   enrollment, `caseInstantsAmong` and `caseInstantsOf` answer nothing for it, while a Phase 2
//   reason beside it is read.
// - `cases.openManual` with no remedy, on an enrollment in each state, for each party: one
//   `compensation_case` with the party's reason, no session, no raiser and no amount (the
//   `disputes` row has no amount column); a second opening for the same party joins it, writing no
//   row; an enrollment that does not exist is refused `NOT_FOUND`, writing nothing.
// - With `remedyId`, from each of the four open statuses: the remedy `refund_case` with the
//   student's manual case, `decided_at` set, its `kind` left `makeup`, the counter's five columns
//   cleared, no time reserved for it any more (`reservedTimesOf`, H3: both the proposal's and a
//   pending counter's), and one `session_events` row `remedy_handed_to_case`; a remedy of another
//   enrollment `NOT_FOUND` and a `lapsed` one `REMEDY_NOT_OPEN`, each writing nothing.
// - Keyed on the call's transaction (`runOn`): a repeated key answers the first result and writes
//   nothing.
//
// The parents are written and committed by the harness, each probe with its own users; each call
// runs in a transaction this file rolls back, so no case, key, status or event row it writes is
// kept. `EnrollmentSide` is booking's real one, so `enrollmentFor`'s two parties are read here too
// (the note under T064, B34).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  caseInstantsAmong,
  caseInstantsOf,
  closeCase,
  openCompensationCase,
} from '../../apps/api/src/modules/moderation/index.js';
import {
  createManualCase,
  type EnrollmentStatus,
  reservedTimesOf,
} from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeAdmin,
  makeOffer,
  makeUser,
} from './harness';

const CONFIRMED_AT = new Date('2026-10-04T07:01:00Z');
const OPTIONS = { maxWait: 5_000, timeout: 30_000 };
const WIDE = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2028-01-01T00:00:00Z') };

let db: Db;
let database: Database;

/** Every number a read here asks for; the key's retention among them. */
const settings: SettingsReader = { read: async (_key, schema) => schema.parse(24) };
const enrollments = createEnrollmentSide({ settings });
const quiet = { info: () => undefined };

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

function manualCase() {
  return createManualCase({
    enrollments,
    idempotency: new IdempotencyService({ store: new IdempotencyRepository(database), settings }),
    log: quiet,
  });
}

const ROLLED_BACK = Symbol('rolled back');

async function rolledBack(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(async (tx) => {
      await probe(tx);
      throw ROLLED_BACK;
    }, OPTIONS);
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
}

/** A committed enrollment of a new student and teacher in `status`, with the teacher's slot. */
async function enrollmentIn(status: EnrollmentStatus = 'confirmed'): Promise<{
  id: string;
  studentId: string;
  teacherId: string;
  slotId: string;
}> {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db);
  const id = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status,
    ...(status === 'pending_payment' ? {} : { confirmed_at: CONFIRMED_AT }),
    ...(status === 'cancelled' ? { cancellation_reason: 'admin' } : {}),
  });
  return { id, studentId, teacherId: offer.teacherId, slotId: offer.slotId };
}

type Enrollment = Awaited<ReturnType<typeof enrollmentIn>>;

/** A committed Teacher-No-Show session of the enrollment. */
function sessionOf(enrollment: Enrollment): Promise<string> {
  return insertRow(db, 'sessions', {
    enrollment_id: enrollment.id,
    teacher_user_id: enrollment.teacherId,
    student_user_id: enrollment.studentId,
    sequence_number: 1,
    scheduled_date_local: '2026-10-11',
    scheduled_start_time_local: '09:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: '2026-10-11T06:00:00Z',
    scheduled_end_at: '2026-10-11T07:00:00Z',
    status: 'teacher_no_show',
  });
}

/**
 * A committed `makeup` remedy of the session in `status`, proposing a date far ahead; a
 * `counter_proposed` one with its five columns on the teacher's slot, proposed now, so its answer
 * window is open and its time reserved.
 */
function remedyOf(sessionId: string, status: string, slotId: string): Promise<string> {
  return insertRow(db, 'session_remedies', {
    session_id: sessionId,
    kind: 'makeup',
    status,
    offered_at: '2026-10-20T08:00:00Z',
    choice_closes_at: '2027-10-27T08:00:00Z',
    snapshot_answer_window_hours: 72,
    snapshot_first_session_lead_hours: 24,
    proposed_date: '2027-06-13',
    ...(status === 'counter_proposed'
      ? {
          counter_slot_id: slotId,
          counter_date: '2027-06-20',
          counter_start_time_local: '09:00:00',
          counter_timezone: 'Africa/Cairo',
          counter_proposed_at: new Date(),
        }
      : {}),
  });
}

function asked(enrollmentId: string, party: 'student' | 'teacher', remedyId?: string) {
  return {
    enrollmentId,
    party,
    reason: 'شكوى عبر الهاتف',
    idempotencyKey: `manual-${randomUUID()}`,
    ...(remedyId === undefined ? {} : { remedyId }),
  };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw thrown;
  return thrown.code;
}

describe('Phase 2’s covering rule reads none of the manual reasons (R-326, FR-493)', () => {
  it.each(['admin_opened_for_student', 'admin_opened_for_teacher'] as const)(
    'a %s case, open and then closed, is not read; a Phase 2 reason beside it is',
    async (reason) => {
      const adminId = await makeAdmin(db);
      const manual = await enrollmentIn('pending_payment');
      const covered = await enrollmentIn('pending_payment');
      const { caseId } = await database.$transaction(
        (tx) => openCompensationCase(tx, manual.id, reason),
        OPTIONS,
      );
      await database.$transaction(
        (tx) => openCompensationCase(tx, covered.id, 'party_restricted'),
        OPTIONS,
      );
      await database.$transaction(async (tx) => {
        const among = await caseInstantsAmong(tx, [manual.id, covered.id]);
        expect([...among.keys()]).toEqual([covered.id]);
        expect(await caseInstantsOf(tx, manual.id)).toBeNull();
      }, OPTIONS);
      await database.$transaction(
        (tx) =>
          closeCase(tx, caseId, { status: 'dismissed', resolution: null, note: 'n', adminId }),
        OPTIONS,
      );
      await database.$transaction(async (tx) => {
        expect(await caseInstantsOf(tx, manual.id)).toBeNull();
        expect((await caseInstantsAmong(tx, [manual.id])).size).toBe(0);
      }, OPTIONS);
    },
  );
});

describe('cases.openManual with no remedy over the real tables (T064)', () => {
  const STATES: readonly EnrollmentStatus[] = [
    'pending_payment',
    'confirmed',
    'completed',
    'terminated_no_show',
    'cancelled',
  ];

  it.each(STATES)('opens each party’s case on a %s enrollment, then joins it', async (state) => {
    const adminId = await makeAdmin(db);
    const enrollment = await enrollmentIn(state);
    await rolledBack(async (tx) => {
      const service = manualCase();
      const student = await service.openManual(tx, adminId, asked(enrollment.id, 'student'));
      const teacher = await service.openManual(tx, adminId, asked(enrollment.id, 'teacher'));
      const again = await service.openManual(tx, adminId, asked(enrollment.id, 'student'));
      expect(student.answer).toMatchObject({ party: 'student', status: 'open', joined: false });
      expect(teacher.answer).toMatchObject({ party: 'teacher', status: 'open', joined: false });
      expect(again.answer).toMatchObject({ caseId: student.answer.caseId, joined: true });
      const cases = await tx.dispute.findMany({
        where: { enrollmentId: enrollment.id },
        orderBy: { id: 'asc' },
      });
      expect(
        cases.map(({ id, kind, reason, status, sessionId, raisedByUserId }) => ({
          id,
          kind,
          reason,
          status,
          sessionId,
          raisedByUserId,
        })),
      ).toEqual([
        {
          id: student.answer.caseId,
          kind: 'compensation_case',
          reason: 'admin_opened_for_student',
          status: 'open',
          sessionId: null,
          raisedByUserId: null,
        },
        {
          id: teacher.answer.caseId,
          kind: 'compensation_case',
          reason: 'admin_opened_for_teacher',
          status: 'open',
          sessionId: null,
          raisedByUserId: null,
        },
      ]);
    });
  });

  it('refuses an enrollment that does not exist NOT_FOUND, writing nothing', async () => {
    const adminId = await makeAdmin(db);
    const missing = randomUUID();
    await rolledBack(async (tx) => {
      expect(await codeOf(manualCase().openManual(tx, adminId, asked(missing, 'teacher')))).toBe(
        'NOT_FOUND',
      );
      expect(await tx.dispute.count({ where: { enrollmentId: missing } })).toBe(0);
    });
  });

  it('answers a repeated key the first result, replayed, writing no second row', async () => {
    const adminId = await makeAdmin(db);
    const enrollment = await enrollmentIn('confirmed');
    await rolledBack(async (tx) => {
      const service = manualCase();
      const call = asked(enrollment.id, 'teacher');
      const first = await service.openManual(tx, adminId, call);
      const again = await service.openManual(tx, adminId, call);
      expect(again).toEqual({ answer: first.answer, replayed: true });
      expect(await tx.dispute.count({ where: { enrollmentId: enrollment.id } })).toBe(1);
    });
  });

  it('reads the enrollment’s two parties through EnrollmentSide (the note under T064, B34)', async () => {
    const enrollment = await enrollmentIn('confirmed');
    await rolledBack(async (tx) => {
      expect(await enrollments.enrollmentFor(tx, enrollment.id)).toMatchObject({
        id: enrollment.id,
        studentUserId: enrollment.studentId,
        teacherUserId: enrollment.teacherId,
      });
    });
  });
});

describe('cases.openManual with remedyId over the real tables (T064, GAP-5)', () => {
  it.each(['awaiting_choice', 'proposed', 'counter_proposed', 'frozen'])(
    'hands a %s remedy to the student’s manual case: refund_case, kind makeup, both times released, one event',
    async (status) => {
      const adminId = await makeAdmin(db);
      const enrollment = await enrollmentIn('confirmed');
      const session = await sessionOf(enrollment);
      const remedy = await remedyOf(session, status, enrollment.slotId);
      const people = [enrollment.studentId, enrollment.teacherId];
      await rolledBack(async (tx) => {
        const reservedBefore = (await reservedTimesOf(tx, people, WIDE, enrollments)).filter(
          ({ remedyId }) => remedyId === remedy,
        );
        // A frozen remedy reserves nothing; a counter-proposal reserves its proposal and its counter.
        expect(reservedBefore).toHaveLength(
          status === 'frozen' ? 0 : status === 'counter_proposed' ? 2 : 1,
        );
        const { answer } = await manualCase().openManual(
          tx,
          adminId,
          asked(enrollment.id, 'student', remedy),
        );
        expect(answer).toMatchObject({
          enrollmentId: enrollment.id,
          party: 'student',
          joined: false,
          handedRemedy: { remedyId: remedy, sessionId: session },
        });
        const row = await tx.sessionRemedy.findUniqueOrThrow({ where: { id: remedy } });
        expect(row).toMatchObject({
          status: 'refund_case',
          kind: 'makeup',
          caseId: answer.caseId,
          counterSlotId: null,
          counterDate: null,
          counterStartTimeLocal: null,
          counterTimezone: null,
          counterProposedAt: null,
        });
        expect(row.decidedAt).toBeInstanceOf(Date);
        expect(
          (await reservedTimesOf(tx, people, WIDE, enrollments)).filter(
            ({ remedyId }) => remedyId === remedy,
          ),
        ).toEqual([]);
        expect(await tx.dispute.findUniqueOrThrow({ where: { id: answer.caseId } })).toMatchObject({
          kind: 'compensation_case',
          reason: 'admin_opened_for_student',
          status: 'open',
        });
        const events = await tx.sessionEvent.findMany({ where: { enrollmentId: enrollment.id } });
        expect(events.map(({ sessionId, kind }) => [sessionId, kind])).toEqual([
          [session, 'remedy_handed_to_case'],
        ]);
      });
    },
  );

  it('refuses a remedy of another enrollment NOT_FOUND and a lapsed one REMEDY_NOT_OPEN, writing nothing', async () => {
    const adminId = await makeAdmin(db);
    const enrollment = await enrollmentIn('confirmed');
    const other = await enrollmentIn('confirmed');
    const otherRemedy = await remedyOf(await sessionOf(other), 'awaiting_choice', other.slotId);
    const lapsed = await remedyOf(await sessionOf(enrollment), 'lapsed', enrollment.slotId);
    await rolledBack(async (tx) => {
      expect(
        await codeOf(
          manualCase().openManual(tx, adminId, asked(enrollment.id, 'student', otherRemedy)),
        ),
      ).toBe('NOT_FOUND');
    });
    await rolledBack(async (tx) => {
      expect(
        await codeOf(manualCase().openManual(tx, adminId, asked(enrollment.id, 'student', lapsed))),
      ).toBe('REMEDY_NOT_OPEN');
    });
    await rolledBack(async (tx) => {
      expect(
        await tx.dispute.count({ where: { enrollmentId: { in: [enrollment.id, other.id] } } }),
      ).toBe(0);
      expect(
        (await tx.sessionRemedy.findMany({ where: { id: { in: [otherRemedy, lapsed] } } }))
          .map(({ status }) => status)
          .sort(),
      ).toEqual(['awaiting_choice', 'lapsed']);
      expect(
        await tx.sessionEvent.count({ where: { enrollmentId: { in: [enrollment.id, other.id] } } }),
      ).toBe(0);
    });
  });
});
