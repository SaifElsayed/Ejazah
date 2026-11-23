// 003:T112 (SRS FR-POSTPONE-1, DEC-90; ERD §15 rule 19 as amended) — `TIME_FREEING_STATUSES` is the
// code's copy of the statuses both overlap exclusions free, so the booking sheet, the hold and the
// re-resolution leave out exactly what the database leaves out. Read against the newest migration that
// writes `sessions_teacher_no_overlap` and `sessions_student_no_overlap`. Written before the constant
// changed, run red first.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { sessionsOfEnrollments, TIME_FREEING_STATUSES } from './sessions.repository.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../../prisma/migrations');

/** The statuses each exclusion's predicate frees, from the newest migration that writes it. */
function freedByNewest(constraint: string): readonly string[] {
  const folders = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
  let freed: readonly string[] | undefined;
  for (const folder of folders) {
    const sql = readFileSync(join(MIGRATIONS, folder, 'migration.sql'), 'utf8');
    const at = sql.lastIndexOf(`ADD CONSTRAINT "${constraint}" EXCLUDE`);
    if (at === -1) continue;
    const match = /"status" NOT IN \(([^)]*)\)/.exec(sql.slice(at));
    if (match?.[1] === undefined) throw new Error(`${folder}: ${constraint} has no NOT IN`);
    freed = match[1].split(',').map((one) => one.trim().replace(/^'|'$/g, ''));
  }
  if (freed === undefined) throw new Error(`no migration writes ${constraint}`);
  return freed;
}

describe('the statuses that free a session’s time (ERD §15 rule 19)', () => {
  it.each(['sessions_teacher_no_overlap', 'sessions_student_no_overlap'])(
    'are exactly those %s frees, postponed among them (003:T112)',
    (constraint) => {
      expect([...TIME_FREEING_STATUSES].sort()).toEqual([...freedByNewest(constraint)].sort());
      expect(TIME_FREEING_STATUSES).toContain('postponed');
    },
  );
});

// 006:T012 (R-507, R-512) — an enrollment's sessions as payments' case amounts read them, over a
// recording stand-in of the client: each offer session with its programme month, every other
// without one.
describe('sessionsOfEnrollments: the programme month (006:T012)', () => {
  const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000101';
  const row = (sequenceNumber: number, programmeMonth: number | null) => ({
    id: `0199d0a0-0000-7000-8000-0000000002${String(sequenceNumber).padStart(2, '0')}`,
    enrollmentId: ENROLLMENT,
    sequenceNumber,
    scheduledDateLocal: new Date('2026-10-01T00:00:00Z'),
    scheduledStartTimeLocal: new Date('1970-01-01T09:00:00Z'),
    timezone: 'Africa/Cairo',
    scheduledStartAt: new Date('2026-10-01T06:00:00Z'),
    scheduledEndAt: new Date('2026-10-01T07:00:00Z'),
    status: 'done',
    outcomeUnderDispute: null,
    programmeMonth,
  });

  it('answers an offer session’s month and none for the assessment, reading it in the one statement', async () => {
    const calls: unknown[] = [];
    const client = {
      session: {
        findMany: async (query: unknown) => {
          calls.push(query);
          return [row(1, null), row(2, 1)];
        },
      },
    } as unknown as Pick<Transaction, 'session'>;

    const sessions = (await sessionsOfEnrollments(client, [ENROLLMENT])).get(ENROLLMENT) ?? [];

    expect(sessions.map((one) => [one.sequenceNumber, one.programmeMonth])).toEqual([
      [1, undefined],
      [2, 1],
    ]);
    expect('programmeMonth' in (sessions[0] ?? {})).toBe(false);
    expect(calls).toEqual([
      expect.objectContaining({ select: expect.objectContaining({ programmeMonth: true }) }),
    ]);
  });
});
