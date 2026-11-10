// T024 of specs/004-sessions/tasks.md — the enrollment and session monitor over the real tables as
// the application role (FR-479, FR-451, FR-439, FR-497; R-API-6; research R-323 GAP-1 and GAP-4;
// contracts/admin-surface.md, `sessions.monitor.list/get`), the store over sessions' queries and the
// owners' entries as the admin module composes it:
//
//   - the list reads booking's enrollments through `EnrollmentSide.enrollmentPage`, the dates turned
//     into enrollment ids from sessions' own table, and a student's name matched by its folded prefix
//     (R-203) over the batch's own parties;
//   - the detail reads the sessions with their remedy (its proposal at the enrollment's slot's
//     start, its counter-proposal's answer deadline), the session ever disputed through moderation's
//     entry (not correctable), the compensation cases, the requests with their requester's side, and
//     the timeline's session rows newest first.
//
// The parents (the accounts, the offer, the enrollments) are committed by the harness, each run with
// its own; the sessions and every row under them are written on a transaction this file rolls back,
// on dates of this run's own (`RUN_OFFSET`), so the date filter finds no other run's sessions.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomInt, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEnrollmentSide } from '../../apps/api/src/modules/booking/index.js';
import { createSessionsMonitor } from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  addDays,
  addHours,
  addMinutes,
  dateColumnOf,
  resolveLocalDateTime,
  timeColumnOf,
} from '../../packages/time/src/index.js';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeAdmin,
  makeOffer,
  makeUser,
} from './harness';

const CAIRO = 'Africa/Cairo';
/**
 * This run's own days: from 2050-01-02 (a Sunday) plus a random number of weeks, apart from the
 * days other specs commit sessions on (`outages.spec.ts` 2028 to 2036, `outage-evaluation-race.spec.ts`
 * 2040 to 2048; the follow-up under T024 of B37's integration).
 */
const RUN_OFFSET = randomInt(0, 300) * 7;
const dayOf = (offset: number): string =>
  addDays(new Date('2050-01-02T00:00:00Z'), RUN_OFFSET + offset).slice(0, 10);
const instant = (day: string, time: string): Date =>
  new Date(resolveLocalDateTime({ localDate: day, localTime: time, timezone: CAIRO }).startsAt);

let db: Db;
let database: Database;

