// T001 of specs/005-certification/tasks.md (B45) — the migration `20261117055600_certification_foundations`
// on this database (data-model.md; ERD changelog rows 47 to 49, §15 rules 53 to 57):
//   - `ijazah_requests` and its enum, one open request per enrollment (rule 53), a rejection's reason
//     and the decision's pair (rule 54);
//   - `ijazahs`' nine Phase 4 columns, the sign-off's pair never before the rendering (rule 55);
//   - `session_reminders`, once per (session, user, offset);
//   - `user_reports.enrollment_id`, its two checks and one open report per reporter, reported user
//     and context (rule 56); `gender_flags.reason` and `report_id`, one open flag per user (rule 57).
//
// As enrollment-admin-end-reason.spec.ts: each probe first writes the rows the rule admits, so a
// refusal is the rule and not a broken row, then each forbidden one, expecting its SQLSTATE; a
// catalogue case holds each constraint by name; every probe runs as the application role in a
// transaction that is rolled back.
//
// Observed red: every case against the database before the migration; each rule's case and the
// constraints' catalogue against the mutant migration M-T001 (the generated part alone, without the
// hand-written checks and partial uniques), applied and then dropped before the real one.
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
  makeAdmin,
  makeEnrollment,
  makeSession,
  makeUser,
  type Db,
} from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

/** `table`'s columns as `name type nullable`, in name order. */
async function columnsOf(table: string, names: readonly string[]): Promise<string[]> {
  const { rows } = await db.query<{ name: string; type: string; nullable: string }>(
    `SELECT column_name AS name, udt_name AS type, is_nullable AS nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::text[])
      ORDER BY column_name`,
    [table, names],
  );
  return rows.map(({ name, type, nullable }) => `${name} ${type} ${nullable}`);
}

/** The constraint `name` of `table` as `contype: definition`, or nothing. */
async function constraintOf(table: string, name: string): Promise<string[]> {
  const { rows } = await db.query<{ type: string }>(
    `SELECT contype AS type FROM pg_constraint
      WHERE conrelid = $1::regclass AND conname = $2`,
    [table, name],
  );
  return rows.map(({ type }) => type);
}

/** The unique index `name`'s definition, or nothing. */
async function uniqueIndexOf(name: string): Promise<string[]> {
  const { rows } = await db.query<{ definition: string }>(
    `SELECT pg_get_indexdef(i.indexrelid) AS definition
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = $1 AND i.indisunique`,
    [name],
  );
  return rows.map(({ definition }) => definition);
}

/** The values of one request of `enrollment`, `pending` unless `values` say otherwise. */
function requestValues(
  enrollment: Awaited<ReturnType<typeof makeEnrollment>>,
  subjectId: string,
  values: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    enrollment_id: enrollment.enrollmentId,
    teacher_user_id: enrollment.teacherId,
    student_user_id: enrollment.studentId,
    subject_id: subjectId,
    completion_date: '2026-11-01',
    status: 'pending',
    chain_snapshot: JSON.stringify([['الشيخ الأول'], ['المعلم']]),
    teacher_name_printed: 'اسم المعلم',
    // B46 (005:T006, Q5 (c)): the riwaya it prints, NOT NULL.
    riwaya_printed: 'حفص عن عاصم',
    ...values,
  };
}

/** The enrollment's subject (its snapshot), which a request copies. */
async function subjectOf(enrollmentId: string): Promise<string> {
  const { rows } = await db.query<{ subject: string }>(
    `SELECT snapshot_subject_id AS subject FROM enrollments WHERE id = $1`,
    [enrollmentId],
  );
  const [row] = rows;
  if (row === undefined) throw new Error('no enrollment');
  return row.subject;
}

/** The SQLSTATE a request of `values` on `enrollment` is refused with, or null when accepted. */
async function tryRequest(
  enrollment: Awaited<ReturnType<typeof makeEnrollment>>,
  values: Readonly<Record<string, unknown>>,
): Promise<string | null> {
  const { sql, params } = await insertStatement(
    db,
    'ijazah_requests',
    requestValues(enrollment, await subjectOf(enrollment.enrollmentId), values),
  );
  return attempt(db, sql, params);
}

