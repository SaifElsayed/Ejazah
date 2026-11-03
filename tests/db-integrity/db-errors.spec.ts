// T006 — the kernel names the database's refusals, against Postgres, as Prisma 7 and
// `@prisma/adapter-pg` hand them to a caller (contracts/kernel.md, research R-210, R-215). The confirm
// job (T039) takes its refusal branch on exactly four refusals and rethrows anything else:
// `slot_holds_slot_id_active_key` and `slot_holds_student_user_id_active_key` (a second active hold,
// ERD §15 rule 17), and `sessions_teacher_no_overlap` and `sessions_student_no_overlap` (an
// overlapping session, rule 19). The re-resolution job (R-210) defers the two exclusions, so a
// uniform shift of back-to-back sessions commits and only a true overlap is refused, at commit.
//
// WHY HERE, NOT BESIDE THE KERNEL. A kernel spec may not write booking's or sessions' rows (R-API-6,
// `api/table-ownership`), as `row-lock.spec.ts` says; the shapes without a database are
// `apps/api/src/platform/db/db-errors.spec.ts`.
//
// HOW THE ROWS ARE WRITTEN. The refused writes go through the API's own client (`openDatabase`), in
// its interactive transactions, so each error is the one a repository sees: a model write's, and the
// commit's for a deferred constraint. That client's connection cannot see another transaction's
// uncommitted rows, so the parents (users, offers, enrollments) are committed through the
// application role, and removed after the suite by the OWNER role, the only role that may delete a
// user, an enrollment or a session (T065), as `booking-concurrency.spec.ts` does.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type ExclusionConstraint,
  isExclusionViolation,
  isUniqueViolation,
  type UniqueConstraint,
} from '../../apps/api/src/platform/db/db-errors.js';
import { withDeferredSessionConstraints } from '../../apps/api/src/platform/db/deferred-constraints.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeOffer,
  makeUser,
} from './harness';

type Offer = Awaited<ReturnType<typeof makeOffer>>;

interface Enrolled {
  readonly enrollmentId: string;
  readonly teacherId: string;
  readonly studentId: string;
}

const UNIQUE: readonly UniqueConstraint[] = [
  'slot_holds_slot_id_active_key',
  'slot_holds_student_user_id_active_key',
];
const EXCLUSION: readonly ExclusionConstraint[] = [
  'sessions_teacher_no_overlap',
  'sessions_student_no_overlap',
];

// The database never compares a hold with the clock: a NULL `released_at` is what makes it active.
const HOLD_EXPIRES_AT = new Date('2026-10-04T09:15:00Z');

let setup: Db;
let database: Database;
const users: string[] = [];
const subjects: string[] = [];

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
  if (users.length === 0 && subjects.length === 0) return;
  const owner = new pg.Client({
    connectionString: specDatabaseUrl('DATABASE_URL_OWNER'),
    connectionTimeoutMillis: 5_000,
  });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await owner.query(
      'DELETE FROM "sessions" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
      [users],
    );
    await owner.query('DELETE FROM "slot_holds" WHERE student_user_id = ANY($1)', [users]);
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

/** A teacher's offer, committed and recorded for removal. */
async function committedOffer(): Promise<Offer> {
  const offer = await makeOffer(setup);
  users.push(offer.teacherId);
  subjects.push(offer.subjectId);
  return offer;
}

/** The slot and package a hold of the offer names (B29: a hold records its package and count). */
function heldFor(offer: Offer): { slotId: string; packageId: string; sessionCount: number } {
  return { slotId: offer.slotId, packageId: offer.packageId, sessionCount: 4 };
}

/** A student, committed and recorded for removal. */
async function committedStudent(): Promise<string> {
  const id = await makeUser(setup);
  users.push(id);
  return id;
}

/** One enrollment between `studentId` and the offer's teacher, committed. */
async function committedEnrollment(offer: Offer, studentId: string): Promise<Enrolled> {
  const enrollmentId = await insertRow(setup, 'enrollments', enrollmentValues(offer, studentId));
  return { enrollmentId, teacherId: offer.teacherId, studentId };
}

/**
 * The probe day's UTC instants, each written whole as text: only packages/time computes a session's
 * datetime (R-TIME-1), and an instant on one fixed UTC day needs none.
 */
const AT = {
  '09:00': '2026-10-04T09:00:00Z',
  '09:30': '2026-10-04T09:30:00Z',
  '10:00': '2026-10-04T10:00:00Z',
  '10:30': '2026-10-04T10:30:00Z',
  '11:00': '2026-10-04T11:00:00Z',
  '12:00': '2026-10-04T12:00:00Z',
} as const;
type Clock = keyof typeof AT;

