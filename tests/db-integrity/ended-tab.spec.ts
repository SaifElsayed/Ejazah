// T046 (FR-495; contracts/app-surface.md, "Phase 2's lists, widened additively"): the ended tab of
// both roles over the real tables, as `enrollment-lists.repository.ts`'s two predicates read it
// (`endedEnrollmentPage`, the list; `endedStudentIdsOf`, the teacher's search's candidates).
//
//   - `enrollments.list` tab `ended` (the student's), `teacher.students.list` tab `ended` (the
//     teacher's) and that tab searched by the student's name each hold an enrollment `completed`,
//     one `terminated_no_show`, and one `cancelled` once confirmed for each reason Phase 3 ends an
//     enrollment with (`admin`, `teacher_suspended`, `account_deleted`);
//   - none of the three holds an enrollment `cancelled` and never confirmed, whatever its reason:
//     Phase 2's four (a checkout abandoned, expired, failed, or refused at confirmation) and Phase
//     3's three, which end one awaiting payment too.
//
// Each enrollment is a student of its own, so each student's tab and the teacher's search by that
// student's name read that one row. Every probe writes its rows on one transaction and rolls back
// (as enrollment-lists.spec.ts).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  enrollmentListsStore,
  type EnrollmentListsStore,
  studentEnrollmentsOf,
  teacherStudentsOf,
} from '../../apps/api/src/modules/booking/index.js';
import type { WindowDays } from '../../apps/api/src/modules/sessions/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';

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
const NOW = new Date('2026-11-10T12:00:00Z');
// 005:T006 (rule d): the enrollment reads' ijazah request through a stand-in port, none held.
const store: EnrollmentListsStore = {
  ...enrollmentListsStore,
  ijazahRequestsOf: async () => new Map(),
};
// 004:T074 (rule d): the restore windows the lists read for `paused`, the seed's 14 days.
const WINDOWS: WindowDays = async () => 14;
const clock = { now: NOW, pageSize: 20 };

type CancellationReason =
  | 'payment_expired'
  | 'payment_failed'
  | 'admin'
  | 'teacher_suspended'
  | 'slot_unavailable'
  | 'checkout_abandoned'
  | 'account_deleted';

interface EndedCase {
  readonly name: string;
  readonly status: 'completed' | 'terminated_no_show' | 'cancelled';
  readonly reason: CancellationReason | null;
  /** The student's name, whose first letter no other student's shares. */
  readonly student: string;
}

/** What ran and stopped: on the ended tab of both roles. */
const ENDED: readonly EndedCase[] = [
  { name: 'completed', status: 'completed', reason: null, student: 'سلمى' },
  { name: 'terminated_no_show', status: 'terminated_no_show', reason: null, student: 'رحاب' },
  {
    name: 'cancelled once confirmed (admin)',
    status: 'cancelled',
    reason: 'admin',
    student: 'دعاء',
  },
  {
    name: 'cancelled once confirmed (teacher_suspended)',
    status: 'cancelled',
    reason: 'teacher_suspended',
    student: 'غادة',
  },
  {
    name: 'cancelled once confirmed (account_deleted)',
    status: 'cancelled',
    reason: 'account_deleted',
    student: 'منى',
  },
];

/** Cancelled and never confirmed: on no one's tab (FR-380 to FR-386 answer it). */
const NEVER_CONFIRMED: readonly { reason: CancellationReason; student: string }[] = [
  { reason: 'checkout_abandoned', student: 'هالة' },
  { reason: 'payment_expired', student: 'وفاء' },
  { reason: 'payment_failed', student: 'بسمة' },
  { reason: 'slot_unavailable', student: 'جنى' },
  { reason: 'admin', student: 'لمياء' },
  { reason: 'teacher_suspended', student: 'شهد' },
  { reason: 'account_deleted', student: 'تسنيم' },
];

