// T035 of specs/004-sessions and 003:T082 (FR-362, FR-375, FR-422, FR-478, FR-479, FR-439;
// research R-312, R-313) — the compensation case's queries over a stand-in client, every branch:
// what each query is asked and what it answers. The queue (`caseQueuePage`) reads its first part
// (the open `student_suspended` cases) only for no status or `open` and a cursor in that part, reads
// the rest only while the first part leaves room on the page, drops a session dispute, and cuts the
// page with the last row's position while more follow. What the database itself refuses is the
// `tests/db-integrity/` specs'.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  type CaseClosingWrite,
  caseEnrollmentOf,
  caseInstantsAmong,
  caseInstantsOf,
  caseQueuePage,
  caseRecordOf,
  closeOpenCase,
  compensationCasesAmong,
  compensationCasesOf,
  insertCase,
  lockCasesOf,
  openCaseOf,
  latestCaseOf,
  sessionsEverDisputedAmong,
  suspensionCasesCoveredBy,
} from './compensation-case.repository.js';
import { COVERING_REASONS } from './compensation-case.service.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const OTHER_ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e2';
const THIRD_ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e3';
const FOURTH_ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e4';
const CASE = '0199d0a0-0000-7000-8000-0000000000c1';
const CASE_2 = '0199d0a0-0000-7000-8000-0000000000c2';
const CASE_3 = '0199d0a0-0000-7000-8000-0000000000c3';
const CASE_4 = '0199d0a0-0000-7000-8000-0000000000c4';
const SESSION = '0199d0a0-0000-7000-8000-0000000000a1';
const OTHER_SESSION = '0199d0a0-0000-7000-8000-0000000000a2';
const ADMIN = '0199d0a0-0000-7000-8000-0000000000f1';

const T0 = new Date('2026-11-01T08:00:00.000Z');
const T1 = new Date('2026-11-02T08:00:00.000Z');
const T2 = new Date('2026-11-03T08:00:00.000Z');
const T3 = new Date('2026-11-04T08:00:00.000Z');

/** What each stand-in method answers; a method left out answers nothing useful. */
interface Answers {
  findFirst?: unknown;
  findUnique?: unknown;
  findMany?: readonly unknown[][];
  create?: unknown;
  updateMany?: unknown;
  groupBy?: unknown;
}

/**
 * A client whose `dispute` methods answer `answers` (`findMany` one answer per call, in order) and
 * record what they were asked, and whose raw query records its SQL.
 */
function client(answers: Answers = {}) {
  const asked: unknown[] = [];
  const pages = [...(answers.findMany ?? [])];
  const method =
    (name: keyof Answers, answer: () => unknown) =>
    async (args: unknown): Promise<unknown> => {
      asked.push([name, args]);
      return answer();
    };
  const stand = {
    dispute: {
      findFirst: method('findFirst', () => answers.findFirst ?? null),
      findUnique: method('findUnique', () => answers.findUnique ?? null),
      findMany: method('findMany', () => pages.shift() ?? []),
      create: method('create', () => answers.create),
      updateMany: method('updateMany', () => answers.updateMany),
      groupBy: method('groupBy', () => answers.groupBy ?? []),
    },
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      asked.push(['$queryRaw', sql.join('?'), values]);
      return [];
    },
  };
  return { tx: stand as unknown as Transaction, asked };
}

describe('lockCasesOf', () => {
  it("locks the enrollment's row FOR UPDATE", async () => {
    const { tx, asked } = client();
    await lockCasesOf(tx, ENROLLMENT);
    expect(asked).toEqual([
      [
        '$queryRaw',
        'SELECT 1 FROM enrollments WHERE id = ANY(?::uuid[]) ORDER BY id FOR UPDATE',
        [[ENROLLMENT]],
      ],
    ]);
  });
});