const SETTINGS: Readonly<Record<string, number>> = {
  admin_list_page_size: 25,
  repeated_absence_flag_count: 5,
  dispute_window_hours: 72,
  enrollment_restore_window_days: 7,
  slot_release_buffer_weeks: 0,
  first_session_lead_hours: 24,
};
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(SETTINGS[key]);
  },
};
const monitor = createSessionsMonitor({
  enrollments: createEnrollmentSide({ settings }),
  settings,
  log: { info: () => undefined } as unknown as Parameters<typeof createSessionsMonitor>[0]['log'],
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

/** The committed parents: two students of one teacher, each with a confirmed enrollment. */
async function parents() {
  const token = randomUUID().slice(0, 8);
  const offer = await makeOffer(db);
  await db.query('UPDATE users SET display_name = $1 WHERE id = $2', [
    `سارة-${token}`,
    offer.teacherId,
  ]);
  const amal = await makeUser(db, { display_name: `آمال-${token}` });
  const huda = await makeUser(db, { display_name: `هدى-${token}` });
  const enrollment = (studentId: string) =>
    insertRow(db, 'enrollments', {
      ...enrollmentValues(offer, studentId),
      status: 'confirmed',
      confirmed_at: '2026-10-04T07:01:00Z',
    });
  const amals = await enrollment(amal);
  const hudas = await enrollment(huda);
  return { token, offer, amal, huda, amals, hudas, admin: await makeAdmin(db) };
}

type World = Awaited<ReturnType<typeof parents>>;

/** A session of the enrollment on `day` at `time` in Cairo, sixty minutes, with `status`. */
async function session(
  tx: Transaction,
  w: World,
  enrollmentId: string,
  studentUserId: string,
  sequenceNumber: number,
  day: string,
  time: string,
  status: 'scheduled' | 'done' | 'teacher_no_show',
  makeupForSessionId?: string,
): Promise<string> {
  const startsAt = instant(day, time);
  const { id } = await tx.session.create({
    data: {
      enrollmentId,
      teacherUserId: w.offer.teacherId,
      studentUserId,
      sequenceNumber,
      scheduledDateLocal: dateColumnOf(day),
      scheduledStartTimeLocal: timeColumnOf(time),
      timezone: CAIRO,
      scheduledStartAt: startsAt,
      scheduledEndAt: new Date(addMinutes(startsAt, 60)),
      status,
      ...(makeupForSessionId === undefined ? {} : { makeupForSessionId }),
    },
    select: { id: true },
  });
  return id;
}

describe(`sessions.monitor over the real tables (T024, FR-479), RUN_OFFSET ${RUN_OFFSET}`, () => {
  it('lists the enrollments with sessions in the dates, and a student by the folded prefix of her name', async () => {
    const w = await parents();
    await rolledBack(async (tx) => {
      await session(tx, w, w.amals, w.amal, 1, dayOf(0), '09:00:00', 'scheduled');
      await session(tx, w, w.hudas, w.huda, 1, dayOf(7), '11:00:00', 'scheduled');
      const range = { from: dayOf(0), to: dayOf(13) };
      const both = await monitor.list(tx, w.admin, range);
      expect(both.items.map(({ enrollmentId }) => enrollmentId)).toEqual([w.hudas, w.amals]);
      expect(both.items[1]).toMatchObject({
        student: { userId: w.amal, displayName: `آمال-${w.token}`, deleted: false },
        teacher: { userId: w.offer.teacherId, displayName: `سارة-${w.token}`, deleted: false },
        status: 'confirmed',
        sessionCount: 4,
        completed: 0,
        remaining: 4,
        teacherNoShows: 0,
        repeatedAbsence: false,
        nextSession: { localDate: dayOf(0), startTimeLocal: '09:00', timezone: CAIRO },
      });
      // «امال» folds as «آمال» does (R-203); Huda is not matched.
      const amal = await monitor.list(tx, w.admin, { ...range, student: 'امال' });
      expect(amal.items.map(({ enrollmentId }) => enrollmentId)).toEqual([w.amals]);
      expect((await monitor.list(tx, w.admin, { from: dayOf(14), to: dayOf(20) })).items).toEqual(
        [],
      );
    });
  });

  it('answers an enrollment’s sessions with their remedy, a disputed one not correctable, its cases, requests and session events', async () => {
    const w = await parents();
    await rolledBack(async (tx) => {
      const first = await session(tx, w, w.amals, w.amal, 1, dayOf(0), '09:00:00', 'done');
      const absent = await session(tx, w, w.amals, w.amal, 2, dayOf(7), '09:00:00', 'teacher_no_show');
      const next = await session(tx, w, w.amals, w.amal, 3, dayOf(14), '09:00:00', 'scheduled');
      // A make-up of the absence, its original named by its sequence number.
      const makeup = await session(
        tx,
        w,
        w.amals,
        w.amal,
        4,
        dayOf(35),
        '09:00:00',
        'scheduled',
        absent,
      );
      const proposedAt = instant(dayOf(9), '10:00:00');
      await tx.sessionRemedy.create({
        data: {
          sessionId: absent,
          kind: 'makeup',
          status: 'counter_proposed',
          offeredAt: instant(dayOf(8), '10:00:00'),
          choiceClosesAt: instant(dayOf(15), '10:00:00'),
          snapshotAnswerWindowHours: 72,
          snapshotFirstSessionLeadHours: 24,
          proposedDate: dateColumnOf(dayOf(28)),
          counterSlotId: w.offer.slotId,
          counterDate: dateColumnOf(dayOf(21)),
          counterStartTimeLocal: timeColumnOf('18:00:00'),
          counterTimezone: CAIRO,
          counterProposedAt: proposedAt,
        },
      });
      // The first session's dispute, resolved: ever disputed, so its outcome is not corrected.
      await tx.dispute.create({
        data: {
          enrollmentId: w.amals,
          sessionId: first,
          kind: 'session_dispute',
          raisedByUserId: w.amal,
          reason: 'probe',
          status: 'resolved',
          resolution: 'upheld',
          resolutionNotes: 'probe',
          resolvedByAdminId: w.admin,
          resolvedAt: instant(dayOf(2), '10:00:00'),
        },
      });
      const { id: caseId } = await tx.dispute.create({
        data: {
          enrollmentId: w.amals,
          kind: 'compensation_case',
          reason: 'admin_cancellation',
          status: 'open',
        },
        select: { id: true },
      });
      const { id: requestId } = await tx.cancellationRequest.create({
        data: {
          sessionId: next,
          requestedByUserId: w.offer.teacherId,
          reason: 'سفر',
          status: 'pending',
        },
        select: { id: true },
      });
      await tx.sessionEvent.createMany({
        data: [
          {
            enrollmentId: w.amals,
            sessionId: first,
            kind: 'settled',
            occurredAt: instant(dayOf(0), '10:02:00'),
          },
          {
            enrollmentId: w.amals,
            sessionId: absent,
            kind: 'remedy_offered',
            occurredAt: instant(dayOf(8), '10:00:00'),
          },
        ],
      });

      const answer = await monitor.get(tx, w.admin, { enrollmentId: w.amals });
      expect(answer.enrollment).toMatchObject({
        enrollmentId: w.amals,
        completed: 1,
        remaining: 3,
        teacherNoShows: 1,
        repeatedAbsence: false,
      });
      expect(answer.enrollment).not.toHaveProperty('restorableUntil');
      expect(
        answer.sessions.map(({ sessionId, status, cancellable, correctable }) => [
          sessionId,
          status,
          cancellable,
          correctable,
        ]),
      ).toEqual([
        [first, 'done', false, false],
        [absent, 'teacher_no_show', false, false],
        [next, 'scheduled', true, false],
        [makeup, 'scheduled', true, false],
      ]);
      expect(answer.sessions[3]?.makeupFor).toEqual({ sessionId: absent, sequenceNumber: 2 });
      expect(answer.sessions[2]).not.toHaveProperty('makeupFor');
      expect(answer.sessions[1]?.remedy).toMatchObject({
        status: 'counter_proposed',
        // The enrollment's slot starts at 09:00 in Cairo (the harness's offer).
        proposal: { localDate: dayOf(28), startTimeLocal: '09:00', timezone: CAIRO },
        counter: {
          localDate: dayOf(21),
          startTimeLocal: '18:00',
          timezone: CAIRO,
          proposedAt: proposedAt.toISOString(),
          answerClosesAt: new Date(addHours(proposedAt, 72)).toISOString(),
        },
      });
      expect(answer.cases).toEqual([{ caseId, reason: 'admin_cancellation', status: 'open' }]);
      expect(answer.cancellationRequests).toMatchObject([
        { requestId, sessionId: next, requestedBy: 'teacher', reason: 'سفر', status: 'pending' },
      ]);
      expect(answer.events.map(({ source, kind, sessionId }) => [source, kind, sessionId])).toEqual([
        ['session', 'remedy_offered', absent],
        ['session', 'settled', first],
      ]);
    });
  });
});