/** One teacher, and one student of their own per enrollment, ended or never confirmed. */
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
  const teacherId = await person('المعلمة');
  await tx.teacherProfile.create({
    data: {
      userId: teacherId,
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
      teacherUserId: teacherId,
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
      teacherUserId: teacherId,
      dayOfWeek: 2,
      startTimeLocal: new Date('1970-01-01T14:00:00Z'),
      durationMinutes: 60,
      timezone: CAIRO,
      isActive: true,
    },
    select: { id: true },
  });

  async function enrollment(
    studentUserId: string,
    status: EndedCase['status'],
    reason: CancellationReason | null,
    confirmedAt: Date | null,
  ): Promise<string> {
    const { id } = await tx.enrollment.create({
      data: {
        studentUserId,
        teacherUserId: teacherId,
        packageId,
        slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: subjectId,
        snapshotSlotTimezone: CAIRO,
        snapshotTrack: 'recitation',
        status,
        cancellationReason: reason,
        confirmedAt,
        purchasedAt: new Date('2026-10-01T00:00:00Z'),
        quotedFirstSessionLocalDate: new Date('2026-10-06T00:00:00Z'),
      },
      select: { id: true },
    });
    return id;
  }

  const ended = new Map<string, { studentUserId: string; enrollmentId: string }>();
  for (const one of ENDED) {
    const studentUserId = await person(one.student);
    const enrollmentId = await enrollment(
      studentUserId,
      one.status,
      one.reason,
      new Date('2026-10-01T00:00:00Z'),
    );
    ended.set(one.name, { studentUserId, enrollmentId });
  }
  const neverConfirmed: { student: string; studentUserId: string; enrollmentId: string }[] = [];
  for (const one of NEVER_CONFIRMED) {
    const studentUserId = await person(one.student);
    const enrollmentId = await enrollment(studentUserId, 'cancelled', one.reason, null);
    neverConfirmed.push({ student: one.student, studentUserId, enrollmentId });
  }
  return { teacherId, ended, neverConfirmed };
}

function endedOf(
  made: Awaited<ReturnType<typeof world>>,
  name: string,
): { studentUserId: string; enrollmentId: string } {
  const found = made.ended.get(name);
  if (found === undefined) throw new Error(`no enrollment ${name}`);
  return found;
}

const statusById = (answer: { items: readonly { enrollmentId: string; status: string }[] }) =>
  answer.items.map(({ enrollmentId, status }) => [enrollmentId, status]);

describe(
  'the ended tab of both roles on the database (T046, FR-495)',
  { tags: ['database'] },
  () => {
    it.each(ENDED)('the student’s ended tab holds an enrollment $name', async (one) => {
      await rolledBack(async (tx) => {
        const made = await world(tx);
        const { studentUserId, enrollmentId } = endedOf(made, one.name);
        const answer = await studentEnrollmentsOf(
          tx,
          store,
          studentUserId,
          { tab: 'ended' },
          clock,
          WINDOWS,
        );
        expect(statusById(answer)).toEqual([[enrollmentId, one.status]]);
      });
    });

    it.each(ENDED)('the teacher’s ended tab holds an enrollment $name', async (one) => {
      await rolledBack(async (tx) => {
        const made = await world(tx);
        const { enrollmentId } = endedOf(made, one.name);
        const answer = await teacherStudentsOf(
          tx,
          store,
          made.teacherId,
          { tab: 'ended' },
          clock,
          WINDOWS,
        );
        expect(statusById(answer)).toContainEqual([enrollmentId, one.status]);
      });
    });

    it.each(ENDED)(
      'the teacher’s ended tab searched by the student’s name finds an enrollment $name',
      async (one) => {
        await rolledBack(async (tx) => {
          const made = await world(tx);
          const { enrollmentId } = endedOf(made, one.name);
          const answer = await teacherStudentsOf(
            tx,
            store,
            made.teacherId,
            { tab: 'ended', query: one.student },
            clock,
            WINDOWS,
          );
          expect(statusById(answer)).toEqual([[enrollmentId, one.status]]);
        });
      },
    );

    it('the student’s ended tab holds no enrollment cancelled and never confirmed, whatever its reason', async () => {
      await rolledBack(async (tx) => {
        const made = await world(tx);
        for (const { student, studentUserId } of made.neverConfirmed) {
          const answer = await studentEnrollmentsOf(
            tx,
            store,
            studentUserId,
            { tab: 'ended' },
            clock,
            WINDOWS,
          );
          expect(statusById(answer), student).toEqual([]);
        }
      });
    });

    it('the teacher’s ended tab holds no enrollment cancelled and never confirmed, whatever its reason', async () => {
      await rolledBack(async (tx) => {
        const made = await world(tx);
        const answer = await teacherStudentsOf(
          tx,
          store,
          made.teacherId,
          { tab: 'ended' },
          clock,
          WINDOWS,
        );
        expect(
          statusById(answer)
            .map(([enrollmentId]) => enrollmentId)
            .sort(),
        ).toEqual([...made.ended.values()].map(({ enrollmentId }) => enrollmentId).sort());
      });
    });

    it('the teacher’s ended tab searched by name finds no enrollment cancelled and never confirmed', async () => {
      await rolledBack(async (tx) => {
        const made = await world(tx);
        for (const { student } of made.neverConfirmed) {
          const answer = await teacherStudentsOf(
            tx,
            store,
            made.teacherId,
            { tab: 'ended', query: student },
            clock,
            WINDOWS,
          );
          expect(statusById(answer), student).toEqual([]);
        }
      });
    });
  },
);
