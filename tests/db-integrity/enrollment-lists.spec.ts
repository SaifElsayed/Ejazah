// T049 — the lists over the real tables (FR-390 to FR-393, FR-395, M3): the service's functions with
// the store over booking's queries and the owners' entries (`enrollmentListsStore`), as `main.ts`
// binds it.
//
//   - a student sees their own enrollments and nothing of another student's; a teacher their own
//     students' and nothing of another teacher's, by list or by guessed id (NOT_FOUND);
//   - the active tab by next session, one awaiting payment after; the ended tab completed,
//     terminated, and cancelled after confirmation, never a checkout cancelled before it, newest
//     first, paged by enrollment id;
//   - upcoming, completed and remaining derived from the sessions (FR-392);
//   - the teacher's search folds the student's name in both tabs over the tab's own students only;
//   - «اليوم» is the teacher's local day in Cairo, the teacher's sessions only, by start.
//
// Every probe writes its rows on one transaction and rolls back (as booking-slots.spec.ts).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { addMinutes, dateColumnOf, timeColumnOf } from '../../packages/time/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  enrollmentListsStore,
  studentEnrollmentOf,
  studentEnrollmentsOf,
  teacherStudentOf,
  teacherStudentsOf,
  teacherTodayOf,
} from '../../apps/api/src/modules/booking/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';

let database: Database;

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const ROLLED_BACK = Symbol('rolled back');

/** Runs `probe` on one transaction and rolls back whatever it wrote. */
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

const CAIRO = 'Africa/Cairo';
/** Tuesday 2026-11-10 14:00 in Cairo (+02:00). */
const NOW = new Date('2026-11-10T12:00:00Z');
const store = enrollmentListsStore;
const clock = (pageSize = 20) => ({ now: NOW, pageSize });

type EnrollmentState =
  | 'pending_payment'
  | 'confirmed'
  | 'completed'
  | 'terminated_no_show'
  | 'cancelled before confirmation'
  | 'cancelled after confirmation';

