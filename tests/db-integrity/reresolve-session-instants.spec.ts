// T048 — the `reresolve-session-instants` job over the real tables (R-210, FR-370, ADR 0009 D3,
// ERD §15 rule 19):
//
//   - a time zone data version the last run did not have: every scheduled session's instants are
//     recomputed from its local date, start and zone, back-to-back sessions of one teacher moved by
//     the same hour in one transaction (the overlap constraints deferred to its commit), and the
//     version recorded as the last run's in `idempotency_keys` under `tzdata-reresolve`;
//   - the last run's version: nothing is read or written;
//   - a moved session that would overlap another session of its teacher that the constraints count
//     is restored to its previous instants and reported, while the run's other sessions commit;
//   - two runs leave what one leaves;
//   - T014 (research R-323, GAP-6): in the run's one transaction, one `session_events` row
//     `instants_reresolved` per session moved and per session kept back, `previous_start_at` the
//     start before the run; a refused commit writes none, and a later run that keeps the same
//     session back again writes another.
//
// The stale caches are written as a data change would leave them: a Cairo session of
// Sunday 2026-11-08 (+02:00) cached as if Cairo were still at +03:00, an hour early. The job runs
// over every scheduled session of the database, so each case reads back only its own rows, of its
// own accounts; each run is keyed by a version of its own, so no case sees another's run. Parents
// and sessions are committed through the application role and removed after the suite by the OWNER
// role, as `session-generation.spec.ts` does.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runOnceAndTwice } from '../../apps/api/src/jobs/double-run.js';
import {
  type ReresolutionSteps,
  reresolutionSteps,
  reresolveSessionInstants,
  SessionsKeptAtPreviousInstants,
  TZDATA_RERESOLVE_SCOPE,
} from '../../apps/api/src/jobs/reresolve-session-instants.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { jobRunsOver } from '../../apps/api/src/platform/idempotency/job-runs.repository.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

const CAIRO = 'Africa/Cairo';
const DAY = '2026-11-08';

let setup: Db;
let database: Database;
const users: string[] = [];
const subjects: string[] = [];
const versions: string[] = [];

