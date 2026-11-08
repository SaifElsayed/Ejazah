// T016 of specs/004-sessions/tasks.md — a provider outage window recorded over the real tables as
// the application role (FR-445, FR-462, FR-495; R-TIME-6; research R-307; data-model.md §2.5, §3;
// contracts/kernel.md, "outage record").
//
// The window, entered as local wall clocks in a zone, is resolved by `packages/time` and inserted
// once. Each session it overlaps that is settled (`done`, `*_no_show`, `under_threshold`), inside
// its dispute window and not disputed moves to `provider_outage` with one `session_events` row
// `outage_reclassified`, an administrator's resolved session included, and no remedy exists or is
// written; a session outside its dispute window, a disputed one, a scheduled one and one the
// window does not overlap are left as they are. The locks are the enrollments', then the
// sessions'. A window whose end is not after its start is refused with nothing written.
//
// The parents are written and committed by the harness, each probe with its own; each record runs
// in a transaction this file rolls back, so no window, status or event row it writes is kept. The
// sessions are committed, so each run takes a day of its own (`RUN_OFFSET`): no session an earlier
// run left falls in this run's windows. The record's dispute window reads a stand-in clock, the
// completion it calls the database's own (Q3).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomInt } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import {
  createCompletion,
  createOutageServices,
} from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { addDays, resolveLocalDateTime } from '../../packages/time/src/index.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeAdmin,
  makeOffer,
  makeUser,
} from './harness';

/** A zone with no clock change, UTC all year, so a wall clock reads as its instant. */
const ZONE = 'Africa/Abidjan';
/** This run's own days: from 2028-01-01 plus a random number of days. */
const RUN_OFFSET = randomInt(0, 3000);
const dayOf = (offset: number): string =>
  addDays(new Date('2028-01-01T00:00:00Z'), RUN_OFFSET + offset).slice(0, 10);
/** The instant of a wall clock `HH:MM` on `day` in ZONE. */
const utc = (day: string, time: string): string =>
  resolveLocalDateTime({ localDate: day, localTime: `${time}:00`, timezone: ZONE }).startsAt;
const iso = (instant: string): string => new Date(instant).toISOString();

/** The day the window falls on. */
const D = dayOf(0);
/** The record's instant, two days later at 10:00: the dispute windows open since D less a day. */
const AT = new Date(utc(dayOf(2), '10:00'));
const CONFIRMED_AT = new Date('2026-10-04T07:01:00Z');

let db: Db;
let database: Database;

const SETTINGS: Readonly<Record<string, number>> = {
  dispute_window_hours: 72,
  admin_list_page_size: 2,
  slot_release_buffer_weeks: 0,
  first_session_lead_hours: 24,
};
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(SETTINGS[key]);
  },
};
const log = { info: () => undefined } as unknown as Parameters<typeof createCompletion>[0]['log'];
const enrollments = createEnrollmentSide({ settings, now: () => AT });
// Completion reads the database's own clock (Q3); the record's dispute window reads AT.
const completion = createCompletion({ enrollments, settings, log });
const outages = createOutageServices({
  enrollments,
  completion,
  settings,
  log,
  clock: async () => AT,
  adminNames: async (_tx, ids) => new Map(ids.map((id) => [id, 'Probe administrator'])),
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
async function confirmed(): Promise<string> {
  const offer = await makeOffer(db);
  return insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, await makeUser(db)),
    status: 'confirmed',
    confirmed_at: CONFIRMED_AT,
  });
}

/** A committed session, the first of its enrollment, over `[startsAt, endsAt)`, with `values`. */
async function sessionOf(
  enrollmentId: string,
  startsAt: string,
  endsAt: string,
  values: Readonly<Record<string, unknown>>,
): Promise<string> {
  const { rows } = await db.query<{ student_user_id: string; teacher_user_id: string }>(
    'SELECT student_user_id, teacher_user_id FROM enrollments WHERE id = $1',
    [enrollmentId],
  );
  const [parties] = rows;
  if (parties === undefined) throw new Error('sessionOf: no enrollment');
  return insertRow(db, 'sessions', {
    enrollment_id: enrollmentId,
    teacher_user_id: parties.teacher_user_id,
    student_user_id: parties.student_user_id,
    sequence_number: 1,
    scheduled_date_local: startsAt.slice(0, 10),
    scheduled_start_time_local: startsAt.slice(11, 19),
    timezone: ZONE,
    scheduled_start_at: startsAt,
    scheduled_end_at: endsAt,
    ...values,
  });
}

/** D 10:00 to 11:30 in ZONE. */
const WINDOW = {
  start: { localDate: D, localTime: '10:00' },
  end: { localDate: D, localTime: '11:30' },
  timezone: ZONE,
  reason: 'انقطاع لدى مزود الفيديو',
};

async function sessionRows(tx: Transaction, ids: readonly string[]) {
  return tx.session.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { id: 'asc' },
    select: { id: true, status: true, remedy: { select: { id: true } } },
  });
}

