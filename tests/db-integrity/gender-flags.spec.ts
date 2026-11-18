// T013 of specs/005-certification (FR-614, FR-615; research R-409; data-model.md:66; ERD §15 rule
// 57) — moderation's `gender_flags` queries over the real table as the application role, read
// through moderation's entry (`genderFlagStore`, as the service reads them):
//
// - a flag is inserted open, with its raiser (null for an administrator) and its report;
// - one open flag per flagged person (`gender_flags_one_open_per_user_key`): a second, by anyone,
//   answers null, with nothing written; once the first is resolved, a new one is admitted;
// - the queue's page is by status, the open ones oldest first and the closed ones newest first,
//   after a flag id;
// - the resolution is one conditional update `WHERE status = 'open'`: it writes the outcome, the
//   reason (`resolution_notes`), the instant and the administrator together, and a flag already
//   resolved is left as it is.
//
// Every world is written and read on one transaction that is rolled back. Observed red first against
// the stub repository, and against the named mutants (lane D's `mutants\`).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { genderFlagStore } from '../../apps/api/src/modules/moderation/index';
import type { Database, Transaction } from '../../apps/api/src/platform/db/prisma.repository';
import { closeDatabase, openSpecDatabase, rolledBack, worldOn } from './report-world';

const { insert, flagOf, page, resolve } = genderFlagStore;

let database: Database;

beforeAll(() => {
  database = openSpecDatabase();
});

afterAll(async () => {
  await closeDatabase(database);
});

const REASON = 'الصوت لا يطابق الجنس المعلن';
const AT = new Date('2026-11-18T10:00:00.000Z');

/** A pair, and a report of the student on the teacher from their session. */
async function reported(tx: Transaction) {
  const pair = await worldOn(tx).pair();
  const { id: reportId } = await tx.userReport.create({
    data: {
      reporterUserId: pair.studentId,
      reportedUserId: pair.teacherId,
      context: 'session',
      sessionId: pair.sessionId,
      enrollmentId: pair.enrollmentId,
      reason: REASON,
      status: 'open',
    },
    select: { id: true },
  });
  return { pair, reportId };
}

describe('insert', () => {
  it('writes an open flag with its raiser and no report', async () => {
    await rolledBack(database, async (tx) => {
      const { pair } = await reported(tx);
      const id = await insert(tx, {
        flaggedUserId: pair.teacherId,
        raisedByUserId: pair.studentId,
        reportId: null,
        reason: REASON,
      });
      expect(id).toEqual(expect.any(String));
      expect(await flagOf(tx, id ?? '')).toMatchObject({
        id,
        flaggedUserId: pair.teacherId,
        raisedByUserId: pair.studentId,
        reportId: null,
        status: 'open',
        reason: REASON,
        resolutionNotes: null,
        resolvedAt: null,
        resolvedByAdminId: null,
      });
    });
  });

  it("writes an administrator's flag with no raiser and the report it is raised from", async () => {
    await rolledBack(database, async (tx) => {
      const { pair, reportId } = await reported(tx);
      const id = await insert(tx, {
        flaggedUserId: pair.teacherId,
        raisedByUserId: null,
        reportId,
        reason: REASON,
      });
      expect(await flagOf(tx, id ?? '')).toMatchObject({ raisedByUserId: null, reportId });
    });
  });

  it('answers null for a second open flag on the same person, by anyone, and writes nothing', async () => {
    await rolledBack(database, async (tx) => {
      const { pair } = await reported(tx);
      const first = {
        flaggedUserId: pair.teacherId,
        raisedByUserId: pair.studentId,
        reportId: null,
        reason: REASON,
      };
      expect(await insert(tx, first)).toEqual(expect.any(String));
      await tx.$executeRawUnsafe('SAVEPOINT second_flag');
      expect(await insert(tx, { ...first, raisedByUserId: null })).toBeNull();
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT second_flag');
      expect(
        await tx.genderFlag.count({ where: { flaggedUserId: pair.teacherId, status: 'open' } }),
      ).toBe(1);
    });
  });

  it('admits a new flag on the person once the first is resolved', async () => {
    await rolledBack(database, async (tx) => {
      const { pair } = await reported(tx);
      const admin = await worldOn(tx).admin();
      const row = {
        flaggedUserId: pair.teacherId,
        raisedByUserId: pair.studentId,
        reportId: null,
        reason: REASON,
      };
      const first = await insert(tx, row);
      expect(
        await resolve(tx, {
          flagId: first ?? '',
          outcome: 'dismissed',
          note: REASON,
          adminId: admin,
          at: AT,
        }),
      ).toBe(true);
      expect(await insert(tx, row)).toEqual(expect.any(String));
    });
  });
});

