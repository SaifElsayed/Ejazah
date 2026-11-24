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
// `account_deleted` with one row each. A student's suspension and ban (T005) and a teacher's
// suspension, ban and revocation (T006) reach them too, below.
//
// T066 of specs/004-sessions: each confirmed enrollment the end decided on sends `enrollment` to its
// other party, addressed from the rows read under the enrollments' lock, through the after-commit
// list the action bound to its transaction (the administrator kind's, or the deletion's own), sent
// once it commits, nothing on a rollback.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { LiveMessage } from '../../platform/live/live-bus.js';
import {
  bindToTransaction,
  type LivePublisher,
  RequestLive,
} from '../../platform/live/live-publisher.js';
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
/** T071: the administrator `#end` passes as the consequence's `actor`. */
const ADMIN = id(1);
const STUDENT = id(10);
const SLOT_A = id(40);
const SLOT_B = id(41);
const HOLD_ON_A = id(60);
const HOLD_ON_B = id(61);
const STUDENT_HOLD = id(62);
const NOW = new Date('2026-11-03T08:00:00Z');
const orders: OrderStandings = async () => new Map();
/** 006:T008: payments' `deleteProgrammeCard` as the root hands it (T013: the card deleted). */
const CARD = async (): Promise<void> => undefined;

interface Released {
  readonly holdIds: readonly string[];
  readonly reason: ReleaseReason;
  readonly at: Date;
  readonly orders: OrderStandings;
}

/**
 * A teacher with two slots, each held by a student, and a student holding one slot; `paused` maps an
 * enrollment to its open `teacher_suspended` case (T071).
 */