describe('sessions.outages.record over the real tables (T016, FR-445, R-307)', () => {
  it('reclassifies the settled sessions inside their dispute window, a resolved one included, with one event each, and leaves the others', async () => {
    const admin = await makeAdmin(db);
    const enrollment = await confirmed();
    const other = await confirmed();
    // Inside the window and inside its dispute window.
    const done = await sessionOf(enrollment, utc(D, '10:30'), utc(D, '11:30'), { status: 'done' });
    // An administrator's resolution inside the window: settled, with no remedy yet (G1).
    const resolved = await sessionOf(other, utc(D, '10:00'), utc(D, '11:00'), {
      status: 'teacher_no_show',
      settled_by_admin_id: admin,
      admin_settled_at: utc(dayOf(1), '08:00'),
    });
    // Disputed: left as it is.
    const disputed = await sessionOf(await confirmed(), utc(D, '11:00'), utc(D, '12:00'), {
      status: 'disputed',
      outcome_under_dispute: 'student_no_show',
    });
    // Outside the window (it starts at its end).
    const after = await sessionOf(await confirmed(), utc(D, '11:30'), utc(D, '12:30'), {
      status: 'done',
    });
    await rolledBack(async (tx) => {
      const recorded = await outages.record(tx, admin, WINDOW);
      expect(recorded).toMatchObject({
        startsAt: iso(utc(D, '10:00')),
        endsAt: iso(utc(D, '11:30')),
        reclassified: 2,
      });
      const outage = await tx.providerOutage.findUniqueOrThrow({
        where: { id: recorded.outageId },
        select: { startsAt: true, endsAt: true, reason: true, recordedByAdminId: true },
      });
      expect(outage).toEqual({
        startsAt: new Date(utc(D, '10:00')),
        endsAt: new Date(utc(D, '11:30')),
        reason: WINDOW.reason,
        recordedByAdminId: admin,
      });
      const byId = new Map(
        (await sessionRows(tx, [done, resolved, disputed, after])).map((row) => [row.id, row]),
      );
      expect(byId.get(done)?.status).toBe('provider_outage');
      expect(byId.get(resolved)?.status).toBe('provider_outage');
      expect(byId.get(disputed)?.status).toBe('disputed');
      expect(byId.get(after)?.status).toBe('done');
      expect([...byId.values()].map(({ remedy }) => remedy)).toEqual([null, null, null, null]);
      const events = await tx.sessionEvent.findMany({
        where: { sessionId: { in: [done, resolved, disputed, after] } },
        orderBy: { sessionId: 'asc' },
        select: { sessionId: true, enrollmentId: true, kind: true, occurredAt: true },
      });
      expect(events).toEqual(
        [
          { sessionId: done, enrollmentId: enrollment, kind: 'outage_reclassified', occurredAt: AT },
          { sessionId: resolved, enrollmentId: other, kind: 'outage_reclassified', occurredAt: AT },
        ].sort((one, two) => (one.sessionId < two.sessionId ? -1 : 1)),
      );
      // Completion was checked and changed nothing: a session under review is not settled.
      const statuses = await tx.enrollment.findMany({
        where: { id: { in: [enrollment, other] } },
        select: { status: true },
      });
      expect(statuses).toEqual([{ status: 'confirmed' }, { status: 'confirmed' }]);
    });
  });

  it('leaves a session whose dispute window has closed, and a scheduled one, as they are', async () => {
    const admin = await makeAdmin(db);
    const C = dayOf(-5);
    const closed = await sessionOf(await confirmed(), utc(C, '08:00'), utc(C, '09:00'), {
      status: 'teacher_no_show',
    });
    const scheduled = await sessionOf(await confirmed(), utc(C, '08:30'), utc(C, '09:30'), {
      status: 'scheduled',
    });
    await rolledBack(async (tx) => {
      const recorded = await outages.record(tx, admin, {
        ...WINDOW,
        start: { localDate: C, localTime: '07:00' },
        end: { localDate: C, localTime: '12:00' },
      });
      expect(recorded.reclassified).toBe(0);
      const rows = await sessionRows(tx, [closed, scheduled]);
      expect(new Map(rows.map(({ id, status }) => [id, status]))).toEqual(
        new Map([
          [closed, 'teacher_no_show'],
          [scheduled, 'scheduled'],
        ]),
      );
      expect(
        await tx.sessionEvent.count({ where: { sessionId: { in: [closed, scheduled] } } }),
      ).toBe(0);
    });
  });

  it('refuses a window whose end is not after its start VALIDATION_FAILED, writing nothing', async () => {
    const admin = await makeAdmin(db);
    await rolledBack(async (tx) => {
      const before = await tx.providerOutage.count();
      await expect(outages.record(tx, admin, { ...WINDOW, end: WINDOW.start })).rejects.toMatchObject(
        { code: 'VALIDATION_FAILED' },
      );
      expect(await tx.providerOutage.count()).toBe(before);
    });
  });
});

describe('sessions.outages.list over the real tables (T016)', () => {
  it('lists the windows newest first, a page at a time, each with its recorder', async () => {
    const admin = await makeAdmin(db);
    await rolledBack(async (tx) => {
      const ids: string[] = [];
      for (const day of [dayOf(-8), dayOf(-7), dayOf(-6)]) {
        ids.push(
          (
            await outages.record(tx, admin, {
              ...WINDOW,
              start: { localDate: day, localTime: '03:00' },
              end: { localDate: day, localTime: '04:00' },
            })
          ).outageId,
        );
      }
      const first = await outages.list(tx, {});
      expect(first.items.map(({ outageId }) => outageId)).toEqual([ids[2], ids[1]]);
      expect(first.items[0]?.recordedBy).toEqual({
        adminId: admin,
        displayName: 'Probe administrator',
      });
      expect(first.nextCursor).toBe(ids[1]);
      const second = await outages.list(tx, { cursor: ids[1] });
      expect(second.items[0]?.outageId).toBe(ids[0]);
    });
  });
});
