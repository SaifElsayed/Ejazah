// T011 of specs/005-certification (FR-611, FR-612; research R-408; data-model.md:65; the note under
// T011, Q-R3 (a), Q-R6 (a)) — moderation's `user_reports` queries over the real table as the
// application role, read through moderation's entry (`userReportStore`, as the service reads them):
//
// - a report is inserted with its context, session and enrollment as the server set them;
// - one open report per reporter, reported user and context (`user_reports_one_open_key`): a second
//   answers null, with nothing written; another context, or once the first is resolved, is admitted;
// - the queue's page is by status, the open ones oldest first and the closed ones newest first,
//   after a report id;
// - the resolution is one conditional update `WHERE status = 'open'`: it writes the status, the
//   note (`resolution_notes`), the instant and the administrator together (rule 59's check), and a
//   report already resolved is left as it is;
// - a profile report's visibility is identity's predicate for the student's own gender (Q-R4 (a)).
//
// Every world is written and read on one transaction that is rolled back. Observed red first against
// the stub repository, and against the named mutants (lane A's `mutants\`).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { userReportStore } from '../../apps/api/src/modules/moderation/index';
import type { Database, Transaction } from '../../apps/api/src/platform/db/prisma.repository';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender';
import { closeDatabase, openSpecDatabase, rolledBack, worldOn } from './report-world';

const { insert, reportOf, page, resolve } = userReportStore;

let database: Database;

beforeAll(() => {
  database = openSpecDatabase();
});

afterAll(async () => {
  await closeDatabase(database);
});

const REASON = 'كلام غير لائق';
const AT = new Date('2026-11-18T10:00:00.000Z');

async function sessionReport(tx: Transaction) {
  const pair = await worldOn(tx).pair();
  const row = {
    reporterUserId: pair.studentId,
    reportedUserId: pair.teacherId,
    context: 'session' as const,
    sessionId: pair.sessionId,
    enrollmentId: pair.enrollmentId,
    reason: REASON,
  };
  return { pair, row };
}

describe('insert', () => {
  it('writes an open report with the context, session and enrollment it is given', async () => {
    await rolledBack(database, async (tx) => {
      const { pair, row } = await sessionReport(tx);
      const id = await insert(tx, row);
      expect(id).toEqual(expect.any(String));
      expect(await reportOf(tx, id ?? '')).toEqual({
        id,
        context: 'session',
        status: 'open',
        reporterUserId: pair.studentId,
        reportedUserId: pair.teacherId,
        sessionId: pair.sessionId,
        enrollmentId: pair.enrollmentId,
        reason: REASON,
        createdAt: expect.any(Date),
        resolutionNotes: null,
        resolvedAt: null,
        resolvedByAdminId: null,
      });
    });
  });

  it('answers null for a second open report of one reporter on one person in one context', async () => {
    await rolledBack(database, async (tx) => {
      const { row } = await sessionReport(tx);
      expect(await insert(tx, row)).toEqual(expect.any(String));
      // The refused insert aborts the transaction: nothing after it on this one (the caller rolls back).
      expect(await insert(tx, { ...row, reason: 'مرة أخرى' })).toBeNull();
    });
  });

  it('admits the same two people in another context (per context, Q-R6 (a))', async () => {
    await rolledBack(database, async (tx) => {
      const { row } = await sessionReport(tx);
      await insert(tx, row);
      const chat = await insert(tx, { ...row, context: 'chat', sessionId: null });
      expect(chat).toEqual(expect.any(String));
    });
  });

  it('admits a new open report once the first is resolved', async () => {
    await rolledBack(database, async (tx) => {
      const { row } = await sessionReport(tx);
      const adminId = await worldOn(tx).admin();
      const first = await insert(tx, row);
      await resolve(tx, {
        reportId: first ?? '',
        outcome: 'dismissed',
        note: 'لا شيء',
        adminId,
        at: AT,
      });
      expect(await insert(tx, row)).toEqual(expect.any(String));
    });
  });

  it('writes a profile report with no session and no enrollment', async () => {
    await rolledBack(database, async (tx) => {
      const world = worldOn(tx);
      const offer = await world.teacher();
      const student = await world.person();
      const id = await insert(tx, {
        reporterUserId: student,
        reportedUserId: offer.teacherId,
        context: 'profile',
        sessionId: null,
        enrollmentId: null,
        reason: REASON,
      });
      expect(await reportOf(tx, id ?? '')).toMatchObject({
        context: 'profile',
        sessionId: null,
        enrollmentId: null,
      });
    });
  });
});

describe('reportOf', () => {
  it('answers null for an unknown report', async () => {
    await rolledBack(database, async (tx) => {
      expect(await reportOf(tx, randomUUID())).toBeNull();
    });
  });
});

