// T140 — the database refuses what the ERD forbids (ERD §15 rules 28, 29 and 36 to 38;
// specs/003-booking/data-model.md §2.1 and §5).
//
// The column limits the ERD notes, as the owner settled them on 2026-10-31: a package has one
// session or more, a price above zero and a length of 30, 45 or 60 minutes; a weekly slot falls on
// a day 0 to 6 and lasts 30, 45 or 60 minutes; a session's number and a chain generation's position
// count from 1; and an audit entry's target label is never empty. Each probe first writes the
// edge values the check admits, so a refusal is the rule and not a broken row, then each forbidden
// value, expecting 23514. The catalogue probes hold the constraints by name, and the index on
// `user_sessions.previous_refresh_token_hash` that the grace-window lookup reads (T047, T094).
// Every probe runs as the application role in a transaction that is rolled back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
  insertStatement,
  makeAdmin,
  makeCredential,
  makeEnrollment,
  makeSubject,
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

/** The SQLSTATE an insert of `values` into `table` is refused with, or null when accepted. */
async function tryInsert(table: string, values: Record<string, unknown>): Promise<string | null> {
  const { sql, params } = await insertStatement(db, table, values);
  return attempt(db, sql, params);
}

/** The lengths a package and a slot may have (FR-PROFILE-2, FR-PROFILE-4 as amended 2026-10-31). */
const LENGTHS = [30, 45, 60] as const;
const REFUSED_LENGTHS = [0, 15, 50, 90] as const;

