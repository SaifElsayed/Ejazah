// T035 of specs/004-sessions/tasks.md — the compensation-case queue over the real tables as the
// application role (FR-478, FR-451, FR-452; research R-312, R-313; contracts/admin-surface.md,
// `cases.list` and `cases.get`).
//
// - The queue's order (moderation's `caseQueuePage`, through `createCaseQueue`): the open
//   `student_suspended` cases first, then the rest by their opening, a complaint among them and a
//   session dispute never; the status filter; the cursor's two parts. The table keeps every earlier
//   run's committed rows, so each probe starts its part after a marker case of its own: the rows
//   after it are this probe's, ids being time-ordered (uuidv7).
// - Each part of `covers`, the reads of `case-covers.repository.ts` and moderation's
//   `suspensionCasesOf`: the remedies the case holds; the sessions whose `cancelled_by_admin` event
//   names it; for an enrollment's end, a session owed a remedy never offered (a Teacher-No-Show, a
//   Both-No-Show and a never-offered Cancelled-By-Agreement session, the third analysis's I1) and
//   none owed or offered; for a confirmed fault, a make-up the dismissed suspension case cancelled
//   (U1) and not the ordinary session it cancelled; for the first end, the sessions a suspension
//   case open at the end, resolved after it, cancelled (U2), and none of one resolved before.
//
// The rows are written and committed by the harness, each probe with its own enrollment.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addDays, addMinutes } from '../../packages/time/src/index.js';
import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import { createCaseQueue } from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
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
const AT = new Date('2026-11-10T08:00:00Z');
const SETTINGS: Readonly<Record<string, number>> = {
  admin_list_page_size: 50,
  repeated_absence_flag_count: 5,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const log = { info: () => undefined };
const queue = createCaseQueue({
  enrollments: createEnrollmentSide({ settings, now: () => AT }),
  settings,
  log,
});

let db: Db;
let database: Database;
let admin: string;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  admin = await makeAdmin(db);
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

interface Enrollment {
  readonly id: string;
  readonly studentId: string;
  readonly teacherId: string;
}

/** A committed confirmed enrollment of a new student and teacher. */
async function confirmed(): Promise<Enrollment> {
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
  enrollment: Enrollment,
  sequence: number,
  values: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  const start = new Date(addDays(new Date('2026-10-04T06:00:00Z'), 7 * sequence));
  const end = new Date(addMinutes(start, 60));
  return insertRow(db, 'sessions', {
    enrollment_id: enrollment.id,
    teacher_user_id: enrollment.teacherId,
    student_user_id: enrollment.studentId,
    sequence_number: sequence,
    scheduled_date_local: start.toISOString().slice(0, 10),
    scheduled_start_time_local: '08:00:00',
    timezone: 'Africa/Cairo',
    scheduled_start_at: start,
    scheduled_end_at: end,
    status: 'scheduled',
    ...values,
  });
}

/** A committed case of the enrollment; closed ones carry their closing (rule 46). */
function caseOf(
  enrollmentId: string,
  values: {
    readonly kind?: 'compensation_case' | 'absence_complaint' | 'session_dispute';
    readonly reason: string;
    readonly status?: 'open' | 'resolved' | 'dismissed';
    readonly createdAt?: Date;
    readonly resolvedAt?: Date;
    readonly sessionId?: string;
    readonly raisedBy?: string;
  },
): Promise<string> {
  const status = values.status ?? 'open';
  return insertRow(db, 'disputes', {
    enrollment_id: enrollmentId,
    kind: values.kind ?? 'compensation_case',
    reason: values.reason,
    status,
    ...(values.sessionId === undefined ? {} : { session_id: values.sessionId }),
    ...(values.raisedBy === undefined ? {} : { raised_by_user_id: values.raisedBy }),
    ...(values.createdAt === undefined ? {} : { created_at: values.createdAt }),
    ...(status === 'open'
      ? {}
      : {
          resolution: status === 'resolved' ? 'compensation_ordered' : null,
          resolution_notes: 'Probe',
          resolved_by_admin_id: admin,
          resolved_at: values.resolvedAt ?? new Date(),
        }),
  });
}

/** A `cancelled_by_admin` event of the session naming the case (C4). */
function cancelledEvent(enrollmentId: string, sessionId: string, caseId: string): Promise<string> {
  return insertRow(db, 'session_events', {
    enrollment_id: enrollmentId,
    session_id: sessionId,
    kind: 'cancelled_by_admin',
    case_id: caseId,
    occurred_at: '2026-10-20T08:00:00Z',
  });
}

/** A remedy of the session; a `refund_case` one held by `caseId`. */
function remedyOf(
  sessionId: string,
  status: string,
  caseId?: string,
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
    ...(caseId === undefined ? {} : { case_id: caseId, decided_at: '2026-10-21T08:00:00Z' }),
  });
}

function getCase(caseId: string) {
  return database.$transaction((tx) => queue.get(tx, admin, { caseId }));
}