describe('resolve', () => {
  it('writes the outcome, the note, the instant and the administrator together, once', async () => {
    await rolledBack(database, async (tx) => {
      const { row } = await sessionReport(tx);
      const adminId = await worldOn(tx).admin();
      const id = (await insert(tx, row)) ?? '';
      expect(
        await resolve(tx, {
          reportId: id,
          outcome: 'actioned',
          note: 'تم التنبيه',
          adminId,
          at: AT,
        }),
      ).toBe(true);
      expect(await reportOf(tx, id)).toMatchObject({
        status: 'actioned',
        resolutionNotes: 'تم التنبيه',
        resolvedAt: AT,
        resolvedByAdminId: adminId,
      });
    });
  });

  it('leaves a report already resolved as it is and answers false', async () => {
    await rolledBack(database, async (tx) => {
      const { row } = await sessionReport(tx);
      const world = worldOn(tx);
      const first = await world.admin();
      const second = await world.admin();
      const id = (await insert(tx, row)) ?? '';
      await resolve(tx, {
        reportId: id,
        outcome: 'actioned',
        note: 'الأولى',
        adminId: first,
        at: AT,
      });
      const later = new Date('2026-11-18T11:00:00.000Z');
      expect(
        await resolve(tx, {
          reportId: id,
          outcome: 'dismissed',
          note: 'الثانية',
          adminId: second,
          at: later,
        }),
      ).toBe(false);
      expect(await reportOf(tx, id)).toMatchObject({
        status: 'actioned',
        resolutionNotes: 'الأولى',
        resolvedAt: AT,
        resolvedByAdminId: first,
      });
    });
  });

  it('answers false for an unknown report', async () => {
    await rolledBack(database, async (tx) => {
      const adminId = await worldOn(tx).admin();
      expect(
        await resolve(tx, {
          reportId: randomUUID(),
          outcome: 'dismissed',
          note: 'x',
          adminId,
          at: AT,
        }),
      ).toBe(false);
    });
  });
});

describe('page', () => {
  it('answers the open reports oldest first after a cursor, the closed ones newest first', async () => {
    await rolledBack(database, async (tx) => {
      const world = worldOn(tx);
      const adminId = await world.admin();
      const reporter = await world.person();
      const ids: string[] = [];
      for (let made = 0; made < 4; made += 1) {
        const reported = await world.person();
        const id = await insert(tx, {
          reporterUserId: reporter,
          reportedUserId: reported,
          context: 'profile',
          sessionId: null,
          enrollmentId: null,
          reason: REASON,
        });
        ids.push(id ?? '');
      }
      const [a, b, c, d] = ids as [string, string, string, string];
      await resolve(tx, { reportId: c, outcome: 'dismissed', note: 'x', adminId, at: AT });
      await resolve(tx, { reportId: d, outcome: 'dismissed', note: 'x', adminId, at: AT });

      const mine = (rows: readonly { id: string }[]) =>
        rows.map(({ id }) => id).filter((id) => ids.includes(id));
      const open = await page(tx, { status: 'open', take: 1000 });
      expect(mine(open)).toEqual([a, b]);
      expect(open.every(({ status }) => status === 'open')).toBe(true);
      expect(mine(await page(tx, { status: 'open', after: a, take: 1000 }))).toEqual([b]);
      const dismissed = await page(tx, { status: 'dismissed', take: 1000 });
      expect(mine(dismissed)).toEqual([d, c]);
      expect(mine(await page(tx, { status: 'dismissed', after: d, take: 1000 }))).toEqual([c]);
      expect(mine(await page(tx, { status: 'actioned', take: 1000 }))).toEqual([]);
    });
  });

  it('answers at most `take` rows', async () => {
    await rolledBack(database, async (tx) => {
      const world = worldOn(tx);
      const reporter = await world.person();
      for (let made = 0; made < 3; made += 1) {
        await insert(tx, {
          reporterUserId: reporter,
          reportedUserId: await world.person(),
          context: 'profile',
          sessionId: null,
          enrollmentId: null,
          reason: REASON,
        });
      }
      expect(await page(tx, { status: 'open', take: 2 })).toHaveLength(2);
    });
  });
});

describe('visibleTeacher, identity’s predicate as a profile report reads it (Q-R4 (a))', () => {
  it('answers a teacher visible to the student’s gender, and no one else', async () => {
    await rolledBack(database, async (tx) => {
      const world = worldOn(tx);
      const male = 'male' as RequesterGender;
      const sameGender = await world.teacher('male');
      const otherGender = await world.teacher('female');
      const student = await world.person('male');
      const unpaid = await world.teacher('male');
      await tx.teacherProfile.update({
        where: { userId: unpaid.teacherId },
        data: { payoutVerifiedAt: null },
      });
      expect(await userReportStore.visibleTeacher(tx, male, sameGender.teacherId)).toBe(true);
      expect(await userReportStore.visibleTeacher(tx, male, otherGender.teacherId)).toBe(false);
      expect(await userReportStore.visibleTeacher(tx, male, student)).toBe(false);
      expect(await userReportStore.visibleTeacher(tx, male, unpaid.teacherId)).toBe(false);
      expect(await userReportStore.visibleTeacher(tx, male, randomUUID())).toBe(false);
    });
  });
});
