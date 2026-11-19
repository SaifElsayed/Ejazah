// 003:T112 (SRS FR-POSTPONE-1, DEC-90; ERD §15 rule 19 as amended) — `TIME_FREEING_STATUSES` is the
// code's copy of the statuses both overlap exclusions free, so the booking sheet, the hold and the
// re-resolution leave out exactly what the database leaves out. Read against the newest migration that
// writes `sessions_teacher_no_overlap` and `sessions_student_no_overlap`. Written before the constant
// changed, run red first.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TIME_FREEING_STATUSES } from './sessions.repository.js';

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