/** Two teachers, three students of one gender, and enrollments in every state the tabs read. */
async function world(tx: Transaction) {
  async function person(displayName: string): Promise<string> {
    const { id } = await tx.user.create({
      data: {
        email: `probe-${randomUUID()}@example.invalid`,
        gender: 'female',
        dateOfBirth: new Date('2012-01-01T00:00:00Z'),
        displayName,
        preferredLanguage: 'ar',
        timezone: CAIRO,
        accountStatus: 'active',
      },
      select: { id: true },
    });
    return id;
  }
  async function teacher(displayName: string) {
    const id = await person(displayName);
    await tx.teacherProfile.create({
      data: {
        userId: id,
        bio: 'Probe',
        qualificationSummary: 'Probe',
        verificationStatus: 'approved',
        payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
      },
    });
    const { id: subjectId } = await tx.subject.create({
      data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
      select: { id: true },
    });
    const { id: packageId } = await tx.package.create({
      data: {
        teacherUserId: id,
        subjectId,
        sessionCount: 4,
        sessionDurationMinutes: 60,
        pricePiasters: 100_000n,
        isActive: true,
      },
      select: { id: true },
    });
    const { id: slotId } = await tx.availabilitySlot.create({
      data: {
        teacherUserId: id,
        dayOfWeek: 2,
        startTimeLocal: new Date('1970-01-01T14:00:00Z'),
        durationMinutes: 60,
        timezone: CAIRO,
        isActive: true,
      },
      select: { id: true },
    });
    return { id, subjectId, packageId, slotId };
  }
  type Teacher = Awaited<ReturnType<typeof teacher>>;
  async function enrollment(
    who: { student: string; teacher: Teacher },
    state: EnrollmentState,
  ): Promise<string> {
    const status =
      state === 'cancelled before confirmation' || state === 'cancelled after confirmation'
        ? 'cancelled'
        : state;
    const { id } = await tx.enrollment.create({
      data: {
        studentUserId: who.student,
        teacherUserId: who.teacher.id,
        packageId: who.teacher.packageId,
        slotId: who.teacher.slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: who.teacher.subjectId,
        snapshotSlotTimezone: CAIRO,
        snapshotTrack: 'ijazah_track',
        status,
        cancellationReason:
          state === 'cancelled before confirmation'
            ? 'checkout_abandoned'
            : state === 'cancelled after confirmation'
              ? 'admin'
              : null,
        confirmedAt:
          state === 'pending_payment' || state === 'cancelled before confirmation'
            ? null
            : new Date('2026-10-01T00:00:00Z'),
        purchasedAt: new Date('2026-10-01T00:00:00Z'),
        quotedFirstSessionLocalDate: new Date('2026-11-03T00:00:00Z'),
      },
      select: { id: true },
    });
    return id;
  }
  /** A session of 60 minutes at `startsAt`, its local fields written whole as text (R-TIME-1). */
  async function session(
    enrollmentId: string,
    parties: { student: string; teacher: Teacher },
    sequenceNumber: number,
    startsAt: string,
    status: 'scheduled' | 'done' = 'scheduled',
  ): Promise<void> {
    const start = new Date(startsAt);
    await tx.session.create({
      data: {
        enrollmentId,
        teacherUserId: parties.teacher.id,
        studentUserId: parties.student,
        sequenceNumber,
        scheduledDateLocal: dateColumnOf(startsAt.slice(0, 10)),
        scheduledStartTimeLocal: timeColumnOf(startsAt.slice(11, 19)),
        timezone: CAIRO,
        scheduledStartAt: start,
        scheduledEndAt: new Date(addMinutes(start, 60)),
        status,
      },
    });
  }

  const [t1, t2] = [await teacher('المعلمة الأولى'), await teacher('المعلمة الثانية')];
  const yusra = await person('يُسْرى عليّ');
  const zainab = await person('زينب حسن');
  const asmaa = await person('أسماء محمود');
  const ofYusra = { student: yusra, teacher: t1 };

  const later = await enrollment(ofYusra, 'confirmed');
  await session(later, ofYusra, 1, '2026-11-03T12:00:00.000Z', 'done');
  await session(later, ofYusra, 2, '2026-11-17T12:00:00.000Z');
  await session(later, ofYusra, 3, '2026-11-24T12:00:00.000Z');
  const sooner = await enrollment(ofYusra, 'confirmed');
  await session(sooner, ofYusra, 1, '2026-11-12T12:00:00.000Z');
  await session(sooner, ofYusra, 2, '2026-11-19T12:00:00.000Z');
  const awaiting = await enrollment(ofYusra, 'pending_payment');
  const completed = await enrollment(ofYusra, 'completed');
  await session(completed, ofYusra, 1, '2026-10-06T12:00:00.000Z', 'done');
  const abandoned = await enrollment(ofYusra, 'cancelled before confirmation');
  const cancelledLater = await enrollment(ofYusra, 'cancelled after confirmation');

  const ofZainab = { student: zainab, teacher: t1 };
  const zainabs = await enrollment(ofZainab, 'confirmed');
  await session(zainabs, ofZainab, 1, '2026-11-17T14:00:00.000Z');
  const ofZainabElsewhere = { student: zainab, teacher: t2 };
  const zainabsElsewhere = await enrollment(ofZainabElsewhere, 'confirmed');
  await session(zainabsElsewhere, ofZainabElsewhere, 1, '2026-11-17T16:00:00.000Z');
  const asmaas = await enrollment({ student: asmaa, teacher: t1 }, 'terminated_no_show');

  return {
    t1,
    t2,
    students: { yusra, zainab, asmaa },
    enrollments: {
      later,
      sooner,
      awaiting,
      completed,
      abandoned,
      cancelledLater,
      zainabs,
      zainabsElsewhere,
      asmaas,
    },
  };
}

const idsOf = (answer: { items: readonly { enrollmentId: string }[] }) =>
  answer.items.map(({ enrollmentId }) => enrollmentId);
const newestFirst = (ids: readonly string[]) => [...ids].sort().reverse();

async function expectNotFound(read: Promise<unknown>): Promise<void> {
  await expect(read).rejects.toEqual(new DomainError('NOT_FOUND'));
}