beforeAll(async () => {
  specDatabaseUrl('DATABASE_URL_OWNER');
  setup = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await Promise.all([setup?.end(), database === undefined ? undefined : closeDatabase(database)]);
  const owner = new pg.Client({
    connectionString: specDatabaseUrl('DATABASE_URL_OWNER'),
    connectionTimeoutMillis: 5_000,
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await owner.query('DELETE FROM "idempotency_keys" WHERE scope = $1 AND key = ANY($2)', [
      TZDATA_RERESOLVE_SCOPE,
      versions,
    ]);
    // T014: the run's `instants_reresolved` rows reference the sessions and their enrollments.
    await owner.query(
      `DELETE FROM "session_events" WHERE enrollment_id IN (
         SELECT id FROM "enrollments" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1))`,
      [users],
    );
    await owner.query(
      'DELETE FROM "sessions" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
      [users],
    );
    await owner.query(
      'DELETE FROM "enrollments" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
      [users],
    );
    await owner.query('DELETE FROM "availability_slots" WHERE teacher_user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "packages" WHERE teacher_user_id = ANY($1)', [users]);
    await owner.query('DELETE FROM "subjects" WHERE id = ANY($1)', [subjects]);
    await owner.query('DELETE FROM "users" WHERE id = ANY($1)', [users]);
    await owner.query('COMMIT');
  } finally {
    await owner.end();
  }
});

/** A version of this spec's own, recorded for removal. */
function versionOfItsOwn(): string {
  const version = `spec-${randomUUID()}`;
  versions.push(version);
  return version;
}

/** A teacher's offer, committed and recorded for removal. */
async function committedOffer(): Promise<Awaited<ReturnType<typeof makeOffer>>> {
  const offer = await makeOffer(setup);
  users.push(offer.teacherId);
  subjects.push(offer.subjectId);
  return offer;
}

/** An enrollment of a new student with the teacher of `offer` (60-minute sessions), committed. */
async function committedEnrollment(
  offer: Awaited<ReturnType<typeof makeOffer>>,
): Promise<{ id: string; teacherId: string; studentId: string }> {
  const studentId = await makeUser(setup);
  users.push(studentId);
  const id = await insertRow(setup, 'enrollments', enrollmentValues(offer, studentId));
  return { id, teacherId: offer.teacherId, studentId };
}

/** A committed session of `enrollment` at `startLocal` on DAY in Cairo, cached as given. */
async function committedSession(
  enrollment: { id: string; teacherId: string; studentId: string },
  values: {
    readonly sequence: number;
    readonly startLocal: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly status?: string;
  },
): Promise<string> {
  return insertRow(setup, 'sessions', {
    enrollment_id: enrollment.id,
    teacher_user_id: enrollment.teacherId,
    student_user_id: enrollment.studentId,
    sequence_number: values.sequence,
    scheduled_date_local: DAY,
    scheduled_start_time_local: values.startLocal,
    timezone: CAIRO,
    scheduled_start_at: values.startsAt,
    scheduled_end_at: values.endsAt,
    status: values.status ?? 'scheduled',
  });
}

/** The committed instants of `ids`, in their order, as text. */
async function instantsOf(ids: readonly string[]): Promise<string[][]> {
  const { rows } = await setup.query<{ id: string; starts: string; ends: string }>(
    `SELECT id,
            to_char(scheduled_start_at AT TIME ZONE 'UTC', 'HH24:MI"Z"') AS starts,
            to_char(scheduled_end_at AT TIME ZONE 'UTC', 'HH24:MI"Z"') AS ends
       FROM "sessions" WHERE id = ANY($1)`,
    [ids],
  );
  return ids.map((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    return row === undefined ? [] : [row.starts, row.ends];
  });
}

const settings: SettingsReader = {
  async read(key, schema) {
    if (key !== 'idempotency_key_ttl_hours') throw new Error(`unexpected setting ${key}`);
    return schema.parse(24);
  },
};

/** The job over the real tables under `version`, its reports kept. */
function jobUnder(version: string, steps: ReresolutionSteps = reresolutionSteps) {
  const reports: Error[] = [];
  const job = reresolveSessionInstants({
    database,
    runs: jobRunsOver(database),
    settings,
    steps,
    tzVersion: () => version,
    report: (error) => reports.push(error),
  });
  return { job, reports };
}

/** The `instants_reresolved` rows of `ids`, by session in the order given, oldest first. */
async function reresolvedRowsOf(ids: readonly string[]): Promise<string[][]> {
  const { rows } = await setup.query<{ session_id: string; previous: string }>(
    `SELECT session_id::text,
            to_char(previous_start_at AT TIME ZONE 'UTC', 'HH24:MI"Z"') AS previous
       FROM "session_events"
      WHERE kind = 'instants_reresolved' AND session_id = ANY($1::uuid[])
      ORDER BY id`,
    [ids],
  );
  return ids.map((id) => rows.filter((row) => row.session_id === id).map((row) => row.previous));
}

/** The refusal of a commit by an overlap constraint, as the adapter throws it (T006). */
function refusedAtCommit(): Error {
  return Object.assign(new Error('refused'), {
    name: 'DriverAdapterError',
    cause: {
      originalCode: '23P01',
      originalMessage:
        'conflicting key value violates exclusion constraint "sessions_teacher_no_overlap"',
    },
  });
}

/** The ids `reports` named among `ids`. */
function reportedAmong(reports: readonly Error[], ids: readonly string[]): string[] {
  return reports
    .filter((error) => error instanceof SessionsKeptAtPreviousInstants)
    .flatMap((error) => (error as SessionsKeptAtPreviousInstants).sessionIds)
    .filter((id) => ids.includes(id));
}

/** A teacher's two back-to-back Cairo sessions, 09:00 and 10:00, both cached an hour early. */
async function backToBackStale(): Promise<string[]> {
  const enrollment = await committedEnrollment(await committedOffer());
  return [
    await committedSession(enrollment, {
      sequence: 1,
      startLocal: '09:00:00',
      startsAt: `${DAY}T06:00:00Z`,
      endsAt: `${DAY}T07:00:00Z`,
    }),
    await committedSession(enrollment, {
      sequence: 2,
      startLocal: '10:00:00',
      startsAt: `${DAY}T07:00:00Z`,
      endsAt: `${DAY}T08:00:00Z`,
    }),
  ];
}

describe('reresolve-session-instants over the real tables (FR-370, ADR 0009 D3)', () => {
  it('a new version recomputes every scheduled session, back-to-back ones moved together, and is recorded', async () => {
    const ids = await backToBackStale();
    const version = versionOfItsOwn();
    const { job, reports } = jobUnder(version);

    await job.handle({});

    expect(await instantsOf(ids)).toEqual([
      ['07:00Z', '08:00Z'],
      ['08:00Z', '09:00Z'],
    ]);
    expect(reportedAmong(reports, ids)).toEqual([]);
    expect(await jobRunsOver(database).lastKey(TZDATA_RERESOLVE_SCOPE, new Date())).toBe(version);
  });

  it('the last run’s version: nothing is written', async () => {
    const ids = await backToBackStale();
    const version = versionOfItsOwn();
    await jobRunsOver(database).record({
      scope: TZDATA_RERESOLVE_SCOPE,
      key: version,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });

    await jobUnder(version).job.handle({});

    expect(await instantsOf(ids)).toEqual([
      ['06:00Z', '07:00Z'],
      ['07:00Z', '08:00Z'],
    ]);
  });

  it('a moved session that would meet a counted one is restored and reported, and the rest commits', async () => {
    const offer = await committedOffer();
    // The teacher's session already held, 09:30–10:30 in Cairo, cached right and counted (done).
    await committedSession(await committedEnrollment(offer), {
      sequence: 1,
      startLocal: '09:30:00',
      startsAt: `${DAY}T07:30:00Z`,
      endsAt: `${DAY}T08:30:00Z`,
      status: 'done',
    });
    // Another student's 09:00 with the same teacher, cached an hour early: recomputed, it would be
    // 07:00–08:00Z and meet the 09:30.
    const blocked = await committedSession(await committedEnrollment(offer), {
      sequence: 1,
      startLocal: '09:00:00',
      startsAt: `${DAY}T06:00:00Z`,
      endsAt: `${DAY}T07:00:00Z`,
    });
    const others = await backToBackStale();
    const { job, reports } = jobUnder(versionOfItsOwn());

    await job.handle({});

    expect(await instantsOf([blocked, ...others])).toEqual([
      ['06:00Z', '07:00Z'],
      ['07:00Z', '08:00Z'],
      ['08:00Z', '09:00Z'],
    ]);
    expect(reportedAmong(reports, [blocked, ...others])).toEqual([blocked]);
  });

  it('two runs leave what one leaves (R-API-14)', async () => {
    const reading = await runOnceAndTwice({
      world: async () => ({ ids: await backToBackStale(), version: versionOfItsOwn() }),
      run: async ({ version }) => {
        await jobUnder(version).job.handle({});
      },
      observe: async ({ ids, version }) => ({
        instants: await instantsOf(ids),
        recorded:
          (await jobRunsOver(database).lastKey(TZDATA_RERESOLVE_SCOPE, new Date())) === version,
        rows: await reresolvedRowsOf(ids),
      }),
    });
    expect(reading.twice).toEqual(reading.once);
    expect(reading.once).toEqual({
      instants: [
        ['07:00Z', '08:00Z'],
        ['08:00Z', '09:00Z'],
      ],
      recorded: true,
      rows: [['06:00Z'], ['07:00Z']],
    });
  });
});

describe('reresolve-session-instants: the record of each session moved or kept back (T014, R-323 GAP-6)', () => {
  /** The teacher's counted 09:30 and another student's 09:00 cached an hour early, kept back. */
  async function keptBackWorld(): Promise<string> {
    const offer = await committedOffer();
    await committedSession(await committedEnrollment(offer), {
      sequence: 1,
      startLocal: '09:30:00',
      startsAt: `${DAY}T07:30:00Z`,
      endsAt: `${DAY}T08:30:00Z`,
      status: 'done',
    });
    return committedSession(await committedEnrollment(offer), {
      sequence: 1,
      startLocal: '09:00:00',
      startsAt: `${DAY}T06:00:00Z`,
      endsAt: `${DAY}T07:00:00Z`,
    });
  }

  it('one row per session moved and per session kept back, each with the start before the run', async () => {
    const blocked = await keptBackWorld();
    const moved = await backToBackStale();

    await jobUnder(versionOfItsOwn()).job.handle({});

    // The kept-back one still starts at its row's `previous_start_at`; the moved ones do not.
    expect(await instantsOf([blocked, ...moved])).toEqual([
      ['06:00Z', '07:00Z'],
      ['07:00Z', '08:00Z'],
      ['08:00Z', '09:00Z'],
    ]);
    expect(await reresolvedRowsOf([blocked, ...moved])).toEqual([
      ['06:00Z'],
      ['06:00Z'],
      ['07:00Z'],
    ]);
  });

  it('a commit refused and run again writes the rows of the run that committed only', async () => {
    const moved = await backToBackStale();
    let refusals = 1;
    const steps: ReresolutionSteps = {
      defer: reresolutionSteps.defer,
      reresolve: async (tx) => {
        const outcome = await reresolutionSteps.reresolve(tx);
        if (refusals > 0) {
          refusals -= 1;
          throw refusedAtCommit();
        }
        return outcome;
      },
    };

    await jobUnder(versionOfItsOwn(), steps).job.handle({});

    expect(refusals).toBe(0);
    expect(await reresolvedRowsOf(moved)).toEqual([['06:00Z'], ['07:00Z']]);
  });

  it('a later run that keeps the same session back again writes another row', async () => {
    const blocked = await keptBackWorld();

    await jobUnder(versionOfItsOwn()).job.handle({});
    await jobUnder(versionOfItsOwn()).job.handle({});

    expect(await reresolvedRowsOf([blocked])).toEqual([['06:00Z', '06:00Z']]);
  });
});