function world(
  confirmed: readonly ConfirmedEnrollment[] = [],
  paused: Readonly<Record<string, string>> = {},
  // 006:T012: the enrollments that carry a programme, and the card entry handed in.
  programmes: readonly string[] = [],
  card: (tx: Transaction, enrollmentId: string) => Promise<void> = CARD,
) {
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
    // T071: the paused enrollment's open `teacher_suspended` case, and moderation's `closeCase`.
    // Journaled only where a case is open, so the journals of the specs before T071 hold as written.
    pausedCaseOf: async (_tx, enrollmentId) => {
      const open = paused[enrollmentId] ?? null;
      if (open !== null) journal.push(`paused-case-of:${enrollmentId}`);
      return open;
    },
    closeCase: async (_tx, caseId, closing) => {
      journal.push(`close-case:${caseId}:${JSON.stringify(closing)}`);
      return NOW;
    },
    // 006:T012: booking's programme of an enrollment (`programmeStateOf`), journaled.
    programmeStateOf: async (_tx, enrollmentId) => {
      journal.push(`programme-of:${enrollmentId}`);
      return programmes.includes(enrollmentId) ? 'active' : null;
    },
    // 006:T008 (Q-2 (a)): booking's close hook, journaled with the card entry it was handed.
    closeProgrammes: async (_tx, enrollmentIds, cause, dependencies) => {
      journal.push(`close-programmes:${enrollmentIds.join(',')}:${cause}`);
      expect(dependencies.deleteProgrammeCard).toBe(card);
      return [...enrollmentIds];
    },
    release: async (_tx, holdIds, reason, dependencies: ReleaseDependencies) => {
      journal.push(`release:${holdIds.join(',')}:${reason}`);
      released.push({ holdIds, reason, at: dependencies.at, orders: dependencies.orders });
      return { released: [...holdIds], cancelled: [], keptPending: [] };
    },
  };
  const logged: unknown[][] = [];
  const warned: unknown[][] = [];
  const log = {
    info: (...args: unknown[]) => {
      logged.push(args);
    },
    warn: (...args: unknown[]) => {
      warned.push(args);
    },
  } as unknown as TerminationDependencies['log'];
  const subscriber = terminationSubscriber({
    orders,
    now: () => NOW,
    store,
    log,
    deleteProgrammeCard: card,
  });
  return {
    journal,
    released,
    subscriber,
    holdsOnSlots,
    holdsOfStudents,
    store,
    log,
    logged,
    warned,
  };
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
      // 006:T008 (rule d): the programmes before the enrollments.
      `lock programmes:${[E1, E2, `enrollment-of-${HOLD_ON_A}`, `enrollment-of-${HOLD_ON_B}`].sort().join(',')}`,
      `lock enrollments:${[E1, E2, `enrollment-of-${HOLD_ON_A}`, `enrollment-of-${HOLD_ON_B}`].sort().join(',')}`,
      `confirmed-of:${TEACHER}`,
      `cancel-remaining:${E1},${E2}`,
      `case:${E1}:teacher_ended`,
      `case-of:${E1}:case-of-${E1}`,
      `case:${E2}:teacher_ended`,
      `case-of:${E2}:case-of-${E2}`,
      `cancel-confirmed:${E1},${E2}:account_deleted`,
      `events:${E1}:cancelled,${E2}:cancelled`,
      `close-programmes:${E1},${E2}:account_deleted`,
      `release:${HOLD_ON_A},${HOLD_ON_B}:account_deleted`,
    ]);
  });

  // 003:T125 (SRS DEC-96, FR-AUTH-14, FR-ADMIN-22 as amended; an approved rewrite): a student's
  // deletion by an administrator opens one `account_deleted` case per enrollment it ends, which its
  // sessions' rows name and its open remedies are handed to. Run red first.
  it("a student's: each of their teachers' keys in ascending id, and one account_deleted case each", async () => {
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
    expect(journal).toEqual(
      expect.arrayContaining([
        // 006:T008 (rule d): the programmes before the enrollments.
        `lock programmes:${E1},${E2}`,
        `lock enrollments:${E1},${E2}`,
        `case:${E1}:account_deleted`,
        `case-of:${E1}:case-of-${E1}`,
        `case:${E2}:account_deleted`,
        `case-of:${E2}:case-of-${E2}`,
        `cancel-confirmed:${E1},${E2}:account_deleted`,
        `events:${E1}:cancelled,${E2}:cancelled`,
        `close-programmes:${E1},${E2}:account_deleted`,
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
});

// T006 of specs/004-sessions (FR-482, FR-483, FR-485; R-313): a teacher's suspension, revocation and
// ban end the teacher's confirmed enrollments in kernel.md's order for an account's end, as a
// teacher's deletion does: the teacher's slots' key, the holds, every enrollment in one call, then
// sessions' hand-off (every remaining session, one in its join period included) with one
// `teacher_ended` case each, which the open remedies, `frozen` included, are handed to, then the
// enrollments `cancelled` `teacher_suspended` with one row each.
describe("a teacher's end cancels the teacher's confirmed enrollments (T006, FR-483, R-313)", () => {
  // T071 (rule d): a suspension pauses now (below); the ban's and the revocation's cases unchanged.
  it.each(['banned', 'approval_revoked'] as const)(
    "%s: the key, the holds, every enrollment in one call, sessions' hand-off with one teacher_ended case each, the enrollments cancelled teacher_suspended, then the release",
    async (cause) => {
      const { journal, subscriber } = world([
        { id: E2, studentUserId: OTHER_STUDENT, teacherUserId: TEACHER },
        { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
      ]);
      await subscriber(tx, TEACHER, cause);
      expect(journal).toEqual([
        `confirmed-of:${TEACHER}`,
        `lock-key:${TEACHER}`,
        `slots:${TEACHER}`,
        `holds-on:${SLOT_A},${SLOT_B}`,
        `holds-of:${TEACHER}`,
        `lock slot_holds:${HOLD_ON_A},${HOLD_ON_B}`,
        `hold-enrollments:${HOLD_ON_A},${HOLD_ON_B}`,
        // 006:T008 (rule d): the programmes before the enrollments.
        `lock programmes:${[E1, E2, `enrollment-of-${HOLD_ON_A}`, `enrollment-of-${HOLD_ON_B}`].sort().join(',')}`,
        `lock enrollments:${[E1, E2, `enrollment-of-${HOLD_ON_A}`, `enrollment-of-${HOLD_ON_B}`].sort().join(',')}`,
        `confirmed-of:${TEACHER}`,
        `cancel-remaining:${E1},${E2}`,
        `case:${E1}:teacher_ended`,
        `case-of:${E1}:case-of-${E1}`,
        `case:${E2}:teacher_ended`,
        `case-of:${E2}:case-of-${E2}`,
        `cancel-confirmed:${E1},${E2}:teacher_suspended`,
        `events:${E1}:cancelled,${E2}:cancelled`,
        `close-programmes:${E1},${E2}:teacher_suspended`,
        `release:${HOLD_ON_A},${HOLD_ON_B}:teacher_suspended`,
      ]);
    },
  );

  // T071 (rule d): a ban and a revocation, the two teacher's ends that still cancel; a suspension
  // freezes now (below).
  it.each(['banned', 'approval_revoked'] as const)(
    'freezes nothing: a teacher’s end (%s) hands every open remedy to the case',
    async (cause) => {
      const { journal, subscriber } = world([
        { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
      ]);
      await subscriber(tx, TEACHER, cause);
      expect(journal.some((entry) => entry.startsWith('freeze:'))).toBe(false);
      expect(journal.some((entry) => entry.endsWith(':lockOnly'))).toBe(false);
    },
  );

  it('writes one info line with its counts (the note under T006)', async () => {
    const { logged, subscriber } = world([
      { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
      { id: E2, studentUserId: OTHER_STUDENT, teacherUserId: TEACHER },
    ]);
    await subscriber(tx, TEACHER, 'approval_revoked');
    expect(logged).toEqual([
      [
        {
          userId: TEACHER,
          cause: 'approval_revoked',
          enrollments: 2,
          cancelledSessions: 4,
          frozenRemedies: 0,
          handedRemedies: 2,
          lapsedRemedies: 0,
          cases: 2,
        },
        'Account end decided',
      ],
    ]);
  });
});

// T071 of specs/004-sessions (FR-504; SRS FR-SESS-16 as amended; R-313's table as updated): a
// teacher's suspension pauses the teacher's confirmed enrollments as a student's suspension does, in
// the same order: the key, the holds, every enrollment in one call, sessions' hand-off with the
// remedies locked only and one `teacher_suspended` case each, then the open remedies frozen; the
// enrollments stay `confirmed`, with their slots, and no `enrollment_events` row is written.
describe("a teacher's suspension pauses the teacher's confirmed enrollments (T071, FR-504)", () => {
  const twoStudents = () =>
    world([
      { id: E2, studentUserId: OTHER_STUDENT, teacherUserId: TEACHER },
      { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
    ]);

  it('the key, the holds, every enrollment in one call, the sessions cancelled with the remedies locked only, one teacher_suspended case each, the remedies frozen, then the release; nothing cancelled', async () => {
    const { journal, subscriber } = twoStudents();
    await subscriber(tx, TEACHER, 'suspended', { adminId: ADMIN });
    expect(journal).toEqual([
      `confirmed-of:${TEACHER}`,
      `lock-key:${TEACHER}`,
      `slots:${TEACHER}`,
      `holds-on:${SLOT_A},${SLOT_B}`,
      `holds-of:${TEACHER}`,
      `lock slot_holds:${HOLD_ON_A},${HOLD_ON_B}`,
      `hold-enrollments:${HOLD_ON_A},${HOLD_ON_B}`,
      // 006:T008 (rule d): the programmes before the enrollments.
      `lock programmes:${[E1, E2, `enrollment-of-${HOLD_ON_A}`, `enrollment-of-${HOLD_ON_B}`].sort().join(',')}`,
      `lock enrollments:${[E1, E2, `enrollment-of-${HOLD_ON_A}`, `enrollment-of-${HOLD_ON_B}`].sort().join(',')}`,
      `confirmed-of:${TEACHER}`,
      `cancel-remaining:${E1},${E2}:lockOnly`,
      `case:${E1}:teacher_suspended`,
      `case-of:${E1}:case-of-${E1}`,
      `case:${E2}:teacher_suspended`,
      `case-of:${E2}:case-of-${E2}`,
      `freeze:${E1},${E2}`,
      // 006:T012: the programmes among them read, each one's card deleted (none here).
      `programme-of:${E1}`,
      `programme-of:${E2}`,
      `release:${HOLD_ON_A},${HOLD_ON_B}:teacher_suspended`,
    ]);
  });

  it('writes one info line: the remedies frozen, none handed, the cases', async () => {
    const { logged, subscriber } = twoStudents();
    await subscriber(tx, TEACHER, 'suspended', { adminId: ADMIN });
    expect(logged).toEqual([
      [
        {
          userId: TEACHER,
          cause: 'suspended',
          enrollments: 2,
          cancelledSessions: 4,
          frozenRemedies: 2,
          handedRemedies: 0,
          lapsedRemedies: 0,
          cases: 2,
        },
        'Account end decided',
      ],
    ]);
  });
});

// T071, the first note under it (Q5 (a), widened by the review session; Q5.2 (a), Q5.3 (a)): any end
// of a paused enrollment closes its open `teacher_suspended` case in the end's transaction, after
// the end's own case and rows, `disputes` last: `resolved`, `compensation_ordered`, the fixed note
// `ended_meanwhile`, covered by the end's case, by the administrator `#end` passes as `actor`. A
// self-deletion (no administrator) leaves it open with one warn line of ids.
describe('an end of a paused enrollment closes its teacher_suspended case (T071, Q5 (a) widened)', () => {
  const PAUSED_1 = id(71);
  const PAUSED_2 = id(72);
  const closedBy = (caseId: string, coveredBy: string) =>
    `close-case:${caseId}:${JSON.stringify({
      status: 'resolved',
      resolution: 'compensation_ordered',
      note: 'ended_meanwhile',
      adminId: ADMIN,
      coveredBy,
    })}`;

  it.each(['banned', 'approval_revoked'] as const)(
    'P1/P2 a teacher’s %s: each closed covered by its teacher_ended case, after the rows and before the release',
    async (cause) => {
      const { journal, subscriber } = world(
        [
          { id: E2, studentUserId: OTHER_STUDENT, teacherUserId: TEACHER },
          { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
        ],
        { [E1]: PAUSED_1, [E2]: PAUSED_2 },
      );
      await subscriber(tx, TEACHER, cause, { adminId: ADMIN });
      expect(journal.slice(journal.indexOf(`events:${E1}:cancelled,${E2}:cancelled`))).toEqual([
        `events:${E1}:cancelled,${E2}:cancelled`,
        // 006:T008 (rule d): the close hook before the paused cases' closing, `disputes` last.
        `close-programmes:${E1},${E2}:teacher_suspended`,
        `paused-case-of:${E1}`,
        closedBy(PAUSED_1, `case-of-${E1}`),
        `paused-case-of:${E2}`,
        closedBy(PAUSED_2, `case-of-${E2}`),
        `release:${HOLD_ON_A},${HOLD_ON_B}:teacher_suspended`,
      ]);
    },
  );

  it('P3 a student’s ban: closed covered by the student_banned case', async () => {
    const { journal, subscriber, holdsOfStudents } = world(
      [{ id: E1, studentUserId: STUDENT, teacherUserId: LOW_TEACHER }],
      { [E1]: PAUSED_1 },
    );
    holdsOfStudents.clear();
    await subscriber(tx, STUDENT, 'banned', { adminId: ADMIN });
    expect(journal.slice(journal.indexOf(`case:${E1}:student_banned`))).toEqual([
      `case:${E1}:student_banned`,
      `case-of:${E1}:case-of-${E1}`,
      `cancel-confirmed:${E1}:admin`,
      `events:${E1}:cancelled`,
      // 006:T008 (rule d): the close hook before the paused case's closing, `disputes` last.
      `close-programmes:${E1}:admin`,
      `paused-case-of:${E1}`,
      closedBy(PAUSED_1, `case-of-${E1}`),
    ]);
  });

  it('writes one info line of ids per case closed', async () => {
    const { logged, subscriber } = world(
      [{ id: E1, studentUserId: STUDENT, teacherUserId: TEACHER }],
      { [E1]: PAUSED_1 },
    );
    await subscriber(tx, TEACHER, 'banned', { adminId: ADMIN });
    expect(logged).toContainEqual([
      {
        adminId: ADMIN,
        enrollmentId: E1,
        caseId: PAUSED_1,
        coveredByCaseId: `case-of-${E1}`,
        end: 'banned',
      },
      'A paused enrollment’s teacher_suspended case closed by its end',
    ]);
  });

  it.each([
    ['P4 a teacher’s own deletion', TEACHER, `case-of-${E1}`],
    // 003:T125 (rule d): a student's deletion opens its `account_deleted` case too.
    ['P5 a student’s own deletion', STUDENT, `case-of-${E1}`],
  ] as const)(
    '%s leaves it open with one warn line of ids (no administrator acted)',
    async (_path, userId, endCase) => {
      const { journal, warned, subscriber, holdsOfStudents } = world(
        [{ id: E1, studentUserId: STUDENT, teacherUserId: TEACHER }],
        { [E1]: PAUSED_1 },
      );
      holdsOfStudents.clear();
      await subscriber(tx, userId, 'account_deleted');
      expect(journal.some((entry) => entry.startsWith('close-case:'))).toBe(false);
      expect(warned).toEqual([
        [
          {
            userId,
            cause: 'account_deleted',
            enrollmentId: E1,
            caseId: PAUSED_1,
            coveredByCaseId: endCase,
          },
          'A paused enrollment ended with no administrator: its teacher_suspended case is left open',
        ],
      ]);
    },
  );

  it('a student’s suspension of a paused enrollment ends nothing and closes nothing: a second case opens', async () => {
    const { journal, subscriber, holdsOfStudents } = world(
      [{ id: E1, studentUserId: STUDENT, teacherUserId: LOW_TEACHER }],
      { [E1]: PAUSED_1 },
    );
    holdsOfStudents.clear();
    await subscriber(tx, STUDENT, 'suspended', { adminId: ADMIN });
    expect(journal).toContain(`case:${E1}:student_suspended`);
    expect(
      journal.some((entry) => /^(close-case|cancel-confirmed|paused-case-of)/.test(entry)),
    ).toBe(false);
  });

  it('an ended enrollment with no open teacher_suspended case closes nothing', async () => {
    const { journal, subscriber } = world([
      { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
    ]);
    await subscriber(tx, TEACHER, 'banned', { adminId: ADMIN });
    expect(journal.some((entry) => entry.startsWith('close-case:'))).toBe(false);
  });
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
      // 006:T008 (rule d): the programmes before the enrollments.
      `lock programmes:${[E1, E2, `enrollment-of-${STUDENT_HOLD}`].sort().join(',')}`,
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
      `close-programmes:${E1},${E2}:admin`,
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

  // 003:T125 (an approved rewrite): a student's deletion opens its case too, its remedy handed to it.
  it("a deletion, either role: a teacher's with its cases, a student's with its account_deleted case, its remedy handed", async () => {
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
        handedRemedies: 1,
        lapsedRemedies: 0,
        cases: 1,
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

// T066 of specs/004-sessions (FR-427; research R-324, item 6; the note under T066, Q3 (a)).
describe('an account’s end tells the other party of each enrollment it decided on (T066)', () => {
  /**
   * The action's after-commit list bound to its transaction, flushed on its commit, dropped
   * otherwise; what the action added, sent or not, is kept in `added`.
   */
  let added: LiveMessage[] = [];

  async function boundTo(work: (call: Transaction) => Promise<void>, commitFails = false) {
    const published: LiveMessage[] = [];
    const live = new RequestLive(
      { publish: (message) => void published.push(message) },
      { warn: () => undefined },
    );
    const call = {} as Transaction;
    added = [];
    const recording: LivePublisher = {
      afterCommit: (to, event, scope) => {
        added.push({ to: [...to], event });
        live.afterCommit(to, event, scope);
      },
    };
    const unbind = bindToTransaction(call, recording);
    try {
      await work(call);
      if (commitFails) throw new Error('the commit failed');
      live.flush();
    } catch {
      live.drop();
    } finally {
      unbind();
    }
    return published;
  }

  const told = (to: string, enrollmentId: string) => ({
    to: [to],
    event: { type: 'enrollment', enrollmentId },
  });

  it.each(['suspended', 'banned', 'approval_revoked', 'account_deleted'] as const)(
    'a teacher’s end (%s) sends enrollment to each student, never to the teacher',
    async (cause) => {
      const { subscriber } = world([
        { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
        { id: E2, studentUserId: OTHER_STUDENT, teacherUserId: TEACHER },
      ]);
      expect(await boundTo((call) => subscriber(call, TEACHER, cause))).toEqual([
        told(STUDENT, E1),
        told(OTHER_STUDENT, E2),
      ]);
    },
  );

  it.each(['suspended', 'banned', 'account_deleted'] as const)(
    'a student’s end (%s) sends enrollment to each teacher, the enrollments kept by a suspension included',
    async (cause) => {
      const { subscriber } = world([
        { id: E2, studentUserId: STUDENT, teacherUserId: HIGH_TEACHER },
        { id: E1, studentUserId: STUDENT, teacherUserId: LOW_TEACHER },
      ]);
      expect(await boundTo((call) => subscriber(call, STUDENT, cause))).toEqual([
        told(LOW_TEACHER, E1),
        told(HIGH_TEACHER, E2),
      ]);
    },
  );

  it('sends nothing when the action rolls back, and nothing for an enrollment no longer confirmed under its lock', async () => {
    const rolledBack = world([{ id: E1, studentUserId: STUDENT, teacherUserId: TEACHER }]);
    expect(
      await boundTo((call) => rolledBack.subscriber(call, TEACHER, 'suspended'), true),
    ).toEqual([]);

    const over = world([{ id: E1, studentUserId: STUDENT, teacherUserId: TEACHER }]);
    let reads = 0;
    const store: TerminationStore = {
      ...over.store,
      confirmedEnrollmentsOf: async (t, userId) => {
        reads += 1;
        return reads === 1 ? over.store.confirmedEnrollmentsOf(t, userId) : [];
      },
    };
    const ended = terminationSubscriber({ orders, now: () => NOW, store, log: over.log });
    expect(await boundTo((call) => ended(call, TEACHER, 'suspended'))).toEqual([]);
    expect(added).toEqual([]);
  });

  it('a released hold alone, with no confirmed enrollment, sends nothing', async () => {
    const { subscriber, released } = world();
    expect(await boundTo((call) => subscriber(call, TEACHER, 'suspended'))).toEqual([]);
    expect(released).not.toEqual([]);
    expect(added).toEqual([]);
  });

  it('on a transaction no action bound, sends nothing and still decides', async () => {
    const { subscriber, journal } = world([
      { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
    ]);
    // T071 (rule d): a ban, which still cancels; a suspension pauses now.
    await subscriber(tx, TEACHER, 'banned');
    expect(journal).toContain(`cancel-confirmed:${E1}:teacher_suspended`);
  });
});

// 006:T008 of specs/006-programme (R-510; B-P2's conflict check, Q-2 (a); kernel.md, 006:T008's
// row): the programmes' rows are taken after the holds and before the enrollments, every end that
// cancels runs booking's close hook on the enrollments it cancelled, after their events and before a
// paused case's closing (`disputes` last), with payments' card entry the root handed in; a
// suspension, which keeps its enrollments `confirmed`, closes nothing.
describe('an account’s end closes its programmes, the programme’s row before the enrollment’s (006:T008, Q-2 (a))', () => {
  const two = () =>
    world([
      { id: E2, studentUserId: OTHER_STUDENT, teacherUserId: TEACHER },
      { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
    ]);
  const enrollments = [E1, E2, `enrollment-of-${HOLD_ON_A}`, `enrollment-of-${HOLD_ON_B}`]
    .sort()
    .join(',');

  it('takes the programmes’ rows after the holds and before the enrollments', async () => {
    const { journal, subscriber } = two();
    await subscriber(tx, TEACHER, 'banned', { adminId: ADMIN });
    const programmes = journal.indexOf(`lock programmes:${enrollments}`);
    expect(programmes).toBeGreaterThan(
      journal.indexOf(`lock slot_holds:${HOLD_ON_A},${HOLD_ON_B}`),
    );
    expect(journal[programmes + 1]).toBe(`lock enrollments:${enrollments}`);
  });

  it.each([
    ['banned', 'teacher_suspended'],
    ['approval_revoked', 'teacher_suspended'],
    ['account_deleted', 'account_deleted'],
  ] as const)(
    '%s: the programmes cancelled closed through the close hook, after their events',
    async (cause, reason) => {
      const { journal, subscriber } = two();
      await subscriber(tx, TEACHER, cause, { adminId: ADMIN });
      const events = journal.indexOf(`events:${E1}:cancelled,${E2}:cancelled`);
      expect(journal[events + 1]).toBe(`close-programmes:${E1},${E2}:${reason}`);
      expect(journal.filter((entry) => entry.startsWith('close-programmes:'))).toHaveLength(1);
    },
  );

  it('a suspension keeps its programmes open: their rows locked, nothing closed', async () => {
    const { journal, subscriber } = two();
    await subscriber(tx, TEACHER, 'suspended', { adminId: ADMIN });
    expect(journal).toContain(`lock programmes:${enrollments}`);
    expect(journal.some((entry) => entry.startsWith('close-programmes:'))).toBe(false);
  });
});

describe('a teacher’s suspension deletes its programmes’ saved cards at once (006:T012, DEC-94)', () => {
  const recorded = () => {
    const deleted: string[] = [];
    const card = async (_tx: Transaction, enrollmentId: string): Promise<void> => {
      deleted.push(enrollmentId);
    };
    return { deleted, card };
  };
  const confirmed = [
    { id: E2, studentUserId: OTHER_STUDENT, teacherUserId: TEACHER },
    { id: E1, studentUserId: STUDENT, teacherUserId: TEACHER },
  ];

  it('calls payments’ deleteProgrammeCard for each programme it pauses, after the remedies are frozen, and logs it', async () => {
    const { deleted, card } = recorded();
    const { journal, logged, subscriber } = world(confirmed, {}, [E1], card);
    await subscriber(tx, TEACHER, 'suspended', { adminId: ADMIN });

    expect(deleted).toEqual([E1]);
    const freeze = journal.indexOf(`freeze:${E1},${E2}`);
    expect(journal.slice(freeze + 1, freeze + 3)).toEqual([
      `programme-of:${E1}`,
      `programme-of:${E2}`,
    ]);
    expect(logged).toContainEqual([
      { enrollmentId: E1, reason: 'teacher_suspended' },
      'A programme’s saved card was deleted at its teacher’s suspension',
    ]);
  });

  it('a ban deletes it through the close hook alone, once', async () => {
    const { deleted, card } = recorded();
    const { journal, subscriber } = world(confirmed, {}, [E1], card);
    await subscriber(tx, TEACHER, 'banned', { adminId: ADMIN });

    expect(deleted).toEqual([]);
    expect(journal).toContain(`close-programmes:${E1},${E2}:teacher_suspended`);
  });

  it('a student’s suspension deletes none: the card is the teacher’s case (DEC-94)', async () => {
    const { deleted, card } = recorded();
    const { journal, subscriber } = world(confirmed, {}, [E1], card);
    await subscriber(tx, STUDENT, 'suspended', { adminId: ADMIN });

    expect(deleted).toEqual([]);
    expect(journal.some((entry) => entry.startsWith('programme-of:'))).toBe(false);
  });
});