describe('openCaseOf', () => {
  it("asks the enrollment's open case of the reason, the oldest, and answers its id", async () => {
    const { tx, asked } = client({ findFirst: { id: CASE } });
    expect(await openCaseOf(tx, ENROLLMENT, 'student_suspended')).toBe(CASE);
    expect(asked).toEqual([
      [
        'findFirst',
        {
          where: {
            enrollmentId: ENROLLMENT,
            kind: 'compensation_case',
            reason: 'student_suspended',
            status: 'open',
          },
          orderBy: { id: 'asc' },
          select: { id: true },
        },
      ],
    ]);
  });

  it('answers null when none is open', async () => {
    const { tx } = client();
    expect(await openCaseOf(tx, ENROLLMENT, 'student_suspended')).toBeNull();
  });
});

describe('insertCase', () => {
  it('inserts an open compensation case with no session and no raiser, and answers its id', async () => {
    const { tx, asked } = client({ create: { id: CASE } });
    expect(await insertCase(tx, ENROLLMENT, 'teacher_ended')).toBe(CASE);
    expect(asked).toEqual([
      [
        'create',
        {
          data: {
            enrollmentId: ENROLLMENT,
            kind: 'compensation_case',
            reason: 'teacher_ended',
            status: 'open',
          },
          select: { id: true },
        },
      ],
    ]);
  });
});

describe('caseEnrollmentOf', () => {
  it('answers the enrollment of the row by its id, of any kind', async () => {
    const { tx, asked } = client({ findUnique: { enrollmentId: ENROLLMENT } });
    expect(await caseEnrollmentOf(tx, CASE)).toBe(ENROLLMENT);
    expect(asked).toEqual([
      ['findUnique', { where: { id: CASE }, select: { enrollmentId: true } }],
    ]);
  });

  it('answers null for no such row', async () => {
    const { tx } = client();
    expect(await caseEnrollmentOf(tx, CASE)).toBeNull();
  });
});

describe('closeOpenCase', () => {
  const WRITE: CaseClosingWrite = {
    status: 'resolved',
    resolution: 'compensation_ordered',
    note: 'رد قيمة الحصص',
    adminId: ADMIN,
    resolvedAt: T3,
  };

  it('writes the closing where the case is still open, in one conditional update, and answers true', async () => {
    const { tx, asked } = client({ updateMany: { count: 1 } });
    expect(await closeOpenCase(tx, CASE, WRITE)).toBe(true);
    expect(asked).toEqual([
      [
        'updateMany',
        {
          where: { id: CASE, status: 'open' },
          data: {
            status: 'resolved',
            resolution: 'compensation_ordered',
            resolutionNotes: 'رد قيمة الحصص',
            resolvedByAdminId: ADMIN,
            resolvedAt: T3,
            coveredByCaseId: null,
          },
        },
      ],
    ]);
  });

  it('writes the link a suspension case’s closing names (rule 49; the note under T036)', async () => {
    const { tx, asked } = client({ updateMany: { count: 1 } });
    expect(
      await closeOpenCase(tx, CASE, { ...WRITE, status: 'dismissed', resolution: null, coveredBy: CASE_2 }),
    ).toBe(true);
    expect(asked).toEqual([
      [
        'updateMany',
        {
          where: { id: CASE, status: 'open' },
          data: {
            status: 'dismissed',
            resolution: null,
            resolutionNotes: 'رد قيمة الحصص',
            resolvedByAdminId: ADMIN,
            resolvedAt: T3,
            coveredByCaseId: CASE_2,
          },
        },
      ],
    ]);
  });

  it('answers false for a case no longer open', async () => {
    const { tx } = client({ updateMany: { count: 0 } });
    expect(await closeOpenCase(tx, CASE, { ...WRITE, status: 'dismissed', resolution: null })).toBe(
      false,
    );
  });
});

