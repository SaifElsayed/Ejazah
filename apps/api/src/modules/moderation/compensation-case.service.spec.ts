// T035 of specs/004-sessions and 003:T035 (FR-362, FR-375, FR-422; research R-312) — opening and
// closing a compensation case over a stand-in client, every branch, the order of the calls
// asserted: an opening locks the enrollment and then joins the open case of its reason or inserts
// one; a closing reads the case's enrollment, answers null with no lock and no write for no such
// case, else locks the enrollment, reads the database's clock and writes the closing in one
// conditional update, answering that instant, or null for a case no longer open. Races are the
// `tests/db-integrity/` probes'.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { closeCase, openCompensationCase } from './compensation-case.service.js';
// 005:T014: the correction's reason.
import { COMPENSATION_REASONS, COVERING_REASONS } from './compensation-case.service.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const CASE = '0199d0a0-0000-7000-8000-0000000000c1';
const ADMIN = '0199d0a0-0000-7000-8000-0000000000f1';
const CLOCK = new Date('2026-11-04T08:00:00.123Z');

const LOCK_SQL = 'SELECT 1 FROM enrollments WHERE id = ANY(?::uuid[]) ORDER BY id FOR UPDATE';
const CLOCK_SQL = 'SELECT clock_timestamp() AS at';

/** What the stand-in's `dispute` methods answer. */
interface Answers {
  open?: { id: string } | null;
  enrollment?: { enrollmentId: string } | null;
  moved?: number;
}

/**
 * A client recording every call in order: the `dispute` methods answer `answers`, the raw query
 * answers the clock for `clock_timestamp()` and nothing for a lock.
 */
function client({ open = null, enrollment = null, moved = 1 }: Answers = {}) {
  const asked: unknown[] = [];
  const stand = {
    dispute: {
      findFirst: async (args: unknown) => {
        asked.push(['findFirst', args]);
        return open;
      },
      create: async (args: unknown) => {
        asked.push(['create', args]);
        return { id: CASE };
      },
      findUnique: async (args: unknown) => {
        asked.push(['findUnique', args]);
        return enrollment;
      },
      updateMany: async (args: unknown) => {
        asked.push(['updateMany', args]);
        return { count: moved };
      },
    },
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const text = sql.join('?');
      asked.push(['$queryRaw', text, values]);
      return text === CLOCK_SQL ? [{ at: CLOCK }] : [];
    },
  };
  return { tx: stand as unknown as Transaction, asked };
}

describe('openCompensationCase', () => {
  it('locks the enrollment, then joins the open case of the reason and opens none', async () => {
    const { tx, asked } = client({ open: { id: CASE } });
    expect(await openCompensationCase(tx, ENROLLMENT, 'duplicate_payment')).toEqual({
      caseId: CASE,
      opened: false,
    });
    expect(asked.map((call) => (call as unknown[])[0])).toEqual(['$queryRaw', 'findFirst']);
    expect(asked[0]).toEqual(['$queryRaw', LOCK_SQL, [[ENROLLMENT]]]);
  });

  it('locks the enrollment, then opens a case when none of the reason is open', async () => {
    const { tx, asked } = client();
    expect(await openCompensationCase(tx, ENROLLMENT, 'teacher_ended')).toEqual({
      caseId: CASE,
      opened: true,
    });
    expect(asked.map((call) => (call as unknown[])[0])).toEqual([
      '$queryRaw',
      'findFirst',
      'create',
    ]);
  });
});

describe('closeCase', () => {
  const CLOSING = {
    status: 'resolved',
    resolution: 'compensation_ordered',
    note: 'رد قيمة الحصص',
    adminId: ADMIN,
  } as const;

  it('answers null for no such case, with no lock and no write', async () => {
    const { tx, asked } = client();
    expect(await closeCase(tx, CASE, CLOSING)).toBeNull();
    expect(asked).toEqual([
      ['findUnique', { where: { id: CASE }, select: { enrollmentId: true } }],
    ]);
  });

  it("locks the case's enrollment, reads the database's clock, writes the closing at it and answers it", async () => {
    const { tx, asked } = client({ enrollment: { enrollmentId: ENROLLMENT } });
    expect(await closeCase(tx, CASE, CLOSING)).toBe(CLOCK);
    expect(asked).toEqual([
      ['findUnique', { where: { id: CASE }, select: { enrollmentId: true } }],
      ['$queryRaw', LOCK_SQL, [[ENROLLMENT]]],
      ['$queryRaw', CLOCK_SQL, []],
      [
        'updateMany',
        {
          where: { id: CASE, status: 'open' },
          data: {
            status: 'resolved',
            resolution: 'compensation_ordered',
            resolutionNotes: 'رد قيمة الحصص',
            resolvedByAdminId: ADMIN,
            resolvedAt: CLOCK,
            // No link on a closing that names none (ERD §15 rule 49; the note under T036).
            coveredByCaseId: null,
          },
        },
      ],
    ]);
  });

  it('answers null for a case no longer open, its conditional update moving no row', async () => {
    const { tx, asked } = client({ enrollment: { enrollmentId: ENROLLMENT }, moved: 0 });
    expect(
      await closeCase(tx, CASE, {
        status: 'dismissed',
        resolution: null,
        note: 'مكرر',
        adminId: ADMIN,
      }),
    ).toBeNull();
    expect(asked.map((call) => (call as unknown[])[0])).toEqual([
      'findUnique',
      '$queryRaw',
      '$queryRaw',
      'updateMany',
    ]);
  });
});

// 005:T014 (B47; FR-616, FR-GENDER-7; research R-409; data-model.md: a closed list in code, no
// migration): a gender correction's case, at the list's end; never a covering reason (Phase 2's
// three only). Written before the list changed, run red first.
describe('COMPENSATION_REASONS: the gender correction (005:T014)', () => {
  it('ends with gender_correction, which covers no second paid order', () => {
    // 003:T112 (rule d): `student_complaint_ended` follows it.
    expect(COMPENSATION_REASONS.at(-2)).toBe('gender_correction');
    expect(COMPENSATION_REASONS.at(-3)).toBe('admin_ended');
    expect(COVERING_REASONS).not.toContain('gender_correction');
  });
});

// 003:T112 (SRS FR-POSTPONE-6, DEC-90; Q-4 (a)): the administrator's end on a teacher's complaint
// against the student opens its case as `student_complaint_ended`, at the list's end; never a
// covering reason (Phase 2's three only). Written before the list changed, run red first.
describe('COMPENSATION_REASONS: the end on a complaint against the student (003:T112)', () => {
  it('ends with student_complaint_ended, which covers no second paid order', () => {
    expect(COMPENSATION_REASONS.at(-1)).toBe('student_complaint_ended');
    expect(COVERING_REASONS).not.toContain('student_complaint_ended');
  });
});