function listCases(input: Parameters<typeof queue.list>[2]) {
  return database.$transaction((tx) => queue.list(tx, admin, input));
}

describe('cases.list: the queue’s order (FR-478; the owner’s decision of 2026-11-05)', () => {
  it('lists the open student_suspended cases first, then the rest by their opening, never a session dispute', async () => {
    const enrollment = await confirmed();
    const marker = await caseOf(enrollment.id, { reason: 'party_restricted' });
    const refund = await caseOf(enrollment.id, { reason: 'refund_choice' });
    const suspendedOne = await caseOf(enrollment.id, { reason: 'student_suspended' });
    const complaint = await caseOf(enrollment.id, {
      kind: 'absence_complaint',
      reason: 'المعلم لم يحضر',
      raisedBy: enrollment.studentId,
    });
    const session = await sessionOf(enrollment, 1, { status: 'done' });
    await caseOf(enrollment.id, {
      kind: 'session_dispute',
      reason: 'نزاع',
      sessionId: session,
      raisedBy: enrollment.studentId,
    });
    const closedSuspended = await caseOf(enrollment.id, {
      reason: 'student_suspended',
      status: 'resolved',
    });
    const suspendedTwo = await caseOf(enrollment.id, { reason: 'student_suspended' });

    // The first part, after the marker, then the rest from its start.
    const first = await listCases({ cursor: `first:${marker}` });
    expect(first.items.slice(0, 2).map(({ caseId }) => caseId)).toEqual([
      suspendedOne,
      suspendedTwo,
    ]);
    expect(first.items[2]).not.toMatchObject({ reason: 'student_suspended', status: 'open' });

    // The rest part, after the marker: this probe's rows in their opening order.
    const rest = await listCases({ cursor: `rest:${marker}` });
    expect(rest.items.map(({ caseId }) => caseId)).toEqual([refund, complaint, closedSuspended]);
    expect(rest.items[1]).toMatchObject({ kind: 'absence_complaint', status: 'open' });
    expect(rest.items[1]).not.toHaveProperty('reason');
    expect(rest.items[2]).toMatchObject({ reason: 'student_suspended', status: 'resolved' });
    expect(rest.items[2]?.closedAt).toBeDefined();

    // The status filter reads the rest only, for a closed status.
    const resolved = await listCases({ status: 'resolved', cursor: `rest:${marker}` });
    expect(resolved.items.map(({ caseId }) => caseId)).toEqual([closedSuspended]);
    const open = await listCases({ status: 'open', cursor: `rest:${marker}` });
    expect(open.items.map(({ caseId }) => caseId)).toEqual([refund, complaint]);
  });

  it('pages: the next cursor names the last row’s part, and the next page goes on after it', async () => {
    const enrollment = await confirmed();
    const marker = await caseOf(enrollment.id, { reason: 'party_restricted' });
    const ids: string[] = [];
    for (let n = 0; n < 3; n += 1) ids.push(await caseOf(enrollment.id, { reason: 'makeup_refused', status: 'dismissed' }));
    const small = createCaseQueue({
      enrollments: createEnrollmentSide({ settings, now: () => AT }),
      settings: {
        read: async (key, schema) => schema.parse({ ...SETTINGS, admin_list_page_size: 2 }[key]),
      },
      log,
    });
    const one = await database.$transaction((tx) =>
      small.list(tx, admin, { status: 'dismissed', cursor: `rest:${marker}` }),
    );
    expect(one.items.map(({ caseId }) => caseId)).toEqual(ids.slice(0, 2));
    expect(one.nextCursor).toBe(`rest:${String(ids[1])}`);
    const two = await database.$transaction((tx) =>
      small.list(tx, admin, { status: 'dismissed', cursor: one.nextCursor }),
    );
    expect(two.items.map(({ caseId }) => caseId)).toEqual(ids.slice(2));
    expect(two.nextCursor).toBeUndefined();
  });
});

