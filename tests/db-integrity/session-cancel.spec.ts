// T023 of specs/004-sessions/tasks.md — an administrator's `sessions.cancel` over the real tables
// as the application role (FR-460, FR-485, FR-495; SC-413; contracts/kernel.md, the row «an
// administrator's `sessions.cancel`»).
//
// A `scheduled` session becomes `cancelled_by_admin`; its enrollment's `admin_cancellation`
// compensation case is opened (no session, no raiser, no amount), and one `session_events` row
// `cancelled_by_admin` names it in `case_id`; a second cancellation on the same enrollment while
// that case is open joins it. A `disputed` session is refused `SESSION_NOT_SCHEDULED` (the owner's
// decision of 2026-11-10), and a session that does not exist `NOT_FOUND`, each writing nothing.
//
// The parents are written and committed by the harness, each probe with its own users, so no
// session of another run overlaps one of this run's; each cancellation runs in a transaction this
// file rolls back, so no status, case or event row it writes is kept.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import { createSessionCancel } from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
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
const AT = new Date('2026-10-10T08:00:00Z');

let db: Db;
let database: Database;

const settings: SettingsReader = {
  read: async () => {
    throw new Error('sessions.cancel reads no setting');
  },
};
const log = { info: () => undefined } as unknown as Parameters<
  typeof createSessionCancel
>[0]['log'];
const cancellation = createSessionCancel({
  enrollments: createEnrollmentSide({ settings, now: () => AT }),
  log,
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

/** A committed confirmed enrollment of a new student and teacher. */
async function confirmed(): Promise<{ id: string; studentId: string; teacherId: string }> {
  const offer = await makeOffer(db);
  const studentId = await makeUser(db);
  const id = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: CONFIRMED_AT,
  });
  return { id, studentId, teacherId: offer.teacherId };
}

/** A committed session `sequence` of the enrollment, a week apart, with `values`. */
function sessionOf(
  enrollment: Awaited<ReturnType<typeof confirmed>>,
  sequence: number,
  values: Readonly<Record<string, unknown>> = {},
): Promise<string> {
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
    status: 'scheduled',
    ...values,
  });
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown.code;
}

describe('sessions.cancel over the real tables (T023, FR-460, FR-485)', () => {
  it('cancels a scheduled session, opens one admin_cancellation case and writes one event naming it', async () => {
    const admin = await makeAdmin(db);
    const enrollment = await confirmed();
    const session = await sessionOf(enrollment, 1);
    await rolledBack(async (tx) => {
      const answer = await cancellation.cancel(tx, admin, { sessionId: session, reason: 'سبب' });
      expect(answer.status).toBe('cancelled_by_admin');
      const row = await tx.session.findUniqueOrThrow({ where: { id: session } });
      expect(row.status).toBe('cancelled_by_admin');
      const cases = await tx.dispute.findMany({ where: { enrollmentId: enrollment.id } });
      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({
        id: answer.caseId,
        kind: 'compensation_case',
        reason: 'admin_cancellation',
        status: 'open',
        sessionId: null,
        raisedByUserId: null,
      });
      const events = await tx.sessionEvent.findMany({ where: { enrollmentId: enrollment.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        sessionId: session,
        kind: 'cancelled_by_admin',
        caseId: answer.caseId,
      });
    });
  });

  it("joins the enrollment's open case on a second cancellation, each event naming it", async () => {
    const admin = await makeAdmin(db);
    const enrollment = await confirmed();
    const first = await sessionOf(enrollment, 1);
    const second = await sessionOf(enrollment, 2);
    await rolledBack(async (tx) => {
      const one = await cancellation.cancel(tx, admin, { sessionId: first, reason: 'سبب' });
      const two = await cancellation.cancel(tx, admin, { sessionId: second, reason: 'سبب' });
      expect(two.caseId).toBe(one.caseId);
      expect(await tx.dispute.count({ where: { enrollmentId: enrollment.id } })).toBe(1);
      const events = await tx.sessionEvent.findMany({
        where: { enrollmentId: enrollment.id },
        orderBy: { id: 'asc' },
      });
      expect(events.map(({ sessionId, caseId }) => [sessionId, caseId])).toEqual([
        [first, one.caseId],
        [second, one.caseId],
      ]);
    });
  });

  it('refuses a disputed session SESSION_NOT_SCHEDULED, writing nothing', async () => {
    const admin = await makeAdmin(db);
    const enrollment = await confirmed();
    const session = await sessionOf(enrollment, 1, {
      status: 'disputed',
      outcome_under_dispute: 'done',
    });
    await rolledBack(async (tx) => {
      expect(
        await codeOf(cancellation.cancel(tx, admin, { sessionId: session, reason: 'سبب' })),
      ).toBe('SESSION_NOT_SCHEDULED');
    });
    await rolledBack(async (tx) => {
      expect((await tx.session.findUniqueOrThrow({ where: { id: session } })).status).toBe(
        'disputed',
      );
      expect(await tx.dispute.count({ where: { enrollmentId: enrollment.id } })).toBe(0);
      expect(await tx.sessionEvent.count({ where: { enrollmentId: enrollment.id } })).toBe(0);
    });
  });

  it('refuses a session that does not exist NOT_FOUND', async () => {
    const admin = await makeAdmin(db);
    await rolledBack(async (tx) => {
      expect(
        await codeOf(
          cancellation.cancel(tx, admin, {
            sessionId: '0199d0a0-0000-7000-8000-00000000ffff',
            reason: 'سبب',
          }),
        ),
      ).toBe('NOT_FOUND');
    });
  });
});