describe('page', () => {
  it('lists a status only, the open oldest first and the closed newest first, after a flag id', async () => {
    await rolledBack(database, async (tx) => {
      const world = worldOn(tx);
      const admin = await world.admin();
      const people = [await world.person(), await world.person(), await world.person()];
      const ids: string[] = [];
      for (const flaggedUserId of people) {
        ids.push(
          (await insert(tx, {
            flaggedUserId,
            raisedByUserId: null,
            reportId: null,
            reason: REASON,
          })) ?? '',
        );
      }
      const [a, b, c] = ids as [string, string, string];
      await resolve(tx, { flagId: b, outcome: 'dismissed', note: REASON, adminId: admin, at: AT });
      await resolve(tx, { flagId: c, outcome: 'dismissed', note: REASON, adminId: admin, at: AT });
      const open = await page(tx, { status: 'open', take: 1000 });
      expect(open.map(({ id }) => id)).toContain(a);
      expect(open.every(({ status }) => status === 'open')).toBe(true);
      expect(open.map(({ id }) => id)).toEqual([...open.map(({ id }) => id)].sort());
      const closed = await page(tx, { status: 'dismissed', take: 1000 });
      const closedIds = closed.map(({ id }) => id);
      expect(closedIds.indexOf(c)).toBeLessThan(closedIds.indexOf(b));
      expect(closedIds).toEqual([...closedIds].sort().reverse());
      expect(
        (await page(tx, { status: 'dismissed', after: c, take: 1000 })).map(({ id }) => id),
      ).toContain(b);
      expect(
        (await page(tx, { status: 'dismissed', after: c, take: 1000 })).map(({ id }) => id),
      ).not.toContain(c);
      expect(await page(tx, { status: 'dismissed', take: 1 })).toHaveLength(1);
    });
  });
});

describe('resolve', () => {
  it('closes an open flag once, the outcome, reason, instant and administrator together', async () => {
    await rolledBack(database, async (tx) => {
      const { pair } = await reported(tx);
      const admin = await worldOn(tx).admin();
      const flagId =
        (await insert(tx, {
          flaggedUserId: pair.teacherId,
          raisedByUserId: pair.studentId,
          reportId: null,
          reason: REASON,
        })) ?? '';
      const closing = {
        flagId,
        outcome: 'corrected' as const,
        note: 'سبب',
        adminId: admin,
        at: AT,
      };
      expect(await resolve(tx, closing)).toBe(true);
      expect(await flagOf(tx, flagId)).toMatchObject({
        status: 'corrected',
        resolutionNotes: 'سبب',
        resolvedAt: AT,
        resolvedByAdminId: admin,
      });
      expect(await resolve(tx, { ...closing, outcome: 'dismissed', note: 'آخر' })).toBe(false);
      expect(await flagOf(tx, flagId)).toMatchObject({
        status: 'corrected',
        resolutionNotes: 'سبب',
      });
    });
  });

  it('answers false for no flag', async () => {
    await rolledBack(database, async (tx) => {
      const admin = await worldOn(tx).admin();
      expect(
        await resolve(tx, {
          flagId: '0199d0a0-0000-7000-8000-00000000dead',
          outcome: 'dismissed',
          note: REASON,
          adminId: admin,
          at: AT,
        }),
      ).toBe(false);
    });
  });
});
