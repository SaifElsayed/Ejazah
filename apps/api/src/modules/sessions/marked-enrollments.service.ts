// T058 of specs/004-sessions (FR-451, FR-481; SRS FR-ADMIN-4 as amended on 2026-11-05; the owner's
// decision Q7 (a) of 2026-11-12): a teacher's enrollments the repeated-absence mark names, each with
// its student and its status, for the user directory's `users.get` (`repeatedAbsences`), read
// through sessions' entry so verification keeps R-301's one edge to sessions.
//
// The mark and the count are T015's `markedEnrollmentsOfTeacher` (`repeated_absence_flag_count`
// read there); the student is sessions' own `student_user_id` (`marked-enrollments.repository.ts`);
// the status is booking's, through the `EnrollmentSide` port's `enrollmentPage`, one read for every
// marked enrollment, so no booking table is read here (R-API-6). An enrollment booking no longer
// answers (soft-deleted, T148) is left out, as every ordinary read leaves it out. Nothing follows
// from the mark (FR-451): no lock, no write.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { EnrollmentSide, EnrollmentStatus } from './enrollment-side.port.js';
import { studentsOfEnrollments } from './marked-enrollments.repository.js';
import type { RepeatedAbsence } from './repeated-absence.service.js';

/** A marked enrollment of the teacher's, with its student, its status and its count. */
export interface MarkedEnrollment {
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly status: EnrollmentStatus;
  readonly teacherNoShows: number;
}

/** What the read asks of sessions' own rows, on the caller's transaction; faked in a spec. */
export interface MarkedEnrollmentsStore {
  studentsOfEnrollments(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

const markedEnrollmentsStore: MarkedEnrollmentsStore = { studentsOfEnrollments };

export interface MarkedEnrollments {
  /** The teacher's marked enrollments, by enrollment id, each with its student and status; no lock. */
  markedEnrollmentsWithStudentsOf(
    tx: Transaction,
    teacherUserId: string,
  ): Promise<readonly MarkedEnrollment[]>;
}

export function createMarkedEnrollments({
  absence,
  enrollments,
  store = markedEnrollmentsStore,
}: {
  readonly absence: Pick<RepeatedAbsence, 'markedEnrollmentsOfTeacher'>;
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentPage'>;
  readonly store?: MarkedEnrollmentsStore;
}): MarkedEnrollments {
  return {
    markedEnrollmentsWithStudentsOf: async (tx, teacherUserId) => {
      const marked = await absence.markedEnrollmentsOfTeacher(tx, teacherUserId);
      if (marked.length === 0) return [];
      const ids = marked.map(({ enrollmentId }) => enrollmentId);
      const [students, page] = await Promise.all([
        store.studentsOfEnrollments(tx, ids),
        enrollments.enrollmentPage(tx, { enrollmentIds: ids }, undefined, ids.length),
      ]);
      const statuses = new Map(
        page.items.map(({ enrollmentId, status }) => [enrollmentId, status]),
      );
      return marked.flatMap(({ enrollmentId, teacherNoShows }) => {
        const studentUserId = students.get(enrollmentId);
        const status = statuses.get(enrollmentId);
        return studentUserId === undefined || status === undefined
          ? []
          : [{ enrollmentId, studentUserId, status, teacherNoShows }];
      });
    },
  };
}