describe('ERD §15 rule 36: a package has sessions, a price and an allowed length (T140)', () => {
  async function packageRow(): Promise<
    (values: Record<string, unknown>) => Record<string, unknown>
  > {
    const teacher = await makeUser(db);
    const subject = await makeSubject(db);
    return (values) => ({
      teacher_user_id: teacher,
      subject_id: subject,
      session_count: 4,
      session_duration_minutes: 60,
      price_piasters: 100_000,
      is_active: true,
      ...values,
    });
  }

  it('a package of no session is refused; one session is admitted', async () => {
    await inRollback(db, async () => {
      const row = await packageRow();
      expect(await tryInsert('packages', row({ session_count: 1 }))).toBeNull();
      expect(await tryInsert('packages', row({ session_count: 0 }))).toBe(SQLSTATE.checkViolation);
      expect(await tryInsert('packages', row({ session_count: -1 }))).toBe(SQLSTATE.checkViolation);
    });
  });

  it('a package priced at zero is refused; one piaster is admitted', async () => {
    await inRollback(db, async () => {
      const row = await packageRow();
      expect(await tryInsert('packages', row({ price_piasters: 1 }))).toBeNull();
      expect(await tryInsert('packages', row({ price_piasters: 0 }))).toBe(SQLSTATE.checkViolation);
      expect(await tryInsert('packages', row({ price_piasters: -100 }))).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });

  it('a package session of any length but 30, 45 or 60 minutes is refused', async () => {
    await inRollback(db, async () => {
      const row = await packageRow();
      for (const minutes of LENGTHS) {
        expect(await tryInsert('packages', row({ session_duration_minutes: minutes }))).toBeNull();
      }
      for (const minutes of REFUSED_LENGTHS) {
        expect(await tryInsert('packages', row({ session_duration_minutes: minutes }))).toBe(
          SQLSTATE.checkViolation,
        );
      }
    });
  });
});

describe('ERD §15 rule 37: a weekly slot falls on a day of the week and has an allowed length (T140)', () => {
  async function slotRow(): Promise<(values: Record<string, unknown>) => Record<string, unknown>> {
    const teacher = await makeUser(db);
    return (values) => ({
      teacher_user_id: teacher,
      day_of_week: 0,
      start_time_local: '09:00:00',
      duration_minutes: 60,
      timezone: 'Africa/Cairo',
      is_active: true,
      ...values,
    });
  }

  it('a day outside 0 (Sunday) to 6 (Saturday) is refused', async () => {
    await inRollback(db, async () => {
      const row = await slotRow();
      expect(await tryInsert('availability_slots', row({ day_of_week: 0 }))).toBeNull();
      expect(await tryInsert('availability_slots', row({ day_of_week: 6 }))).toBeNull();
      expect(await tryInsert('availability_slots', row({ day_of_week: -1 }))).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryInsert('availability_slots', row({ day_of_week: 7 }))).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });

  it('a slot of any length but 30, 45 or 60 minutes is refused', async () => {
    await inRollback(db, async () => {
      const row = await slotRow();
      for (const minutes of LENGTHS) {
        expect(
          await tryInsert('availability_slots', row({ duration_minutes: minutes })),
        ).toBeNull();
      }
      for (const minutes of REFUSED_LENGTHS) {
        expect(await tryInsert('availability_slots', row({ duration_minutes: minutes }))).toBe(
          SQLSTATE.checkViolation,
        );
      }
    });
  });
});

describe('ERD §15 rule 38: a session is numbered from 1 (T140)', () => {
  it('a session numbered 0 is refused; session 1 is admitted', async () => {
    await inRollback(db, async () => {
      const enrollment = await makeEnrollment(db);
      const session = (sequenceNumber: number, day: string) => ({
        enrollment_id: enrollment.enrollmentId,
        teacher_user_id: enrollment.teacherId,
        student_user_id: enrollment.studentId,
        sequence_number: sequenceNumber,
        scheduled_date_local: day,
        scheduled_start_time_local: '09:00:00',
        timezone: 'Africa/Cairo',
        scheduled_start_at: `${day}T06:00:00Z`,
        scheduled_end_at: `${day}T07:00:00Z`,
        status: 'scheduled',
      });
      expect(await tryInsert('sessions', session(1, '2026-10-04'))).toBeNull();
      expect(await tryInsert('sessions', session(0, '2026-10-11'))).toBe(SQLSTATE.checkViolation);
      expect(await tryInsert('sessions', session(-1, '2026-10-18'))).toBe(SQLSTATE.checkViolation);
    });
  });
});

describe('ERD §15 rule 28: a chain generation is positioned from 1 (T140)', () => {
  it('a generation at position 0 is refused; position 1 is admitted', async () => {
    await inRollback(db, async () => {
      const teacher = await makeUser(db);
      const subject = await makeSubject(db);
      const admin = await makeAdmin(db);
      const credential = await makeCredential(db, {
        teacherId: teacher,
        subjectId: subject,
        status: 'approved',
        admin,
      });
      const entry = (position: number) => ({
        credential_id: credential,
        position,
        names: ['Probe name'],
        created_by_admin_id: admin,
      });
      expect(await tryInsert('isnad_entries', entry(1))).toBeNull();
      expect(await tryInsert('isnad_entries', entry(0))).toBe(SQLSTATE.checkViolation);
      expect(await tryInsert('isnad_entries', entry(-1))).toBe(SQLSTATE.checkViolation);
    });
  });
});

describe('ERD §15 rule 29: an audit entry’s target label is never empty (T140)', () => {
  it('an empty label is refused; a one-character label is admitted', async () => {
    await inRollback(db, async () => {
      const adminId = await makeAdmin(db);
      const entry = (label: string) => ({
        admin_id: adminId,
        action: 'probe.recorded',
        target_type: 'admin',
        target_id: adminId,
        target_label: label,
      });
      expect(await tryInsert('audit_logs', entry('م'))).toBeNull();
      expect(await tryInsert('audit_logs', entry(''))).toBe(SQLSTATE.checkViolation);
    });
  });
});

describe('the catalogue holds T140’s checks and index', () => {
  /** Each check T140 lands, by table and name. */
  const checks: ReadonlyArray<{ table: string; name: string }> = [
    { table: 'packages', name: 'packages_session_count_positive_check' },
    { table: 'packages', name: 'packages_price_positive_check' },
    { table: 'packages', name: 'packages_session_duration_allowed_check' },
    { table: 'availability_slots', name: 'availability_slots_day_of_week_range_check' },
    { table: 'availability_slots', name: 'availability_slots_duration_allowed_check' },
    { table: 'sessions', name: 'sessions_sequence_number_positive_check' },
    { table: 'isnad_entries', name: 'isnad_entries_position_positive_check' },
    { table: 'audit_logs', name: 'audit_logs_target_label_not_empty_check' },
  ];

  it('every check is a validated check constraint on its table', async () => {
    const { rows } = await db.query<{ table: string; name: string }>(
      `SELECT conrelid::regclass::text AS table, conname AS name
         FROM pg_constraint
        WHERE contype = 'c' AND convalidated AND conname = ANY ($1::text[])`,
      [checks.map(({ name }) => name)],
    );
    const byName = (left: { name: string }, right: { name: string }): number =>
      left.name < right.name ? -1 : 1;
    expect([...rows].sort(byName)).toEqual([...checks].sort(byName));
  });

  it('user_sessions.previous_refresh_token_hash carries a plain index', async () => {
    const { rows } = await db.query<{ name: string; definition: string }>(
      `SELECT indexname AS name, indexdef AS definition
         FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'user_sessions'
          AND indexname = 'user_sessions_previous_refresh_token_hash_idx'`,
    );
    expect(rows).toEqual([
      {
        name: 'user_sessions_previous_refresh_token_hash_idx',
        definition:
          'CREATE INDEX user_sessions_previous_refresh_token_hash_idx ON public.user_sessions USING btree (previous_refresh_token_hash)',
      },
    ]);
  });
});
