// T015 of specs/004-sessions/tasks.md (FR-451, R-322) — the repeated-absence mark over a recorded
// store: the flag count is read at each mark's read and handed to the grouped read as its floor;
// the count is the store's, passed through. Over the real tables:
// `tests/db-integrity/repeated-absence.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { createRepeatedAbsence, type RepeatedAbsenceStore } from './repeated-absence.service.js';

const tx = {} as Transaction;
const TEACHER = '0199d0a0-0000-7000-8000-000000000001';
const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000002';

function settingsOf(flagCount: unknown): { reader: SettingsReader; keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    reader: {
      read: async (key, schema) => {
        keys.push(key);
        return schema.parse(flagCount);
      },
    },
  };
}

function store(floors: number[]): RepeatedAbsenceStore {
  return {
    teacherNoShowCountsOf: async (_tx, ids) => new Map(ids.map((id) => [id, 3])),
    teacherEnrollmentsWithNoShowsAtLeast: async (_tx, teacherUserId, atLeast) => {
      expect(teacherUserId).toBe(TEACHER);
      floors.push(atLeast);
      return [{ enrollmentId: ENROLLMENT, teacherNoShows: atLeast }];
    },
  };
}

describe('createRepeatedAbsence (T015, FR-451)', () => {
  it('reads repeated_absence_flag_count at each mark and asks for the enrollments at or above it', async () => {
    const floors: number[] = [];
    const { reader, keys } = settingsOf(5);
    const absence = createRepeatedAbsence({ settings: reader, store: store(floors) });
    expect(await absence.markedEnrollmentsOfTeacher(tx, TEACHER)).toEqual([
      { enrollmentId: ENROLLMENT, teacherNoShows: 5 },
    ]);
    await absence.markedEnrollmentsOfTeacher(tx, TEACHER);
    expect(keys).toEqual(['repeated_absence_flag_count', 'repeated_absence_flag_count']);
    expect(floors).toEqual([5, 5]);
  });

  it('reads no setting for the count', async () => {
    const { reader, keys } = settingsOf(5);
    const absence = createRepeatedAbsence({ settings: reader, store: store([]) });
    expect(await absence.teacherNoShowCountsOf(tx, [ENROLLMENT])).toEqual(new Map([[ENROLLMENT, 3]]));
    expect(keys).toEqual([]);
  });

  it('refuses a flag count that is not a positive whole number, asking nothing', async () => {
    const floors: number[] = [];
    const { reader } = settingsOf(0);
    const absence = createRepeatedAbsence({ settings: reader, store: store(floors) });
    await expect(absence.markedEnrollmentsOfTeacher(tx, TEACHER)).rejects.toThrow();
    expect(floors).toEqual([]);
  });
});