/** The columns of session `sequenceNumber` of `enrollment` from `start` to `end` on the probe day. */
function sessionData(enrollment: Enrolled, sequenceNumber: number, start: Clock, end: Clock) {
  return {
    enrollmentId: enrollment.enrollmentId,
    teacherUserId: enrollment.teacherId,
    studentUserId: enrollment.studentId,
    sequenceNumber,
    scheduledDateLocal: new Date('2026-10-04T00:00:00Z'),
    // The local fields are not what the exclusions compare; one fixed wall time serves every row.
    scheduledStartTimeLocal: new Date('1970-01-01T09:00:00Z'),
    timezone: 'UTC',
    scheduledStartAt: new Date(AT[start]),
    scheduledEndAt: new Date(AT[end]),
    status: 'scheduled' as const,
  };
}

/** What `work` threw in one transaction of the API's client; fails the probe if it committed. */
async function refusal(work: (tx: Transaction) => Promise<unknown>): Promise<unknown> {
  try {
    await database.$transaction(async (tx) => {
      await work(tx);
    });
  } catch (error: unknown) {
    return error;
  }
  throw new Error('the transaction committed; the probe expected a refusal');
}

/** Which of the four refusals `error` is named as: exactly one for each refusal T006 names. */
function namedAs(error: unknown): string[] {
  return [
    ...UNIQUE.filter((name) => isUniqueViolation(error, name)),
    ...EXCLUSION.filter((name) => isExclusionViolation(error, name)),
  ];
}

describe('the four refusals, each named exactly (T006, R-215)', () => {
  it('a second active hold of one slot is slot_holds_slot_id_active_key', async () => {
    const offer = await committedOffer();
    const [first, second] = await Promise.all([committedStudent(), committedStudent()]);
    const error = await refusal(async (tx) => {
      await tx.slotHold.create({
        data: { ...heldFor(offer), studentUserId: first, expiresAt: HOLD_EXPIRES_AT },
      });
      await tx.slotHold.create({
        data: { ...heldFor(offer), studentUserId: second, expiresAt: HOLD_EXPIRES_AT },
      });
    });
    expect(namedAs(error)).toEqual(['slot_holds_slot_id_active_key']);
  });

  it('a second active hold of one student is slot_holds_student_user_id_active_key', async () => {
    const [one, other] = await Promise.all([committedOffer(), committedOffer()]);
    const student = await committedStudent();
    const error = await refusal(async (tx) => {
      await tx.slotHold.create({
        data: { ...heldFor(one), studentUserId: student, expiresAt: HOLD_EXPIRES_AT },
      });
      await tx.slotHold.create({
        data: { ...heldFor(other), studentUserId: student, expiresAt: HOLD_EXPIRES_AT },
      });
    });
    expect(namedAs(error)).toEqual(['slot_holds_student_user_id_active_key']);
  });

  it('an overlapping session of one teacher is sessions_teacher_no_overlap', async () => {
    const offer = await committedOffer();
    const [first, second] = await Promise.all([
      committedEnrollment(offer, await committedStudent()),
      committedEnrollment(offer, await committedStudent()),
    ]);
    const error = await refusal(async (tx) => {
      await tx.session.create({ data: sessionData(first, 1, '09:00', '10:00') });
      await tx.session.create({ data: sessionData(second, 1, '09:30', '10:30') });
    });
    expect(namedAs(error)).toEqual(['sessions_teacher_no_overlap']);
  });

  it('an overlapping session of one student is sessions_student_no_overlap', async () => {
    const [one, other] = await Promise.all([committedOffer(), committedOffer()]);
    const student = await committedStudent();
    const [first, second] = await Promise.all([
      committedEnrollment(one, student),
      committedEnrollment(other, student),
    ]);
    const error = await refusal(async (tx) => {
      await tx.session.createMany({
        data: [sessionData(first, 1, '09:00', '10:00'), sessionData(second, 1, '09:30', '10:30')],
      });
    });
    expect(namedAs(error)).toEqual(['sessions_student_no_overlap']);
  });
});

describe('anything else is none of the four, so the caller rethrows it (T006)', () => {
  it('a unique violation on another constraint of sessions', async () => {
    const offer = await committedOffer();
    const enrollment = await committedEnrollment(offer, await committedStudent());
    const error = await refusal(async (tx) => {
      await tx.session.create({ data: sessionData(enrollment, 1, '09:00', '10:00') });
      await tx.session.create({ data: sessionData(enrollment, 1, '11:00', '12:00') });
    });
    expect(namedAs(error)).toEqual([]);
  });

  it('a foreign key refusal on slot_holds', async () => {
    const student = await committedStudent();
    const offer = await committedOffer();
    const error = await refusal((tx) =>
      tx.slotHold.create({
        data: {
          slotId: '0199d0a0-0000-7000-8000-000000000001',
          packageId: offer.packageId,
          sessionCount: 4,
          studentUserId: student,
          expiresAt: HOLD_EXPIRES_AT,
        },
      }),
    );
    expect(namedAs(error)).toEqual([]);
  });

  it('an error the work threw itself', async () => {
    const error = await refusal(() => Promise.reject(new Error('sessions_teacher_no_overlap')));
    expect(namedAs(error)).toEqual([]);
  });
});