describe('caseInstantsAmong', () => {
  it('asks nothing for no enrollment', async () => {
    const { tx, asked } = client();
    expect((await caseInstantsAmong(tx, [])).size).toBe(0);
    expect(asked).toEqual([]);
  });

  it("folds each enrollment's groups: open if any is, the latest opening, the latest closing", async () => {
    const { tx, asked } = client({
      groupBy: [
        // Open first, then two closed groups: the later opening and the later closing win.
        { enrollmentId: ENROLLMENT, status: 'open', _max: { createdAt: T1, resolvedAt: null } },
        { enrollmentId: ENROLLMENT, status: 'resolved', _max: { createdAt: T0, resolvedAt: T2 } },
        { enrollmentId: ENROLLMENT, status: 'dismissed', _max: { createdAt: T3, resolvedAt: T1 } },
        // Closed first, then open: the open group keeps the closing already seen.
        {
          enrollmentId: OTHER_ENROLLMENT,
          status: 'resolved',
          _max: { createdAt: T0, resolvedAt: T1 },
        },
        {
          enrollmentId: OTHER_ENROLLMENT,
          status: 'open',
          _max: { createdAt: T2, resolvedAt: null },
        },
        // Closed with no closing instant recorded.
        {
          enrollmentId: THIRD_ENROLLMENT,
          status: 'dismissed',
          _max: { createdAt: T0, resolvedAt: null },
        },
        // A group with no opening instant is left out.
        {
          enrollmentId: FOURTH_ENROLLMENT,
          status: 'open',
          _max: { createdAt: null, resolvedAt: null },
        },
      ],
    });
    const enrollments = [ENROLLMENT, OTHER_ENROLLMENT, THIRD_ENROLLMENT, FOURTH_ENROLLMENT];
    const cases = await caseInstantsAmong(tx, enrollments);
    expect(Object.fromEntries(cases)).toEqual({
      [ENROLLMENT]: { open: true, lastOpenedAt: T3, lastClosedAt: T2 },
      [OTHER_ENROLLMENT]: { open: true, lastOpenedAt: T2, lastClosedAt: T1 },
      [THIRD_ENROLLMENT]: { open: false, lastOpenedAt: T0, lastClosedAt: null },
    });
    expect(asked).toEqual([
      [
        'groupBy',
        {
          by: ['enrollmentId', 'status'],
          where: {
            enrollmentId: { in: enrollments },
            kind: 'compensation_case',
            reason: { in: [...COVERING_REASONS] },
          },
          _max: { createdAt: true, resolvedAt: true },
        },
      ],
    ]);
  });
});

describe('caseInstantsOf', () => {
  it("answers the one enrollment's folded instants", async () => {
    const { tx } = client({
      groupBy: [
        { enrollmentId: ENROLLMENT, status: 'resolved', _max: { createdAt: T0, resolvedAt: T1 } },
      ],
    });
    expect(await caseInstantsOf(tx, ENROLLMENT)).toEqual({
      open: false,
      lastOpenedAt: T0,
      lastClosedAt: T1,
    });
  });

  it('answers null for an enrollment with no case', async () => {
    const { tx } = client();
    expect(await caseInstantsOf(tx, ENROLLMENT)).toBeNull();
  });
});

describe('compensationCasesOf', () => {
  it("asks the enrollment's compensation cases newest first and answers them by case id", async () => {
    const { tx, asked } = client({
      findMany: [
        [
          { id: CASE_2, reason: 'student_suspended', status: 'open', createdAt: T1 },
          { id: CASE, reason: 'teacher_ended', status: 'resolved', createdAt: T0 },
        ],
      ],
    });
    expect(await compensationCasesOf(tx, ENROLLMENT)).toEqual([
      { caseId: CASE_2, reason: 'student_suspended', status: 'open', createdAt: T1 },
      { caseId: CASE, reason: 'teacher_ended', status: 'resolved', createdAt: T0 },
    ]);
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: { enrollmentId: ENROLLMENT, kind: 'compensation_case' },
          orderBy: { id: 'desc' },
          select: { id: true, reason: true, status: true, createdAt: true },
        },
      ],
    ]);
  });
});

