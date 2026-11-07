// T041 — an account's end reaches its holds and pending enrollments (R-219, SRS FR-PAYG-6 and FR-BOOK-9
// as amended 2026-11-01, FR-VERIFY-8, FR-AUTH-14), over a store of fakes standing for catalog's
// teacher slots and booking's holds, and a recorded release standing for `releaseHolds`. What the
// fakes let a spec see plainly: which holds each termination finds, the reason each releases them
// with, and the order of the locks after the termination's account lock (T005: the teacher's slots'
// key, then the holds, whose release locks the holds, the enrollments and the orders). What the
// release does with the holds (the cancellation, its `enrollment_events` row, a paid order kept
// awaiting payment) is `holds.service.spec.ts`'s; the composition over the real tables, with
// identity's actions and the paid event after them, is `tests/db-integrity/termination.spec.ts`'s.
//
// T004 of specs/004-sessions (`003:T059`, FR-AUTH-14's confirmed part; R-313): on a deletion, the
// account's confirmed enrollments end too, after the holds and before the release's orders: the
// slots' keys of every teacher concerned in ascending id (L1), the holds, every enrollment in one
// statement, then sessions' hand-off (`cancelRemainingSessions`) with one `teacher_ended` case per
// enrollment for a teacher's and none for a student's, and the enrollments `cancelled`
// `account_deleted` with one row each. A suspension, a ban or a revocation reaches no confirmed
// enrollment here (T005's and T006's).
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { TerminationCause } from '../identity/index.js';
import type { EnrollmentOutcome } from './enrollment-events.repository.js';
import type { OrderStandings, ReleaseDependencies, ReleaseReason } from './holds.service.js';
import {
  type ConfirmedEnrollment,
  type TerminationDependencies,
  type TerminationStore,
  terminationSubscriber,
} from './termination.subscriber.js';

const tx = {} as Transaction;
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TEACHER = id(90);
const STUDENT = id(10);
const SLOT_A = id(40);
const SLOT_B = id(41);
const HOLD_ON_A = id(60);
const HOLD_ON_B = id(61);
const STUDENT_HOLD = id(62);
const NOW = new Date('2026-11-03T08:00:00Z');
const orders: OrderStandings = async () => new Map();

interface Released {
  readonly holdIds: readonly string[];
  readonly reason: ReleaseReason;
  readonly at: Date;
  readonly orders: OrderStandings;
}