describe('withDeferredSessionConstraints (T006, R-210, ERD §15 rule 19)', () => {
  /** Two back-to-back sessions of one teacher, 09:00–10:00 and 10:00–11:00, committed. */
  async function backToBack(): Promise<{ readonly ids: readonly [string, string] }> {
    const offer = await committedOffer();
    const [first, second] = await Promise.all([
      committedEnrollment(offer, await committedStudent()),
      committedEnrollment(offer, await committedStudent()),
    ]);
    const [a, b] = await database.$transaction((tx) =>
      Promise.all([
        tx.session.create({ data: sessionData(first, 1, '09:00', '10:00'), select: { id: true } }),
        tx.session.create({ data: sessionData(second, 1, '10:00', '11:00'), select: { id: true } }),
      ]),
    );
    return { ids: [a.id, b.id] };
  }

  /** Moves both sessions an hour later, the earlier first: it overlaps the later until that moves. */
  async function shift(
    tx: Transaction,
    [earlier, later]: readonly [string, string],
  ): Promise<void> {
    await tx.session.update({
      where: { id: earlier },
      data: {
        scheduledStartAt: new Date(AT['10:00']),
        scheduledEndAt: new Date(AT['11:00']),
      },
    });
    await tx.session.update({
      where: { id: later },
      data: {
        scheduledStartAt: new Date(AT['11:00']),
        scheduledEndAt: new Date(AT['12:00']),
      },
    });
  }

  it('without it, the first move of a uniform shift is refused at once', async () => {
    const { ids } = await backToBack();
    expect(namedAs(await refusal((tx) => shift(tx, ids)))).toEqual(['sessions_teacher_no_overlap']);
  });

  it('with it, a uniform shift of back-to-back sessions commits', async () => {
    const { ids } = await backToBack();
    await database.$transaction(async (tx) => {
      await withDeferredSessionConstraints(tx);
      await shift(tx, ids);
    });
    const moved = await database.session.findMany({
      where: { id: { in: [...ids] } },
      orderBy: { scheduledStartAt: 'asc' },
      select: { id: true, scheduledStartAt: true },
    });
    expect(moved.map(({ scheduledStartAt }) => scheduledStartAt.toISOString())).toEqual([
      '2026-10-04T10:00:00.000Z',
      '2026-10-04T11:00:00.000Z',
    ]);
  });

  it('with it, a true overlap of one teacher is refused at commit and named', async () => {
    const offer = await committedOffer();
    const [first, second] = await Promise.all([
      committedEnrollment(offer, await committedStudent()),
      committedEnrollment(offer, await committedStudent()),
    ]);
    let written = 0;
    const error = await refusal(async (tx) => {
      await withDeferredSessionConstraints(tx);
      await tx.session.create({ data: sessionData(first, 1, '09:00', '10:00') });
      await tx.session.create({ data: sessionData(second, 1, '09:30', '10:30') });
      written = 2;
    });
    expect(written).toBe(2);
    expect(namedAs(error)).toEqual(['sessions_teacher_no_overlap']);
  });

  it('with it, a true overlap of one student is refused at commit and named', async () => {
    const [one, other] = await Promise.all([committedOffer(), committedOffer()]);
    const student = await committedStudent();
    const [first, second] = await Promise.all([
      committedEnrollment(one, student),
      committedEnrollment(other, student),
    ]);
    const error = await refusal(async (tx) => {
      await withDeferredSessionConstraints(tx);
      await tx.session.create({ data: sessionData(first, 1, '09:00', '10:00') });
      await tx.session.create({ data: sessionData(second, 1, '09:30', '10:30') });
    });
    expect(namedAs(error)).toEqual(['sessions_student_no_overlap']);
  });

  it('defers only the session exclusions: a second active hold is still refused at once', async () => {
    const offer = await committedOffer();
    const [first, second] = await Promise.all([committedStudent(), committedStudent()]);
    let reached = false;
    const error = await refusal(async (tx) => {
      await withDeferredSessionConstraints(tx);
      await tx.slotHold.create({
        data: { ...heldFor(offer), studentUserId: first, expiresAt: HOLD_EXPIRES_AT },
      });
      await tx.slotHold.create({
        data: { ...heldFor(offer), studentUserId: second, expiresAt: HOLD_EXPIRES_AT },
      });
      reached = true;
    });
    expect(reached).toBe(false);
    expect(namedAs(error)).toEqual(['slot_holds_slot_id_active_key']);
  });
});
