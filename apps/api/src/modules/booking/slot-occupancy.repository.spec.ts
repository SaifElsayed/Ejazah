// T070 A1 of specs/004-sessions/tasks.md (the owner's approval of 2026-11-13; the first follow-up
// under T070, the speed): `slotUses` reads the cases of every closed enrollment on the free slots in
// one statement through moderation's batched entry, never one per enrollment, and holds exactly the
// slots it held before. Over a recorded client; the same over the real tables is
// `tests/db-integrity/slot-hold.spec.ts`'s.
import { addDays } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { slotUses } from './slot-occupancy.repository.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-11-13T09:00:00.000Z');
const daysAgo = (days: number) => new Date(addDays(NOW, -days));
const windowDays = async (setting: string) => (setting === 'ban_restore_window_days' ? 3 : 14);

interface Closed {
  readonly id: string;
  readonly slotId: string;
  readonly status: 'cancelled' | 'terminated_no_show';
  readonly cancellationReason: string | null;
}

interface Case {
  readonly id: string;
  readonly reason: string;
  readonly status: 'open' | 'resolved' | 'dismissed';
  readonly createdAt: Date;
}

/**
 * A client with no active hold and no live enrollment, whose held closings are `closed` and whose
 * `disputes` hold `cases` by enrollment; it records the enrollments each case read asked.
 */
function world(closed: readonly Closed[], cases: Readonly<Record<string, readonly Case[]>>) {
  const caseReads: string[][] = [];
  let enrollmentReads = 0;
  const tx = {
    slotHold: { findMany: async () => [] },
    enrollment: { findMany: async () => (enrollmentReads++ === 0 ? [] : closed) },
    dispute: {
      findMany: async ({ where }: { where: { enrollmentId: string | { in: string[] } } }) => {
        const asked =
          typeof where.enrollmentId === 'string' ? [where.enrollmentId] : where.enrollmentId.in;
        caseReads.push([...asked]);
        return asked
          .flatMap((enrollmentId) =>
            (cases[enrollmentId] ?? []).map((one) => ({ enrollmentId, ...one })),
          )
          .sort((one, other) => (one.id < other.id ? 1 : -1));
      },
    },
    $queryRaw: async () => [{ at: NOW }],
  } as unknown as Transaction;
  return { tx, caseReads };
}

/** The slots `uses` counts as taken, in the order asked. */
function taken(
  uses: ReadonlyMap<string, { taken: boolean }>,
  slotIds: readonly string[],
): string[] {
  return slotIds.filter((slotId) => uses.get(slotId)?.taken === true);
}

describe("slotUses reading the held closings' cases (T070 A1)", () => {
  it('reads the cases of every closed enrollment on the free slots in one statement', async () => {
    const slots = [id(1), id(2), id(3)];
    const closed: Closed[] = slots.map((slotId, n) => ({
      id: id(11 + n),
      slotId,
      status: 'terminated_no_show',
      cancellationReason: null,
    }));
    const cases = Object.fromEntries(
      closed.map(({ id: enrollmentId }, n) => [
        enrollmentId,
        [
          {
            id: id(21 + n),
            reason: 'absence_termination',
            status: 'open' as const,
            createdAt: daysAgo(30),
          },
        ],
      ]),
    );
    const { tx, caseReads } = world(closed, cases);
    const uses = await slotUses(tx, slots, windowDays);
    expect(caseReads).toEqual([[id(11), id(12), id(13)]]);
    expect(taken(uses, slots)).toEqual([]);
  });

  it('holds exactly the slots whose closing is restorable and whose hold still runs', async () => {
    const slots = [id(1), id(2), id(3), id(4), id(5)];
    const closed: Closed[] = [
      // A ban's closing inside its 3 days: held.
      { id: id(11), slotId: id(1), status: 'cancelled', cancellationReason: 'admin' },
      // A complaint's closing after its 14 days: free.
      { id: id(12), slotId: id(2), status: 'terminated_no_show', cancellationReason: null },
      // A fault's closing whose case is closed: free.
      { id: id(13), slotId: id(3), status: 'cancelled', cancellationReason: 'admin' },
      // A slot with a closing over and a teacher's end inside its 3 days: held.
      { id: id(14), slotId: id(4), status: 'terminated_no_show', cancellationReason: null },
      { id: id(15), slotId: id(4), status: 'cancelled', cancellationReason: 'teacher_suspended' },
      // A fault's closing whose newest case is not an end's: its latest end case read, held.
      { id: id(16), slotId: id(5), status: 'cancelled', cancellationReason: 'admin' },
    ];
    const { tx, caseReads } = world(closed, {
      [id(11)]: [{ id: id(31), reason: 'student_banned', status: 'open', createdAt: daysAgo(1) }],
      [id(12)]: [
        { id: id(32), reason: 'absence_termination', status: 'open', createdAt: daysAgo(30) },
      ],
      [id(13)]: [
        {
          id: id(33),
          reason: 'student_fault_confirmed',
          status: 'resolved',
          createdAt: daysAgo(1),
        },
      ],
      [id(14)]: [
        { id: id(34), reason: 'absence_termination', status: 'open', createdAt: daysAgo(30) },
      ],
      [id(15)]: [{ id: id(35), reason: 'teacher_ended', status: 'open', createdAt: daysAgo(1) }],
      [id(16)]: [
        { id: id(37), reason: 'student_suspended', status: 'open', createdAt: daysAgo(1) },
        { id: id(36), reason: 'student_fault_confirmed', status: 'open', createdAt: daysAgo(2) },
      ],
    });
    const uses = await slotUses(tx, slots, windowDays);
    expect(taken(uses, slots)).toEqual([id(1), id(4), id(5)]);
    expect(caseReads.flat().sort()).toEqual(closed.map(({ id: enrollmentId }) => enrollmentId));
  });
});