// T070 A1 (the owner's approval of 2026-11-13; the first follow-up under T070): the hold's cases of
// many enrollments in one statement, each enrollment answered as `compensationCasesOf` answers it.
describe('compensationCasesAmong (T070 A1)', () => {
  it("asks every enrollment's compensation cases in one statement and answers each newest first, none for one with no case", async () => {
    const { tx, asked } = client({
      findMany: [
        [
          {
            enrollmentId: OTHER_ENROLLMENT,
            id: CASE_4,
            reason: 'student_banned',
            status: 'open',
            createdAt: T3,
          },
          {
            enrollmentId: ENROLLMENT,
            id: CASE_3,
            reason: 'student_suspended',
            status: 'open',
            createdAt: T2,
          },
          {
            enrollmentId: OTHER_ENROLLMENT,
            id: CASE_2,
            reason: 'absence_termination',
            status: 'dismissed',
            createdAt: T1,
          },
          {
            enrollmentId: ENROLLMENT,
            id: CASE,
            reason: 'teacher_ended',
            status: 'resolved',
            createdAt: T0,
          },
        ],
      ],
    });
    const cases = await compensationCasesAmong(tx, [
      ENROLLMENT,
      OTHER_ENROLLMENT,
      THIRD_ENROLLMENT,
    ]);
    expect([...cases]).toEqual([
      [
        ENROLLMENT,
        [
          { caseId: CASE_3, reason: 'student_suspended', status: 'open', createdAt: T2 },
          { caseId: CASE, reason: 'teacher_ended', status: 'resolved', createdAt: T0 },
        ],
      ],
      [
        OTHER_ENROLLMENT,
        [
          { caseId: CASE_4, reason: 'student_banned', status: 'open', createdAt: T3 },
          { caseId: CASE_2, reason: 'absence_termination', status: 'dismissed', createdAt: T1 },
        ],
      ],
      [THIRD_ENROLLMENT, []],
    ]);
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: {
            enrollmentId: { in: [ENROLLMENT, OTHER_ENROLLMENT, THIRD_ENROLLMENT] },
            kind: 'compensation_case',
          },
          orderBy: { id: 'desc' },
          select: { enrollmentId: true, id: true, reason: true, status: true, createdAt: true },
        },
      ],
    ]);
  });

  it('asks nothing for no enrollment', async () => {
    const { tx, asked } = client();
    expect((await compensationCasesAmong(tx, [])).size).toBe(0);
    expect(asked).toEqual([]);
  });
});

describe('sessionsEverDisputedAmong', () => {
  it('asks nothing for no session', async () => {
    const { tx, asked } = client();
    expect((await sessionsEverDisputedAmong(tx, [])).size).toBe(0);
    expect(asked).toEqual([]);
  });

  it('asks each session once among its session disputes and answers those found, a row with no session left out', async () => {
    const { tx, asked } = client({ findMany: [[{ sessionId: SESSION }, { sessionId: null }]] });
    expect([...(await sessionsEverDisputedAmong(tx, [SESSION, OTHER_SESSION]))]).toEqual([SESSION]);
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: { sessionId: { in: [SESSION, OTHER_SESSION] }, kind: 'session_dispute' },
          distinct: ['sessionId'],
          select: { sessionId: true },
        },
      ],
    ]);
  });
});

describe('caseRecordOf', () => {
  const SELECT = {
    id: true,
    kind: true,
    enrollmentId: true,
    reason: true,
    status: true,
    resolution: true,
    resolutionNotes: true,
    createdAt: true,
    resolvedAt: true,
  };

  it('asks the row of any kind by its id and answers it by case id', async () => {
    const { tx, asked } = client({
      findUnique: {
        id: CASE,
        kind: 'absence_complaint',
        enrollmentId: ENROLLMENT,
        reason: 'غياب متكرر',
        status: 'resolved',
        resolution: 'enrollment_ended',
        resolutionNotes: 'إنهاء الاشتراك',
        createdAt: T0,
        resolvedAt: T1,
      },
    });
    expect(await caseRecordOf(tx, CASE)).toEqual({
      caseId: CASE,
      kind: 'absence_complaint',
      enrollmentId: ENROLLMENT,
      reason: 'غياب متكرر',
      status: 'resolved',
      resolution: 'enrollment_ended',
      resolutionNotes: 'إنهاء الاشتراك',
      createdAt: T0,
      resolvedAt: T1,
    });
    expect(asked).toEqual([['findUnique', { where: { id: CASE }, select: SELECT }]]);
  });

  it('answers null for no such row', async () => {
    const { tx } = client();
    expect(await caseRecordOf(tx, CASE)).toBeNull();
  });
});