/** A teacher with two slots, each held by a student, and a student holding one slot. */
function world(confirmed: readonly ConfirmedEnrollment[] = []) {
  const journal: string[] = [];
  const released: Released[] = [];
  const slots = new Map([[TEACHER, [SLOT_A, SLOT_B]]]);
  const holdsOnSlots = new Map([
    [SLOT_A, HOLD_ON_A],
    [SLOT_B, HOLD_ON_B],
  ]);
  const holdsOfStudents = new Map([[STUDENT, STUDENT_HOLD]]);
  const store: TerminationStore = {
    lockTeacherSlots: async (_tx, teacherUserId) => {
      journal.push(`lock-key:${teacherUserId}`);
    },
    teacherSlotIds: async (_tx, teacherUserId) => {
      journal.push(`slots:${teacherUserId}`);
      return slots.get(teacherUserId) ?? [];
    },
    activeHoldIds: async (_tx, scope) => {
      journal.push(
        'slotIds' in scope
          ? `holds-on:${scope.slotIds.join(',')}`
          : `holds-of:${scope.studentUserId}`,
      );
      if ('slotIds' in scope) {
        return scope.slotIds.flatMap((slotId) => {
          const hold = holdsOnSlots.get(slotId);
          return hold === undefined ? [] : [hold];
        });
      }
      const hold = holdsOfStudents.get(scope.studentUserId);
      return hold === undefined ? [] : [hold];
    },
    confirmedEnrollmentsOf: async (_tx, userId) => {
      journal.push(`confirmed-of:${userId}`);
      return confirmed.filter(
        ({ studentUserId, teacherUserId }) => studentUserId === userId || teacherUserId === userId,
      );
    },
    holdEnrollmentIds: async (_tx, holdIds) => {
      journal.push(`hold-enrollments:${holdIds.join(',')}`);
      return holdIds.map((holdId) => `enrollment-of-${holdId}`);
    },
    lockRows: async (_tx, table, ids) => {
      journal.push(`lock ${table}:${ids.join(',')}`);
    },
    openCase: async (_tx, enrollmentId, reason) => {
      journal.push(`case:${enrollmentId}:${reason}`);
      return `case-of-${enrollmentId}`;
    },
    cancelRemainingSessions: async (_tx, enrollmentIds, at, caseOf, options) => {
      expect(at).toBe(NOW);
      const lockOnly = options?.remedies === 'lockOnly';
      journal.push(`cancel-remaining:${enrollmentIds.join(',')}${lockOnly ? ':lockOnly' : ''}`);
      const cases = new Map<string, string | null>();
      for (const enrollmentId of enrollmentIds) {
        const caseId = await caseOf(enrollmentId);
        cases.set(enrollmentId, caseId);
        journal.push(`case-of:${enrollmentId}:${String(caseId)}`);
      }
      // Two sessions cancelled and one remedy handed (or lapsed, with no case) per enrollment.
      const owed = (handed: boolean) =>
        enrollmentIds
          .filter((one) => !lockOnly && (cases.get(one) !== null) === handed)
          .map((one) => `remedy-of-${one}`);
      return {
        cancelledSessionIds: enrollmentIds.flatMap((one) => [`s1-of-${one}`, `s2-of-${one}`]),
        handedRemedyIds: owed(true),
        lapsedRemedyIds: owed(false),
        caseOf: cases,
      };
    },
    freezeOpenRemedies: async (_tx, enrollmentIds, at) => {
      expect(at).toBe(NOW);
      journal.push(`freeze:${enrollmentIds.join(',')}`);
      return {
        frozenRemedyIds: enrollmentIds.map((one) => `remedy-of-${one}`),
        withdrawnCounterRemedyIds: [],
      };
    },
    cancelConfirmed: async (_tx, enrollmentIds, reason) => {
      journal.push(`cancel-confirmed:${enrollmentIds.join(',')}:${reason}`);
    },
    recordEvents: async (_tx, outcomes: readonly EnrollmentOutcome[]) => {
      journal.push(
        `events:${outcomes.map((outcome) => `${outcome.enrollmentId}:${outcome.kind}`).join(',')}`,
      );
      for (const outcome of outcomes) expect(outcome.occurredAt).toBe(NOW);
    },
    release: async (_tx, holdIds, reason, dependencies: ReleaseDependencies) => {
      journal.push(`release:${holdIds.join(',')}:${reason}`);
      released.push({ holdIds, reason, at: dependencies.at, orders: dependencies.orders });
      return { released: [...holdIds], cancelled: [], keptPending: [] };
    },
  };
  const logged: unknown[][] = [];
  const log = {
    info: (...args: unknown[]) => {
      logged.push(args);
    },
  } as unknown as TerminationDependencies['log'];
  const subscriber = terminationSubscriber({ orders, now: () => NOW, store, log });
  return { journal, released, subscriber, holdsOnSlots, holdsOfStudents, store, log, logged };
}

describe("a teacher's end releases the holds on the teacher's slots (R-219)", () => {
  it.each([
    ['suspended', 'teacher_suspended'],
    ['banned', 'teacher_suspended'],
    ['approval_revoked', 'teacher_suspended'],
    ['account_deleted', 'account_deleted'],
  ] as const)('%s releases them with %s', async (cause: TerminationCause, reason) => {
    const { released, subscriber } = world();
    await subscriber(tx, TEACHER, cause);
    expect(released).toEqual([{ holdIds: [HOLD_ON_A, HOLD_ON_B], reason, at: NOW, orders }]);
  });

  it("takes the teacher's slots' key before it reads the slots and their holds, and releases once", async () => {
    const { journal, subscriber } = world();
    await subscriber(tx, TEACHER, 'banned');
    expect(journal).toEqual([
      // A suspension or a ban reads the confirmed enrollments too, whose student it may be (T005).
      `confirmed-of:${TEACHER}`,
      `lock-key:${TEACHER}`,
      `slots:${TEACHER}`,
      `holds-on:${SLOT_A},${SLOT_B}`,
      `holds-of:${TEACHER}`,
      `release:${HOLD_ON_A},${HOLD_ON_B}:teacher_suspended`,
    ]);
  });

  it('releases nothing when no slot of the teacher is held', async () => {
    const { journal, released, subscriber, holdsOnSlots } = world();
    holdsOnSlots.clear();
    await subscriber(tx, TEACHER, 'suspended');
    expect(released).toEqual([]);
    expect(journal.some((entry) => entry.startsWith('release:'))).toBe(false);
  });
});

