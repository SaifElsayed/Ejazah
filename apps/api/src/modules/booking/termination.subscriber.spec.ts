// T041 — an account's end reaches its holds and pending enrollments (R-219, SRS FR-PAYG-6 and FR-BOOK-9
// as amended 2026-11-01, FR-VERIFY-8, FR-AUTH-14), over a store of fakes standing for catalog's
// teacher slots and booking's holds, and a recorded release standing for `releaseHolds`. What the
// fakes let a spec see plainly: which holds each termination finds, the reason each releases them
// with, and the order of the locks after the termination's account lock (T005: the teacher's slots'
// key, then the holds, whose release locks the holds, the enrollments and the orders). What the
// release does with the holds (the cancellation, its `enrollment_events` row, a paid order kept
// awaiting payment) is `holds.service.spec.ts`'s; the composition over the real tables, with
// identity's actions and the paid event after them, is `tests/db-integrity/termination.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { TerminationCause } from '../identity/index.js';
import type { OrderStandings, ReleaseDependencies, ReleaseReason } from './holds.service.js';
import { type TerminationStore, terminationSubscriber } from './termination.subscriber.js';

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
function world() {
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
    release: async (_tx, holdIds, reason, dependencies: ReleaseDependencies) => {
      journal.push(`release:${holdIds.join(',')}:${reason}`);
      released.push({ holdIds, reason, at: dependencies.at, orders: dependencies.orders });
      return { released: [...holdIds], cancelled: [], keptPending: [] };
    },
  };
  const subscriber = terminationSubscriber({ orders, now: () => NOW, store });
  return { journal, released, subscriber, holdsOnSlots, holdsOfStudents };
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