describe('caseQueuePage', () => {
  const FIRST_PART = {
    kind: 'compensation_case',
    reason: 'student_suspended',
    status: 'open',
  } as const;
  const SELECT = {
    id: true,
    kind: true,
    enrollmentId: true,
    reason: true,
    status: true,
    createdAt: true,
    resolvedAt: true,
  };
  const KINDS = { in: ['compensation_case', 'absence_complaint'] };

  /** A selected row of the queue. */
  function selected(
    id: string,
    kind: 'compensation_case' | 'absence_complaint' | 'session_dispute',
    reason: string,
    status: 'open' | 'resolved' | 'dismissed' = 'open',
  ) {
    return {
      id,
      kind,
      enrollmentId: ENROLLMENT,
      reason,
      status,
      createdAt: T0,
      resolvedAt: status === 'open' ? null : T1,
    };
  }

  const SUSPENDED = selected(CASE, 'compensation_case', 'student_suspended');
  const SUSPENDED_2 = selected(CASE_2, 'compensation_case', 'student_suspended');
  const SUSPENDED_3 = selected(CASE_3, 'compensation_case', 'student_suspended');
  const ENDED = selected(CASE_3, 'compensation_case', 'teacher_ended');
  const COMPLAINT = selected(CASE_4, 'absence_complaint', 'غياب متكرر');

  /** A selected row as the queue answers it. */
  function shown(row: ReturnType<typeof selected>, first: boolean) {
    const { id, ...rest } = row;
    return { caseId: id, ...rest, first };
  }

  it('reads the first part with no cursor and, when it fills the page, skips the rest and answers its last row as the cursor', async () => {
    const { tx, asked } = client({ findMany: [[SUSPENDED, SUSPENDED_2, SUSPENDED_3]] });
    expect(await caseQueuePage(tx, { limit: 2 })).toEqual({
      rows: [shown(SUSPENDED, true), shown(SUSPENDED_2, true)],
      next: { first: true, caseId: CASE_2 },
    });
    expect(asked).toEqual([
      ['findMany', { where: FIRST_PART, orderBy: { id: 'asc' }, take: 3, select: SELECT }],
    ]);
  });

  it('reads the rest after a short first part, with the room left, and cuts the page in the rest', async () => {
    const { tx, asked } = client({ findMany: [[SUSPENDED], [ENDED, COMPLAINT]] });
    expect(await caseQueuePage(tx, { limit: 2 })).toEqual({
      rows: [shown(SUSPENDED, true), shown(ENDED, false)],
      next: { first: false, caseId: CASE_3 },
    });
    expect(asked).toEqual([
      ['findMany', { where: FIRST_PART, orderBy: { id: 'asc' }, take: 3, select: SELECT }],
      [
        'findMany',
        {
          where: { kind: KINDS, NOT: FIRST_PART },
          orderBy: { id: 'asc' },
          take: 2,
          select: SELECT,
        },
      ],
    ]);
  });

  it('for open with a cursor in the first part, reads that part after it and the rest of open from its start, with no cursor once all fit', async () => {
    const { tx, asked } = client({ findMany: [[SUSPENDED_2], [COMPLAINT]] });
    expect(
      await caseQueuePage(tx, { status: 'open', after: { first: true, caseId: CASE }, limit: 5 }),
    ).toEqual({ rows: [shown(SUSPENDED_2, true), shown(COMPLAINT, false)] });
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: { ...FIRST_PART, id: { gt: CASE } },
          orderBy: { id: 'asc' },
          take: 6,
          select: SELECT,
        },
      ],
      [
        'findMany',
        {
          where: { kind: KINDS, status: 'open', NOT: FIRST_PART },
          orderBy: { id: 'asc' },
          take: 5,
          select: SELECT,
        },
      ],
    ]);
  });

  it('with a cursor in the rest, skips the first part and reads the rest after it', async () => {
    const { tx, asked } = client({ findMany: [[COMPLAINT]] });
    expect(await caseQueuePage(tx, { after: { first: false, caseId: CASE_3 }, limit: 5 })).toEqual({
      rows: [shown(COMPLAINT, false)],
    });
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: { kind: KINDS, NOT: FIRST_PART, id: { gt: CASE_3 } },
          orderBy: { id: 'asc' },
          take: 6,
          select: SELECT,
        },
      ],
    ]);
  });

  it('for a closed status, skips the first part and reads the rest of that status', async () => {
    const resolved = selected(CASE, 'compensation_case', 'student_suspended', 'resolved');
    const { tx, asked } = client({ findMany: [[resolved]] });
    expect(await caseQueuePage(tx, { status: 'resolved', limit: 5 })).toEqual({
      rows: [shown(resolved, false)],
    });
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: { kind: KINDS, status: 'resolved', NOT: FIRST_PART },
          orderBy: { id: 'asc' },
          take: 6,
          select: SELECT,
        },
      ],
    ]);
  });

  it('drops a session dispute, which the queue never lists, before cutting the page', async () => {
    const dispute = selected(CASE_2, 'session_dispute', 'لم يحضر المعلم');
    const { tx } = client({ findMany: [[], [dispute, COMPLAINT]] });
    expect(await caseQueuePage(tx, { limit: 1 })).toEqual({ rows: [shown(COMPLAINT, false)] });
  });
});