/** The SQLSTATE an ijazah of `values` on a fresh enrollment is refused with, or null when accepted. */
async function tryIjazah(values: Readonly<Record<string, unknown>>): Promise<string | null> {
  const enrollment = await makeEnrollment(db);
  const { sql, params } = await insertStatement(db, 'ijazahs', {
    certificate_number: `probe-${randomUUID()}`,
    enrollment_id: enrollment.enrollmentId,
    student_user_id: enrollment.studentId,
    teacher_user_id: enrollment.teacherId,
    subject_id: await subjectOf(enrollment.enrollmentId),
    mode: 'generated',
    language: 'ar',
    certificate_storage_key: `ijazahs/${randomUUID()}.pdf`,
    paper_copy_intended: false,
    verification_token_hash: randomUUID(),
    granted_at: '2026-11-17T08:00:00Z',
    student_name_printed: 'اسم الطالب',
    teacher_name_printed: 'اسم المعلم',
    // B46 (005:T006, Q5 (c)): the riwaya it prints, NOT NULL.
    riwaya_printed: 'حفص عن عاصم',
    ...values,
  });
  return attempt(db, sql, params);
}

/** The SQLSTATE a report of `values` is refused with, or null when accepted. */
async function tryReport(values: Readonly<Record<string, unknown>>): Promise<string | null> {
  const { sql, params } = await insertStatement(db, 'user_reports', {
    reason: 'سبب البلاغ',
    status: 'open',
    ...values,
  });
  return attempt(db, sql, params);
}

/** The SQLSTATE a gender flag of `values` is refused with, or null when accepted. */
async function tryFlag(values: Readonly<Record<string, unknown>>): Promise<string | null> {
  const { sql, params } = await insertStatement(db, 'gender_flags', {
    status: 'open',
    reason: 'سبب البلاغ',
    ...values,
  });
  return attempt(db, sql, params);
}

const DECIDED_AT = '2026-11-17T09:00:00Z';

describe('the migration on ijazah_integrity: the catalogue (005:T001)', () => {
  it('adds ijazah_requests with its enum, its columns and their nullability', async () => {
    expect(
      await columnsOf('ijazah_requests', [
        'id',
        'enrollment_id',
        'teacher_user_id',
        'student_user_id',
        'subject_id',
        'completion_date',
        'language',
        'status',
        'chain_snapshot',
        'teacher_name_printed',
        'signature_storage_key',
        'reason',
        'decided_by_admin_id',
        'decided_at',
        'created_at',
        'updated_at',
      ]),
    ).toEqual([
      'chain_snapshot jsonb NO',
      'completion_date date NO',
      'created_at timestamptz NO',
      'decided_at timestamptz YES',
      'decided_by_admin_id uuid YES',
      'enrollment_id uuid NO',
      'id uuid NO',
      'language language NO',
      'reason text YES',
      'signature_storage_key text YES',
      'status ijazah_request_status NO',
      'student_user_id uuid NO',
      'subject_id uuid NO',
      'teacher_name_printed text NO',
      'teacher_user_id uuid NO',
      'updated_at timestamptz NO',
    ]);
    const { rows } = await db.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'ijazah_request_status' ORDER BY e.enumsortorder`,
    );
    expect(rows.map(({ label }) => label)).toEqual([
      'awaiting_student_name',
      'pending',
      'approved',
      'rejected',
      'closed',
    ]);
  });

  it('adds ijazahs’ nine Phase 4 columns, the two printed names NOT NULL', async () => {
    expect(
      await columnsOf('ijazahs', [
        'request_id',
        'issued_by_admin_id',
        'student_name_printed',
        'teacher_name_printed',
        'completion_date',
        'rendered_at',
        'render_generation',
        'signed_off_at',
        'signed_off_by_admin_id',
      ]),
    ).toEqual([
      'completion_date date YES',
      'issued_by_admin_id uuid YES',
      'render_generation int4 NO',
      'rendered_at timestamptz YES',
      'request_id uuid YES',
      'signed_off_at timestamptz YES',
      'signed_off_by_admin_id uuid YES',
      'student_name_printed text NO',
      'teacher_name_printed text NO',
    ]);
  });

  it('adds session_reminders, keyed by (session, user, offset)', async () => {
    expect(
      await columnsOf('session_reminders', [
        'session_id',
        'user_id',
        'offset_minutes',
        'notification_id',
        'created_at',
      ]),
    ).toEqual([
      'created_at timestamptz NO',
      'notification_id uuid NO',
      'offset_minutes int4 NO',
      'session_id uuid NO',
      'user_id uuid NO',
    ]);
    const { rows } = await db.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid = 'session_reminders'::regclass AND contype = 'p'`,
    );
    expect(rows).toEqual([{ definition: 'PRIMARY KEY (session_id, user_id, offset_minutes)' }]);
  });

  it('adds user_reports.enrollment_id and gender_flags.reason and report_id', async () => {
    expect(await columnsOf('user_reports', ['enrollment_id'])).toEqual(['enrollment_id uuid YES']);
    expect(await columnsOf('gender_flags', ['reason', 'report_id'])).toEqual([
      'reason text NO',
      'report_id uuid YES',
    ]);
  });

  it('holds rules 53 to 57 by name', async () => {
    expect(await constraintOf('ijazah_requests', 'ijazah_requests_reason_check')).toEqual(['c']);
    expect(await constraintOf('ijazah_requests', 'ijazah_requests_decided_check')).toEqual(['c']);
    expect(await constraintOf('ijazahs', 'ijazahs_signed_off_check')).toEqual(['c']);
    expect(await constraintOf('user_reports', 'user_reports_not_self_check')).toEqual(['c']);
    expect(await constraintOf('user_reports', 'user_reports_context_check')).toEqual(['c']);
    expect(await uniqueIndexOf('ijazah_requests_one_open_per_enrollment_key')).toEqual([
      "CREATE UNIQUE INDEX ijazah_requests_one_open_per_enrollment_key ON public.ijazah_requests USING btree (enrollment_id) WHERE (status = ANY (ARRAY['awaiting_student_name'::ijazah_request_status, 'pending'::ijazah_request_status]))",
    ]);
    expect(await uniqueIndexOf('user_reports_one_open_key')).toEqual([
      "CREATE UNIQUE INDEX user_reports_one_open_key ON public.user_reports USING btree (reporter_user_id, reported_user_id, context) WHERE (status = 'open'::user_report_status)",
    ]);
    expect(await uniqueIndexOf('gender_flags_one_open_per_user_key')).toEqual([
      "CREATE UNIQUE INDEX gender_flags_one_open_per_user_key ON public.gender_flags USING btree (flagged_user_id) WHERE (status = 'open'::gender_flag_status)",
    ]);
  });
});