describe("a student's end releases the student's hold (R-219)", () => {
  it.each([
    ['suspended', 'admin'],
    ['banned', 'admin'],
    ['account_deleted', 'account_deleted'],
  ] as const)('%s releases it with %s', async (cause: TerminationCause, reason) => {
    const { released, subscriber } = world();
    await subscriber(tx, STUDENT, cause);
    expect(released).toEqual([{ holdIds: [STUDENT_HOLD], reason, at: NOW, orders }]);
  });

  it('releases nothing for a student holding nothing', async () => {
    const { released, subscriber, holdsOfStudents } = world();
    holdsOfStudents.clear();
    await subscriber(tx, STUDENT, 'account_deleted');
    expect(released).toEqual([]);
  });
});

const E1 = id(21);
const E2 = id(22);
const OTHER_STUDENT = id(11);
const LOW_TEACHER = id(85);
const HIGH_TEACHER = id(95);

describe("a deletion ends the account's confirmed enrollments (T004, FR-AUTH-14, R-313)", () => {
  it("a teacher's: the key, the holds, every enrollment in one call, sessions' hand-off with one teacher_ended case each, then the release", async () => {
    const { journal, subscriber } = world([
      { id: E2, studentUserId: OTHER_STUDENT, teacherUserId: TEACHER },
      { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
    ]);
    await subscriber(tx, TEACHER, 'account_deleted');
    expect(journal).toEqual([
      `confirmed-of:${TEACHER}`,
      `lock-key:${TEACHER}`,
      `slots:${TEACHER}`,
      `holds-on:${SLOT_A},${SLOT_B}`,
      `holds-of:${TEACHER}`,
      `lock slot_holds:${HOLD_ON_A},${HOLD_ON_B}`,
      `hold-enrollments:${HOLD_ON_A},${HOLD_ON_B}`,
      `lock enrollments:${[E1, E2, `enrollment-of-${HOLD_ON_A}`, `enrollment-of-${HOLD_ON_B}`].sort().join(',')}`,
      `confirmed-of:${TEACHER}`,
      `cancel-remaining:${E1},${E2}`,
      `case:${E1}:teacher_ended`,
      `case-of:${E1}:case-of-${E1}`,
      `case:${E2}:teacher_ended`,
      `case-of:${E2}:case-of-${E2}`,
      `cancel-confirmed:${E1},${E2}:account_deleted`,
      `events:${E1}:cancelled,${E2}:cancelled`,
      `release:${HOLD_ON_A},${HOLD_ON_B}:account_deleted`,
    ]);
  });

  it("a student's: each of their teachers' keys in ascending id, and no case", async () => {
    const { journal, subscriber, holdsOfStudents } = world([
      { id: E2, studentUserId: STUDENT, teacherUserId: HIGH_TEACHER },
      { id: E1, studentUserId: STUDENT, teacherUserId: LOW_TEACHER },
    ]);
    holdsOfStudents.clear();
    await subscriber(tx, STUDENT, 'account_deleted');
    expect(journal.filter((entry) => entry.startsWith('lock-key:'))).toEqual([
      `lock-key:${STUDENT}`,
      `lock-key:${LOW_TEACHER}`,
      `lock-key:${HIGH_TEACHER}`,
    ]);
    expect(journal.some((entry) => entry.startsWith('case:'))).toBe(false);
    expect(journal).toEqual(
      expect.arrayContaining([
        `lock enrollments:${E1},${E2}`,
        `case-of:${E1}:null`,
        `case-of:${E2}:null`,
        `cancel-confirmed:${E1},${E2}:account_deleted`,
        `events:${E1}:cancelled,${E2}:cancelled`,
      ]),
    );
    expect(journal.some((entry) => entry.startsWith('lock slot_holds:'))).toBe(false);
  });

  it('an enrollment no longer confirmed once its lock is held is left as it is', async () => {
    const over = world([{ id: E1, studentUserId: STUDENT, teacherUserId: TEACHER }]);
    let reads = 0;
    const store: TerminationStore = {
      ...over.store,
      confirmedEnrollmentsOf: async (t, userId) => {
        reads += 1;
        // Another path ended it while this one waited on its lock.
        return reads === 1 ? over.store.confirmedEnrollmentsOf(t, userId) : [];
      },
    };
    await terminationSubscriber({ orders, now: () => NOW, store, log: over.log })(
      tx,
      TEACHER,
      'account_deleted',
    );
    expect(reads).toBe(2);
    expect(over.journal.filter((entry) => /^(cancel-|case|events:)/.test(entry))).toEqual([]);
  });

  it.each(['suspended', 'banned', 'approval_revoked'] as const)(
    "a teacher's %s reaches no confirmed enrollment here (T006's)",
    async (cause) => {
      const { journal, subscriber } = world([
        { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
      ]);
      await subscriber(tx, TEACHER, cause);
      expect(journal.some((entry) => /^(cancel-|case|freeze|events:)/.test(entry))).toBe(false);
      expect(journal.some((entry) => entry.startsWith('lock enrollments:'))).toBe(false);
    },
  );
});

// T005 of specs/004-sessions (`002:T144`; FR-485, FR-486; R-313; plan.md decision 1): a student's
// suspension and ban reach their confirmed enrollments, in kernel.md's order for an account's end:
// each of their teachers' slots' keys in ascending id (L1), the holds, every enrollment in one call,
// then sessions' hand-off with one case each, the remedies frozen on a suspension (C3).
describe("a student's suspension and ban reach their confirmed enrollments (T005, R-313)", () => {
  const twoTeachers = () =>
    world([
      { id: E2, studentUserId: STUDENT, teacherUserId: HIGH_TEACHER },
      { id: E1, studentUserId: STUDENT, teacherUserId: LOW_TEACHER },
    ]);

  it('a suspension: the keys ascending, the holds, the enrollments, the sessions cancelled with the remedies locked only, one student_suspended case each, then the remedies frozen; the enrollments stay confirmed', async () => {
    const { journal, subscriber } = twoTeachers();
    await subscriber(tx, STUDENT, 'suspended');
    expect(journal).toEqual([
      `confirmed-of:${STUDENT}`,
      `lock-key:${STUDENT}`,
      `lock-key:${LOW_TEACHER}`,
      `lock-key:${HIGH_TEACHER}`,
      `slots:${STUDENT}`,
      'holds-on:',
      `holds-of:${STUDENT}`,
      `lock slot_holds:${STUDENT_HOLD}`,
      `hold-enrollments:${STUDENT_HOLD}`,
      `lock enrollments:${[E1, E2, `enrollment-of-${STUDENT_HOLD}`].sort().join(',')}`,
      `confirmed-of:${STUDENT}`,
      `cancel-remaining:${E1},${E2}:lockOnly`,
      `case:${E1}:student_suspended`,
      `case-of:${E1}:case-of-${E1}`,
      `case:${E2}:student_suspended`,
      `case-of:${E2}:case-of-${E2}`,
      `freeze:${E1},${E2}`,
      `release:${STUDENT_HOLD}:admin`,
    ]);
  });

  it('a ban: the open remedies handed to one student_banned case each, the enrollments cancelled admin at once with one row each', async () => {
    const { journal, subscriber } = twoTeachers();
    await subscriber(tx, STUDENT, 'banned');
    expect(journal.filter((entry) => entry.startsWith('lock-key:'))).toEqual([
      `lock-key:${STUDENT}`,
      `lock-key:${LOW_TEACHER}`,
      `lock-key:${HIGH_TEACHER}`,
    ]);
    expect(journal.slice(journal.indexOf(`cancel-remaining:${E1},${E2}`))).toEqual([
      `cancel-remaining:${E1},${E2}`,
      `case:${E1}:student_banned`,
      `case-of:${E1}:case-of-${E1}`,
      `case:${E2}:student_banned`,
      `case-of:${E2}:case-of-${E2}`,
      `cancel-confirmed:${E1},${E2}:admin`,
      `events:${E1}:cancelled,${E2}:cancelled`,
      `release:${STUDENT_HOLD}:admin`,
    ]);
    expect(journal.some((entry) => entry.startsWith('freeze:'))).toBe(false);
  });

  it("only the student's own enrollments: another student's of the same teacher is left alone", async () => {
    const { journal, subscriber } = world([
      { id: E1, studentUserId: STUDENT, teacherUserId: LOW_TEACHER },
      { id: E2, studentUserId: OTHER_STUDENT, teacherUserId: LOW_TEACHER },
    ]);
    await subscriber(tx, OTHER_STUDENT, 'banned');
    expect(journal).toContain(`cancel-confirmed:${E2}:admin`);
    expect(journal.some((entry) => entry.includes(E1))).toBe(false);
  });

  it('a student with no confirmed enrollment: only the hold released', async () => {
    const { journal, subscriber } = world();
    await subscriber(tx, STUDENT, 'suspended');
    expect(journal.some((entry) => /^(lock enrollments|cancel-|case|freeze)/.test(entry))).toBe(
      false,
    );
    expect(journal).toContain(`release:${STUDENT_HOLD}:admin`);
  });
});

const line = (fields: Record<string, unknown>) => [fields, 'Account end decided'];

describe('one info line per account end, ids and counts only (the note under T005)', () => {
  it("a student's suspension: the enrollments, the sessions cancelled, the remedies frozen, none handed, the cases", async () => {
    const { logged, subscriber } = world([
      { id: E2, studentUserId: STUDENT, teacherUserId: HIGH_TEACHER },
      { id: E1, studentUserId: STUDENT, teacherUserId: LOW_TEACHER },
    ]);
    await subscriber(tx, STUDENT, 'suspended');
    expect(logged).toEqual([
      line({
        userId: STUDENT,
        cause: 'suspended',
        enrollments: 2,
        cancelledSessions: 4,
        frozenRemedies: 2,
        handedRemedies: 0,
        lapsedRemedies: 0,
        cases: 2,
      }),
    ]);
  });

  it("a student's ban: the remedies handed, none frozen", async () => {
    const { logged, subscriber } = world([
      { id: E1, studentUserId: STUDENT, teacherUserId: LOW_TEACHER },
    ]);
    await subscriber(tx, STUDENT, 'banned');
    expect(logged).toEqual([
      line({
        userId: STUDENT,
        cause: 'banned',
        enrollments: 1,
        cancelledSessions: 2,
        frozenRemedies: 0,
        handedRemedies: 1,
        lapsedRemedies: 0,
        cases: 1,
      }),
    ]);
  });

  it("a deletion, either role: a teacher's with its cases, a student's with none, nothing handed and its remedy lapsed", async () => {
    const teacher = world([
      { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
      { id: E2, studentUserId: OTHER_STUDENT, teacherUserId: TEACHER },
    ]);
    await teacher.subscriber(tx, TEACHER, 'account_deleted');
    expect(teacher.logged).toEqual([
      line({
        userId: TEACHER,
        cause: 'account_deleted',
        enrollments: 2,
        cancelledSessions: 4,
        frozenRemedies: 0,
        handedRemedies: 2,
        lapsedRemedies: 0,
        cases: 2,
      }),
    ]);
    const student = world([{ id: E1, studentUserId: STUDENT, teacherUserId: TEACHER }]);
    await student.subscriber(tx, STUDENT, 'account_deleted');
    expect(student.logged).toEqual([
      line({
        userId: STUDENT,
        cause: 'account_deleted',
        enrollments: 1,
        cancelledSessions: 2,
        frozenRemedies: 0,
        handedRemedies: 0,
        lapsedRemedies: 1,
        cases: 0,
      }),
    ]);
  });

  it('an end with no confirmed enrollment writes the line with zero counts', async () => {
    const { logged, subscriber } = world();
    await subscriber(tx, STUDENT, 'banned');
    expect(logged).toEqual([
      line({
        userId: STUDENT,
        cause: 'banned',
        enrollments: 0,
        cancelledSessions: 0,
        frozenRemedies: 0,
        handedRemedies: 0,
        lapsedRemedies: 0,
        cases: 0,
      }),
    ]);
  });
});