describe(
  'the student’s enrollments on the database (FR-390, FR-392)',
  { tags: ['database'] },
  () => {
    it('answers the active tab by next session, the one awaiting payment after, and nothing of another student’s', async () => {
      await rolledBack(async (tx) => {
        const { students, enrollments, t1 } = await world(tx);
        const active = await studentEnrollmentsOf(
          tx,
          store,
          students.yusra,
          { tab: 'active' },
          clock(),
        );
        expect(idsOf(active)).toEqual([
          enrollments.sooner,
          enrollments.later,
          enrollments.awaiting,
        ]);
        expect(active.nextCursor).toBeUndefined();
        const [, later] = active.items;
        expect(later).toMatchObject({
          teacher: { teacherId: t1.id, displayName: 'المعلمة الأولى' },
          status: 'confirmed',
          summary: { track: 'ijazah_track', sessionCount: 4, sessionDurationMinutes: 60 },
          next: {
            sequenceNumber: 2,
            localDate: '2026-11-17',
            startTimeLocal: '12:00',
            timezone: CAIRO,
            startsAt: '2026-11-17T12:00:00.000Z',
            endsAt: '2026-11-17T13:00:00.000Z',
            status: 'scheduled',
          },
          last: { sequenceNumber: 3 },
          upcoming: 2,
          completed: 1,
          remaining: 3,
        });

        const zainab = await studentEnrollmentsOf(
          tx,
          store,
          students.zainab,
          { tab: 'active' },
          clock(),
        );
        expect(idsOf(zainab).sort()).toEqual(
          [enrollments.zainabs, enrollments.zainabsElsewhere].sort(),
        );
      });
    });

    it('answers the ended tab newest first, never a checkout cancelled before confirmation, paged by id', async () => {
      await rolledBack(async (tx) => {
        const { students, enrollments } = await world(tx);
        const ended = [enrollments.completed, enrollments.cancelledLater];
        const all = await studentEnrollmentsOf(
          tx,
          store,
          students.yusra,
          { tab: 'ended' },
          clock(),
        );
        expect(idsOf(all)).toEqual(newestFirst(ended));
        expect(idsOf(all)).not.toContain(enrollments.abandoned);

        const first = await studentEnrollmentsOf(
          tx,
          store,
          students.yusra,
          { tab: 'ended' },
          clock(1),
        );
        expect(idsOf(first)).toEqual(newestFirst(ended).slice(0, 1));
        expect(first.nextCursor).toBe(newestFirst(ended)[0]);
        const second = await studentEnrollmentsOf(
          tx,
          store,
          students.yusra,
          { tab: 'ended', ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }) },
          clock(1),
        );
        expect(idsOf(second)).toEqual(newestFirst(ended).slice(1));
        expect(second.nextCursor).toBeUndefined();
      });
    });

    it('answers the student’s own enrollment with every session, and NOT_FOUND for another student’s or an abandoned checkout', async () => {
      await rolledBack(async (tx) => {
        const { students, enrollments } = await world(tx);
        const own = await studentEnrollmentOf(
          tx,
          store,
          students.yusra,
          { enrollmentId: enrollments.later },
          NOW,
        );
        expect(own.sessions.map(({ sequenceNumber, status }) => [sequenceNumber, status])).toEqual([
          [1, 'done'],
          [2, 'scheduled'],
          [3, 'scheduled'],
        ]);
        for (const enrollmentId of [enrollments.zainabs, enrollments.abandoned, randomUUID()]) {
          await expectNotFound(
            studentEnrollmentOf(tx, store, students.yusra, { enrollmentId }, NOW),
          );
        }
        await expectNotFound(
          studentEnrollmentOf(tx, store, students.zainab, { enrollmentId: enrollments.later }, NOW),
        );
      });
    });
  },
);