describe('cases.get: each part of covers (R-312, R-313; C1, I1, U1, U2)', () => {
  it('the remedies the case holds and the sessions whose cancelled_by_admin event names it', async () => {
    const enrollment = await confirmed();
    const caseId = await caseOf(enrollment.id, { reason: 'admin_cancellation' });
    const cancelled = await sessionOf(enrollment, 1, { status: 'cancelled_by_admin' });
    await cancelledEvent(enrollment.id, cancelled, caseId);
    const refunded = await sessionOf(enrollment, 2, { status: 'teacher_no_show' });
    const remedy = await remedyOf(refunded, 'refund_case', caseId);
    await sessionOf(enrollment, 3, { status: 'done' });
    const answer = await getCase(caseId);
    expect(answer.covers).toEqual([
      { sessionId: cancelled, sequenceNumber: 1, status: 'cancelled_by_admin' },
      {
        sessionId: refunded,
        sequenceNumber: 2,
        status: 'teacher_no_show',
        remedy: { remedyId: remedy, kind: 'makeup', status: 'refund_case' },
      },
    ]);
    expect(answer.paymentsLink).toEqual({ enrollmentId: enrollment.id });
    expect(answer.enrollment).toMatchObject({ enrollmentId: enrollment.id, status: 'confirmed' });
  });

  it('an enrollment’s end covers every session owed a remedy never offered, a Cancelled-By-Agreement one included, and none offered or owed nothing', async () => {
    const enrollment = await confirmed();
    const caseId = await caseOf(enrollment.id, { reason: 'teacher_ended' });
    const noShow = await sessionOf(enrollment, 1, { status: 'teacher_no_show' });
    const both = await sessionOf(enrollment, 2, { status: 'both_no_show' });
    const agreed = await sessionOf(enrollment, 3, { status: 'cancelled_by_agreement' });
    const offered = await sessionOf(enrollment, 4, { status: 'teacher_no_show' });
    await remedyOf(offered, 'proposed');
    await sessionOf(enrollment, 5, { status: 'done' });
    await sessionOf(enrollment, 6, { status: 'student_no_show' });
    const answer = await getCase(caseId);
    expect(answer.covers.map(({ sessionId }) => sessionId)).toEqual([noShow, both, agreed]);
  });

  it('a confirmed fault covers each make-up the dismissed suspension case cancelled, not its ordinary sessions (U1)', async () => {
    const enrollment = await confirmed();
    const suspendedAt = new Date('2026-10-20T08:00:00Z');
    const faultAt = new Date('2026-11-01T08:00:00.000Z');
    const suspended = await caseOf(enrollment.id, {
      reason: 'student_suspended',
      status: 'dismissed',
      createdAt: suspendedAt,
      // The dismissal's clock_timestamp(), after its transaction's now(), the new case's opening.
      resolvedAt: new Date('2026-11-01T08:00:00.003Z'),
    });
    const fault = await caseOf(enrollment.id, {
      reason: 'student_fault_confirmed',
      createdAt: faultAt,
    });
    const ordinary = await sessionOf(enrollment, 1, { status: 'teacher_no_show' });
    const cancelledOrdinary = await sessionOf(enrollment, 2, { status: 'cancelled_by_admin' });
    await cancelledEvent(enrollment.id, cancelledOrdinary, suspended);
    const makeup = await sessionOf(enrollment, 5, {
      status: 'cancelled_by_admin',
      makeup_for_session_id: ordinary,
    });
    await cancelledEvent(enrollment.id, makeup, suspended);
    // The ordinary Teacher-No-Show is owed and never offered: covered too, by the end's rule (C1).
    const answer = await getCase(fault);
    expect(answer.covers.map(({ sessionId }) => sessionId)).toEqual([ordinary, makeup]);
    // The dismissed case itself covers the two its suspension cancelled, and no more.
    const dismissed = await getCase(suspended);
    expect(dismissed.covers.map(({ sessionId }) => sessionId)).toEqual([cancelledOrdinary, makeup]);
  });

  it('the first end’s case covers what a suspension case open at the end, resolved after it, cancelled (U2), and not one resolved before', async () => {
    const enrollment = await confirmed();
    const before = await caseOf(enrollment.id, {
      reason: 'student_suspended',
      status: 'resolved',
      createdAt: new Date('2026-10-05T08:00:00Z'),
      resolvedAt: new Date('2026-10-06T08:00:00Z'),
    });
    const earlier = await sessionOf(enrollment, 1, { status: 'cancelled_by_admin' });
    await cancelledEvent(enrollment.id, earlier, before);
    const during = await caseOf(enrollment.id, {
      reason: 'student_suspended',
      status: 'resolved',
      createdAt: new Date('2026-10-20T08:00:00Z'),
      resolvedAt: new Date('2026-11-05T08:00:00Z'),
    });
    const ban = await caseOf(enrollment.id, {
      reason: 'student_banned',
      createdAt: new Date('2026-11-01T08:00:00Z'),
    });
    const later = await sessionOf(enrollment, 3, { status: 'cancelled_by_admin' });
    await cancelledEvent(enrollment.id, later, during);
    const answer = await getCase(ban);
    expect(answer.covers.map(({ sessionId }) => sessionId)).toEqual([later]);
  });

  it('answers a complaint with its text and no reason, and refuses a session dispute NOT_FOUND', async () => {
    const enrollment = await confirmed();
    const complaint = await caseOf(enrollment.id, {
      kind: 'absence_complaint',
      reason: 'المعلم لم يحضر',
      raisedBy: enrollment.studentId,
    });
    const answer = await getCase(complaint);
    expect(answer.case).not.toHaveProperty('reason');
    expect(answer.complaint).toMatchObject({ reason: 'المعلم لم يحضر' });
    const session = await sessionOf(enrollment, 1, { status: 'done' });
    const dispute = await caseOf(enrollment.id, {
      kind: 'session_dispute',
      reason: 'نزاع',
      sessionId: session,
      raisedBy: enrollment.studentId,
    });
    await expect(getCase(dispute)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