describe('suspensionCasesCoveredBy', () => {
  // T071 of specs/004-sessions (rule d, an approved change: the note under T071, Q5 (a) widened):
  // a `teacher_suspended` case an end closed is linked the same way.
  it('asks the student_suspended and teacher_suspended cases whose link names the case, oldest first, and answers them by case id', async () => {
    const { tx, asked } = client({
      findMany: [
        [
          { id: CASE, status: 'resolved' },
          { id: CASE_2, status: 'dismissed' },
        ],
      ],
    });
    expect(await suspensionCasesCoveredBy(tx, CASE_3)).toEqual([
      { caseId: CASE, status: 'resolved' },
      { caseId: CASE_2, status: 'dismissed' },
    ]);
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: {
            coveredByCaseId: CASE_3,
            kind: 'compensation_case',
            reason: { in: ['student_suspended', 'teacher_suspended'] },
          },
          orderBy: { id: 'asc' },
          select: { id: true, status: true },
        },
      ],
    ]);
  });
});

describe('latestCaseOf', () => {
  it("asks the enrollment's latest compensation case of the reasons and answers its id", async () => {
    const { tx, asked } = client({ findFirst: { id: CASE_4 } });
    expect(await latestCaseOf(tx, ENROLLMENT, ['student_banned', 'teacher_ended'])).toBe(CASE_4);
    expect(asked).toEqual([
      [
        'findFirst',
        {
          where: {
            enrollmentId: ENROLLMENT,
            kind: 'compensation_case',
            reason: { in: ['student_banned', 'teacher_ended'] },
          },
          orderBy: { id: 'desc' },
          select: { id: true },
        },
      ],
    ]);
  });

  it('answers null for none', async () => {
    const { tx } = client();
    expect(await latestCaseOf(tx, ENROLLMENT, ['student_banned'])).toBeNull();
  });

  // PR #133's review, round 2, Minor (the follow-up under T036): a cleared suspension reads only an
  // end case opened after its own case, by the time-ordered id.
  it('asks only for a case after the given one when bounded', async () => {
    const { tx, asked } = client({ findFirst: { id: CASE_4 } });
    expect(await latestCaseOf(tx, ENROLLMENT, ['teacher_ended'], CASE_2)).toBe(CASE_4);
    expect(asked).toEqual([
      [
        'findFirst',
        {
          where: {
            enrollmentId: ENROLLMENT,
            kind: 'compensation_case',
            reason: { in: ['teacher_ended'] },
            id: { gt: CASE_2 },
          },
          orderBy: { id: 'desc' },
          select: { id: true },
        },
      ],
    ]);
  });
});
