// B46 (specs/005-certification/tasks.md, the note under T006; the owner's Q5 (c) and the review's
// refinement of 2026-11-17) — the migration `20261117131114_certification_printed_riwaya_tariq` on
// this database (data-model.md; ERD changelog row 52, §15 rule 58): the credential's riwaya and
// tariq as printed, on `ijazah_requests` and on `ijazahs`; the riwaya NOT NULL, the tariq NULL when
// the credential names none; neither ever '' on a new row. On `ijazahs` the two checks are NOT VALID,
// so the test databases' `probe-` rows (backfilled '') stay, and every row written after them is held.
//
// As certification-foundations.spec.ts: each probe first writes the rows the rule admits, then each
// forbidden one, expecting its SQLSTATE; a catalogue case holds each column and constraint by name;
// every probe runs as the application role in a transaction that is rolled back.
//
// Observed red: every case against the database before the migration; the catalogue's checks and
// the '' cases against the mutant migration M-B46 (its columns alone, without the four checks).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
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

/** The check `name` of `table` as `type validated: definition`, or nothing. */
async function checkOf(table: string, name: string): Promise<string[]> {
  const { rows } = await db.query<{ type: string; validated: boolean; definition: string }>(
    `SELECT contype AS type, convalidated AS validated, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid = $1::regclass AND conname = $2`,
    [table, name],
  );
  return rows.map(
    ({ type, validated, definition }) => `${type} ${validated ? 'valid' : 'not valid'}: ${definition}`,
  );
}

/** Whether a column of `table` holds a default. */
async function defaultOf(table: string, column: string): Promise<(string | null)[]> {
  const { rows } = await db.query<{ value: string | null }>(
    `SELECT column_default AS value FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.map(({ value }) => value);
}

/** The enrollment's subject (its snapshot), which a request and an ijazah copy. */
async function subjectOf(enrollmentId: string): Promise<string> {
  const { rows } = await db.query<{ subject: string }>(
    `SELECT snapshot_subject_id AS subject FROM enrollments WHERE id = $1`,
    [enrollmentId],
  );
  const [row] = rows;
  if (row === undefined) throw new Error('no enrollment');
  return row.subject;
}

/** The SQLSTATE a pending request of `values` on a fresh enrollment is refused with, or null. */
async function tryRequest(values: Readonly<Record<string, unknown>>): Promise<string | null> {
  const enrollment = await makeEnrollment(db);
  const { sql, params } = await insertStatement(db, 'ijazah_requests', {
    enrollment_id: enrollment.enrollmentId,
    teacher_user_id: enrollment.teacherId,
    student_user_id: enrollment.studentId,
    subject_id: await subjectOf(enrollment.enrollmentId),
    completion_date: '2026-11-01',
    status: 'pending',
    chain_snapshot: JSON.stringify([['الشيخ الأول'], ['المعلم']]),
    teacher_name_printed: 'اسم المعلم',
    ...values,
  });
  return attempt(db, sql, params);
}

/** The SQLSTATE an ijazah of `values` on a fresh enrollment is refused with, or null. */
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
    ...values,
  });
  return attempt(db, sql, params);
}

const TRY = { ijazah_requests: tryRequest, ijazahs: tryIjazah } as const;

describe('the migration on ijazah_integrity: the catalogue (B46, 005:T006, Q5 (c))', () => {
  it.each(['ijazah_requests', 'ijazahs'] as const)(
    'adds %s’ riwaya_printed NOT NULL and tariq_printed nullable, with no default',
    async (table) => {
      expect(await columnsOf(table, ['riwaya_printed', 'tariq_printed'])).toEqual([
        'riwaya_printed text NO',
        'tariq_printed text YES',
      ]);
      expect(await defaultOf(table, 'riwaya_printed')).toEqual([null]);
    },
  );

  it('holds rule 58 by name: valid on ijazah_requests, NOT VALID on ijazahs', async () => {
    expect(
      await checkOf('ijazah_requests', 'ijazah_requests_riwaya_printed_check'),
    ).toEqual(["c valid: CHECK ((riwaya_printed <> ''::text))"]);
    expect(await checkOf('ijazah_requests', 'ijazah_requests_tariq_printed_check')).toEqual([
      "c valid: CHECK (((tariq_printed IS NULL) OR (tariq_printed <> ''::text)))",
    ]);
    expect(await checkOf('ijazahs', 'ijazahs_riwaya_printed_check')).toEqual([
      "c not valid: CHECK ((riwaya_printed <> ''::text)) NOT VALID",
    ]);
    expect(await checkOf('ijazahs', 'ijazahs_tariq_printed_check')).toEqual([
      "c not valid: CHECK (((tariq_printed IS NULL) OR (tariq_printed <> ''::text))) NOT VALID",
    ]);
  });
});

describe('ERD §15 rule 58: a printed riwaya, and a tariq absent or printed (B46, 005:T006)', () => {
  it.each(['ijazah_requests', 'ijazahs'] as const)(
    'admits on %s a riwaya with a tariq, and a riwaya with no tariq',
    async (table) => {
      await inRollback(db, async () => {
        expect(
          await TRY[table]({ riwaya_printed: 'حفص عن عاصم', tariq_printed: 'الشاطبية' }),
        ).toBeNull();
        expect(await TRY[table]({ riwaya_printed: 'حفص عن عاصم', tariq_printed: null })).toBeNull();
      });
    },
  );

  it.each(['ijazah_requests', 'ijazahs'] as const)(
    'refuses on %s a row with no riwaya',
    async (table) => {
      await inRollback(db, async () => {
        expect(await TRY[table]({ tariq_printed: 'الشاطبية' })).toBe(SQLSTATE.notNullViolation);
      });
    },
  );

  it.each(['ijazah_requests', 'ijazahs'] as const)(
    'refuses on %s an empty riwaya, and an empty tariq',
    async (table) => {
      await inRollback(db, async () => {
        expect(await TRY[table]({ riwaya_printed: '' })).toBe(SQLSTATE.checkViolation);
        expect(await TRY[table]({ riwaya_printed: 'حفص عن عاصم', tariq_printed: '' })).toBe(
          SQLSTATE.checkViolation,
        );
      });
    },
  );
});