describe('ERD §15 rule 53: one open ijazah request per enrollment (005:T001)', () => {
  it('admits one open request, and a new one once the last is decided or closed', async () => {
    await inRollback(db, async () => {
      const enrollment = await makeEnrollment(db);
      const admin = await makeAdmin(db);
      expect(await tryRequest(enrollment, { status: 'awaiting_student_name' })).toBeNull();
      await db.query(
        `UPDATE ijazah_requests SET status = 'rejected', reason = 'سبب', decided_by_admin_id = $2,
                decided_at = $3 WHERE enrollment_id = $1`,
        [enrollment.enrollmentId, admin, DECIDED_AT],
      );
      expect(await tryRequest(enrollment, {})).toBeNull();
      await db.query(
        `UPDATE ijazah_requests SET status = 'closed' WHERE enrollment_id = $1 AND status = 'pending'`,
        [enrollment.enrollmentId],
      );
      expect(await tryRequest(enrollment, {})).toBeNull();
    });
  });

  it('refuses a second open request on one enrollment, whichever open state either holds', async () => {
    await inRollback(db, async () => {
      for (const [first, second] of [
        ['pending', 'pending'],
        ['pending', 'awaiting_student_name'],
        ['awaiting_student_name', 'pending'],
      ] as const) {
        const enrollment = await makeEnrollment(db);
        expect(await tryRequest(enrollment, { status: first })).toBeNull();
        expect(await tryRequest(enrollment, { status: second }), `${first} then ${second}`).toBe(
          SQLSTATE.uniqueViolation,
        );
      }
    });
  });
});

