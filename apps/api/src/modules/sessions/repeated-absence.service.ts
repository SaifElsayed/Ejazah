// T015 of specs/004-sessions/tasks.md (FR-447, FR-448, FR-451, SC-404; research R-322; ADR 0023):
// an enrollment's Teacher-No-Show count and the repeated-absence mark, for administrators only: the
// monitor (T024), the case and complaint queue (T034, T058), the disputes queue (T035) and a
// teacher's record in the user directory (T058) read them through sessions' entry.
//
// The mark is the count at `repeated_absence_flag_count` or above (SRS §3.14, default 5), computed
// when read. NOTHING FOLLOWS FROM IT (the owner's decision of 2026-11-05, no automatic termination):
// no count ends an enrollment (FR-448), so neither this file nor any path that settles reads the
// count or the mark to change a session, an enrollment, an account or a remedy. The two reads take
// no lock and write nothing (`repeated-absence.repository.ts`).
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  teacherEnrollmentsWithNoShowsAtLeast,
  type TeacherNoShowCount,
  teacherNoShowCountsOf,
} from './repeated-absence.repository.js';

/** The count at which an enrollment is shown marked (SRS §3.14 «Repeated-absence flag count»). */
export const REPEATED_ABSENCE_FLAG_SETTING = 'repeated_absence_flag_count';

/** The flag count's schema: a whole number of absences, at least one. */
export const repeatedAbsenceFlagCount = z.int().positive();

/** What the count and the mark read, each on the caller's transaction. */
export interface RepeatedAbsenceStore {
  teacherNoShowCountsOf(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
  teacherEnrollmentsWithNoShowsAtLeast(
    tx: Transaction,
    teacherUserId: string,
    atLeast: number,
  ): Promise<readonly TeacherNoShowCount[]>;
}

const repeatedAbsenceStore: RepeatedAbsenceStore = {
  teacherNoShowCountsOf,
  teacherEnrollmentsWithNoShowsAtLeast,
};

export interface RepeatedAbsence {
  /** Of `enrollmentIds`, each one's Teacher-No-Show count, 0 for one with none; no lock. */
  teacherNoShowCountsOf(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
  /**
   * The teacher's enrollments whose count is at least `repeated_absence_flag_count`, each with its
   * count, by enrollment id; no lock.
   */
  markedEnrollmentsOfTeacher(
    tx: Transaction,
    teacherUserId: string,
  ): Promise<readonly TeacherNoShowCount[]>;
}

/** The count and the mark over sessions' table, the flag count read at each mark's read. */
export function createRepeatedAbsence({
  settings,
  store = repeatedAbsenceStore,
}: {
  readonly settings: SettingsReader;
  readonly store?: RepeatedAbsenceStore;
}): RepeatedAbsence {
  return {
    teacherNoShowCountsOf: (tx, enrollmentIds) => store.teacherNoShowCountsOf(tx, enrollmentIds),
    markedEnrollmentsOfTeacher: async (tx, teacherUserId) => {
      const flagCount = await settings.read(REPEATED_ABSENCE_FLAG_SETTING, repeatedAbsenceFlagCount);
      return store.teacherEnrollmentsWithNoShowsAtLeast(tx, teacherUserId, flagCount);
    },
  };
}
