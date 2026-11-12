// T058 of specs/004-sessions (FR-451, FR-481; SRS FR-ADMIN-4; the owner's decision Q7 (a) of
// 2026-11-12) — a teacher's marked enrollments with each one's student and status, over recorded
// stand-ins: the mark is T015's `markedEnrollmentsOfTeacher`, the student is sessions' own
// `student_user_id`, the status is booking's through `EnrollmentSide.enrollmentPage`, read once for
// every marked enrollment. Over the real tables: `tests/db-integrity/user-directory.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type {
  EnrollmentPageFilter,
  EnrollmentPageItem,
  EnrollmentSide,
} from './enrollment-side.port.js';
import { createMarkedEnrollments } from './marked-enrollments.service.js';
import type { RepeatedAbsence } from './repeated-absence.service.js';

const tx = {} as Transaction;
const TEACHER = '0199d0a0-0000-7000-8000-000000000001';
const FIRST = '0199d0a0-0000-7000-8000-0000000000e1';
const SECOND = '0199d0a0-0000-7000-8000-0000000000e2';
const STUDENT_A = '0199d0a0-0000-7000-8000-0000000000b1';
const STUDENT_B = '0199d0a0-0000-7000-8000-0000000000b2';

function world(marked: readonly { enrollmentId: string; teacherNoShows: number }[]) {
  const pages: { filter: EnrollmentPageFilter; cursor?: string; batchSize?: number }[] = [];
  const asked: string[][] = [];
  const absence: Pick<RepeatedAbsence, 'markedEnrollmentsOfTeacher'> = {
    markedEnrollmentsOfTeacher: async (_tx, teacherUserId) => {
      expect(teacherUserId).toBe(TEACHER);
      return marked;
    },
  };
  const enrollments: Pick<EnrollmentSide, 'enrollmentPage'> = {
    enrollmentPage: async (_tx, filter, cursor, batchSize) => {
      pages.push({
        filter,
        ...(cursor === undefined ? {} : { cursor }),
        ...(batchSize === undefined ? {} : { batchSize }),
      });
      const known: EnrollmentPageItem[] = [
        {
          enrollmentId: SECOND,
          studentUserId: STUDENT_B,
          teacherUserId: TEACHER,
          status: 'cancelled',
          track: 'recitation',
          sessionCount: 4,
        },
        {
          enrollmentId: FIRST,
          studentUserId: STUDENT_A,
          teacherUserId: TEACHER,
          status: 'confirmed',
          track: 'recitation',
          sessionCount: 4,
        },
      ];
      return {
        items: known.filter(
          ({ enrollmentId }) => filter.enrollmentIds?.includes(enrollmentId) ?? false,
        ),
      };
    },
  };
  const store = {
    studentsOfEnrollments: async (_tx: Transaction, ids: readonly string[]) => {
      asked.push([...ids]);
      return new Map(
        [
          [FIRST, STUDENT_A],
          [SECOND, STUDENT_B],
        ].filter(([id]) => ids.includes(id!)) as [string, string][],
      );
    },
  };
  return { reads: createMarkedEnrollments({ absence, enrollments, store }), pages, asked };
}

describe('markedEnrollmentsWithStudentsOf (T058, FR-451)', () => {
  it("answers each marked enrollment with its student, its status and its count, in the mark's order", async () => {
    const { reads, pages, asked } = world([
      { enrollmentId: FIRST, teacherNoShows: 5 },
      { enrollmentId: SECOND, teacherNoShows: 7 },
    ]);
    expect(await reads.markedEnrollmentsWithStudentsOf(tx, TEACHER)).toEqual([
      { enrollmentId: FIRST, studentUserId: STUDENT_A, status: 'confirmed', teacherNoShows: 5 },
      { enrollmentId: SECOND, studentUserId: STUDENT_B, status: 'cancelled', teacherNoShows: 7 },
    ]);
    expect(asked).toEqual([[FIRST, SECOND]]);
    expect(pages).toEqual([{ filter: { enrollmentIds: [FIRST, SECOND] }, batchSize: 2 }]);
  });

  it('reads nothing more for a teacher with no marked enrollment', async () => {
    const { reads, pages, asked } = world([]);
    expect(await reads.markedEnrollmentsWithStudentsOf(tx, TEACHER)).toEqual([]);
    expect(pages).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('leaves out an enrollment booking no longer answers (soft-deleted)', async () => {
    const GONE = '0199d0a0-0000-7000-8000-0000000000e9';
    const { reads } = world([
      { enrollmentId: FIRST, teacherNoShows: 5 },
      { enrollmentId: GONE, teacherNoShows: 6 },
    ]);
    expect(await reads.markedEnrollmentsWithStudentsOf(tx, TEACHER)).toEqual([
      { enrollmentId: FIRST, studentUserId: STUDENT_A, status: 'confirmed', teacherNoShows: 5 },
    ]);
  });
});