describe('ERD §15 rule 54: a rejection’s reason, and the decision’s pair (005:T001)', () => {
  it('admits an approval and a rejection with their decider, and an open or closed request without', async () => {
    await inRollback(db, async () => {
      const admin = await makeAdmin(db);
      const decided = { decided_by_admin_id: admin, decided_at: DECIDED_AT };
      expect(
        await tryRequest(await makeEnrollment(db), { status: 'approved', ...decided }),
      ).toBeNull();
      expect(
        await tryRequest(await makeEnrollment(db), {
          status: 'rejected',
          reason: 'سبب',
          ...decided,
        }),
      ).toBeNull();
      expect(await tryRequest(await makeEnrollment(db), { status: 'closed' })).toBeNull();
      expect(
        await tryRequest(await makeEnrollment(db), { status: 'awaiting_student_name' }),
      ).toBeNull();
    });
  });

  it('refuses a rejection with no reason or a blank one', async () => {
    await inRollback(db, async () => {
      const decided = { decided_by_admin_id: await makeAdmin(db), decided_at: DECIDED_AT };
      expect(await tryRequest(await makeEnrollment(db), { status: 'rejected', ...decided })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(
        await tryRequest(await makeEnrollment(db), {
          status: 'rejected',
          reason: '  ',
          ...decided,
        }),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('refuses a decision without its pair, and a decider on a request nobody decided', async () => {
    await inRollback(db, async () => {
      const admin = await makeAdmin(db);
      for (const values of [
        { status: 'approved' },
        { status: 'approved', decided_by_admin_id: admin },
        { status: 'approved', decided_at: DECIDED_AT },
        { status: 'rejected', reason: 'سبب', decided_at: DECIDED_AT },
        { status: 'pending', decided_by_admin_id: admin, decided_at: DECIDED_AT },
        { status: 'closed', decided_by_admin_id: admin, decided_at: DECIDED_AT },
      ]) {
        expect(await tryRequest(await makeEnrollment(db), values), JSON.stringify(values)).toBe(
          SQLSTATE.checkViolation,
        );
      }
    });
  });
});

describe('ERD §15 rule 55: the sign-off’s pair, never before the rendering (005:T001)', () => {
  it('admits an ijazah not rendered, rendered, and signed off after its rendering', async () => {
    await inRollback(db, async () => {
      const admin = await makeAdmin(db);
      expect(await tryIjazah({})).toBeNull();
      expect(
        await tryIjazah({ rendered_at: '2026-11-17T08:05:00Z', render_generation: 2 }),
      ).toBeNull();
      expect(
        await tryIjazah({
          rendered_at: '2026-11-17T08:05:00Z',
          signed_off_at: '2026-11-17T08:05:00Z',
          signed_off_by_admin_id: admin,
        }),
      ).toBeNull();
    });
  });

  it('refuses a sign-off without its pair, without a rendering, or before it', async () => {
    await inRollback(db, async () => {
      const admin = await makeAdmin(db);
      for (const values of [
        { rendered_at: '2026-11-17T08:05:00Z', signed_off_at: '2026-11-17T08:10:00Z' },
        { rendered_at: '2026-11-17T08:05:00Z', signed_off_by_admin_id: admin },
        { signed_off_at: '2026-11-17T08:10:00Z', signed_off_by_admin_id: admin },
        {
          rendered_at: '2026-11-17T08:05:00Z',
          signed_off_at: '2026-11-17T08:04:59Z',
          signed_off_by_admin_id: admin,
        },
      ]) {
        expect(await tryIjazah(values), JSON.stringify(values)).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  it('refuses an ijazah without the names it prints', async () => {
    await inRollback(db, async () => {
      expect(await tryIjazah({ student_name_printed: null })).toBe(SQLSTATE.notNullViolation);
      expect(await tryIjazah({ teacher_name_printed: null })).toBe(SQLSTATE.notNullViolation);
    });
  });
});

describe('session_reminders: once per (session, user, offset) (005:T001, R-407)', () => {
  it('admits each offset once per user, and refuses the same offset twice', async () => {
    await inRollback(db, async () => {
      const session = await makeSession(db);
      const notification = (userId: string): Promise<string> =>
        insertRow(db, 'notifications', {
          user_id: userId,
          type: 'session_reminder',
          title_key: 'notifications.push.sessionReminder.title',
          body_key: 'notifications.push.sessionReminder.body',
          payload: JSON.stringify({ sessionId: session.sessionId }),
        });
      const reminder = async (userId: string, offset: number): Promise<string | null> =>
        attempt(
          db,
          `INSERT INTO session_reminders (session_id, user_id, offset_minutes, notification_id)
           VALUES ($1, $2, $3, $4)`,
          [session.sessionId, userId, offset, await notification(userId)],
        );
      expect(await reminder(session.studentId, 1440)).toBeNull();
      expect(await reminder(session.studentId, 15)).toBeNull();
      expect(await reminder(session.teacherId, 1440)).toBeNull();
      expect(await reminder(session.studentId, 1440)).toBe(SQLSTATE.uniqueViolation);
    });
  });
});

describe('ERD §15 rule 56: a report’s context and one open report per subject (005:T001, R-408)', () => {
  it('admits a profile report alone, a chat report with its enrollment, a session report with both', async () => {
    await inRollback(db, async () => {
      const session = await makeSession(db);
      const reporter = session.studentId;
      expect(
        await tryReport({
          reporter_user_id: reporter,
          reported_user_id: session.teacherId,
          context: 'profile',
        }),
      ).toBeNull();
      expect(
        await tryReport({
          reporter_user_id: reporter,
          reported_user_id: session.teacherId,
          context: 'chat',
          enrollment_id: session.enrollmentId,
        }),
      ).toBeNull();
      expect(
        await tryReport({
          reporter_user_id: reporter,
          reported_user_id: session.teacherId,
          context: 'session',
          session_id: session.sessionId,
          enrollment_id: session.enrollmentId,
        }),
      ).toBeNull();
    });
  });

  it('refuses a report on oneself, a session report without its session or enrollment, a chat one without its enrollment', async () => {
    await inRollback(db, async () => {
      const session = await makeSession(db);
      const parties = { reporter_user_id: session.studentId, reported_user_id: session.teacherId };
      for (const values of [
        {
          reporter_user_id: session.studentId,
          reported_user_id: session.studentId,
          context: 'profile',
        },
        { ...parties, context: 'session', enrollment_id: session.enrollmentId },
        { ...parties, context: 'session', session_id: session.sessionId },
        { ...parties, context: 'chat' },
        { ...parties, context: 'chat', session_id: session.sessionId },
      ]) {
        expect(await tryReport(values), JSON.stringify(values)).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  it('refuses a second open report of one reporter on one user in one context, and admits it once the first is resolved', async () => {
    await inRollback(db, async () => {
      const reporter = await makeUser(db);
      const reported = await makeUser(db);
      const report = { reporter_user_id: reporter, reported_user_id: reported, context: 'profile' };
      expect(await tryReport(report)).toBeNull();
      expect(await tryReport(report)).toBe(SQLSTATE.uniqueViolation);
      await db.query(
        `UPDATE user_reports SET status = 'dismissed', resolved_at = now() WHERE reporter_user_id = $1`,
        [reporter],
      );
      expect(await tryReport(report)).toBeNull();
    });
  });
});

describe('ERD §15 rule 57: one open gender flag per user, and its reason (005:T001, R-409)', () => {
  it('admits one open flag, a flag from a report, and a new one once the last is resolved', async () => {
    await inRollback(db, async () => {
      const flagged = await makeUser(db);
      const raiser = await makeUser(db);
      const reportId = await insertRow(db, 'user_reports', {
        reporter_user_id: raiser,
        reported_user_id: flagged,
        context: 'profile',
        reason: 'سبب البلاغ',
        status: 'open',
      });
      expect(await tryFlag({ flagged_user_id: flagged, report_id: reportId })).toBeNull();
      await db.query(
        `UPDATE gender_flags SET status = 'dismissed', resolved_at = now() WHERE flagged_user_id = $1`,
        [flagged],
      );
      expect(await tryFlag({ flagged_user_id: flagged, raised_by_user_id: raiser })).toBeNull();
    });
  });

  it('refuses a second open flag on one user, and a flag with no reason', async () => {
    await inRollback(db, async () => {
      const flagged = await makeUser(db);
      expect(await tryFlag({ flagged_user_id: flagged })).toBeNull();
      expect(await tryFlag({ flagged_user_id: flagged })).toBe(SQLSTATE.uniqueViolation);
      expect(await tryFlag({ flagged_user_id: await makeUser(db), reason: null })).toBe(
        SQLSTATE.notNullViolation,
      );
    });
  });
});