describe(
  'the teacher’s students on the database (FR-391, FR-392, FR-395)',
  { tags: ['database'] },
  () => {
    it('answers the teacher’s own confirmed students by next session, never one awaiting payment, nothing of another teacher’s', async () => {
      await rolledBack(async (tx) => {
        const { t1, t2, enrollments } = await world(tx);
        const active = await teacherStudentsOf(tx, store, t1.id, { tab: 'active' }, clock());
        expect(idsOf(active)).toEqual([enrollments.sooner, enrollments.later, enrollments.zainabs]);
        expect(active.items.map(({ student }) => student)).toEqual([
          { displayName: 'يُسْرى عليّ' },
          { displayName: 'يُسْرى عليّ' },
          { displayName: 'زينب حسن' },
        ]);
        const other = await teacherStudentsOf(tx, store, t2.id, { tab: 'active' }, clock());
        expect(idsOf(other)).toEqual([enrollments.zainabsElsewhere]);
      });
    });

    it('answers the ended tab: completed, terminated and cancelled after confirmation', async () => {
      await rolledBack(async (tx) => {
        const { t1, t2, enrollments } = await world(tx);
        const ended = await teacherStudentsOf(tx, store, t1.id, { tab: 'ended' }, clock());
        expect(idsOf(ended)).toEqual(
          newestFirst([enrollments.completed, enrollments.cancelledLater, enrollments.asmaas]),
        );
        expect(idsOf(await teacherStudentsOf(tx, store, t2.id, { tab: 'ended' }, clock()))).toEqual(
          [],
        );
      });
    });

    it('narrows both tabs by the student’s name folded on both sides, over the tab’s own students only', async () => {
      await rolledBack(async (tx) => {
        const { t1, t2, enrollments } = await world(tx);
        // Typed without the marks and with a plain alef: «يُسْرى عليّ» and «أسماء محمود» as stored.
        const active = await teacherStudentsOf(
          tx,
          store,
          t1.id,
          { tab: 'active', query: 'يسري' },
          clock(),
        );
        expect(idsOf(active)).toEqual([enrollments.sooner, enrollments.later]);
        const ended = await teacherStudentsOf(
          tx,
          store,
          t1.id,
          { tab: 'ended', query: 'اسماء' },
          clock(),
        );
        expect(idsOf(ended)).toEqual([enrollments.asmaas]);
        // Zainab is the other teacher's student too: her name finds nothing of that teacher's here.
        const zainabEnded = await teacherStudentsOf(
          tx,
          store,
          t1.id,
          { tab: 'ended', query: 'زينب' },
          clock(),
        );
        expect(idsOf(zainabEnded)).toEqual([]);
        const elsewhere = await teacherStudentsOf(
          tx,
          store,
          t2.id,
          { tab: 'active', query: 'يسري' },
          clock(),
        );
        expect(idsOf(elsewhere)).toEqual([]);
      });
    });

    it('answers the teacher’s own enrollment, the student by name alone, and NOT_FOUND for another teacher’s or one awaiting payment', async () => {
      await rolledBack(async (tx) => {
        const { t1, t2, enrollments } = await world(tx);
        const own = await teacherStudentOf(
          tx,
          store,
          t1.id,
          { enrollmentId: enrollments.later },
          NOW,
        );
        expect(Object.keys(own.student)).toEqual(['displayName']);
        expect(own.sessions).toHaveLength(3);
        for (const enrollmentId of [
          enrollments.zainabsElsewhere,
          enrollments.awaiting,
          enrollments.abandoned,
          randomUUID(),
        ]) {
          await expectNotFound(teacherStudentOf(tx, store, t1.id, { enrollmentId }, NOW));
        }
        await expectNotFound(
          teacherStudentOf(tx, store, t2.id, { enrollmentId: enrollments.later }, NOW),
        );
      });
    });

    it('answers «اليوم»: the teacher’s sessions of Cairo’s 17 November by start, no other teacher’s', async () => {
      await rolledBack(async (tx) => {
        const { t1, t2, enrollments } = await world(tx);
        const morning = new Date('2026-11-17T06:00:00Z');
        const today = await teacherTodayOf(tx, store, t1.id, morning);
        expect(today.localDate).toBe('2026-11-17');
        expect(today.timezone).toBe(CAIRO);
        expect(
          today.sessions.map(({ enrollmentId, student, sequenceNumber }) => [
            enrollmentId,
            student.displayName,
            sequenceNumber,
          ]),
        ).toEqual([
          [enrollments.later, 'يُسْرى عليّ', 2],
          [enrollments.zainabs, 'زينب حسن', 1],
        ]);
        const other = await teacherTodayOf(tx, store, t2.id, morning);
        expect(other.sessions.map(({ enrollmentId }) => enrollmentId)).toEqual([
          enrollments.zainabsElsewhere,
        ]);
      });
    });
  },
);
