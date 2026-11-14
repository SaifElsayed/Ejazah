// T074 of specs/004-sessions/tasks.md — the hold's end recorded (FR-505; DEC-69; the note under T074,
// Q-R1 (a), N1, N2, Q-R4 (a), Q-R5 (a); contracts/kernel.md, the sweep's row) over a store faked in
// memory: what the sweep reads, locks and writes. The real tables, the race with a lift and the
// double run over them are `tests/db-integrity/paused-hold-end.spec.ts`'s. Written before the
// sweep, and run red first against a stub.
//
//   - a held closing the one closing rule admits, its case open, its slot not released, the read's
//     instant at or after `restorableUntil` (the window of its kind), and no `slot_hold_ended` row
//     after its latest closing: one row `slot_hold_ended`, one info line `{ enrollmentId, kind }`;
//   - each such candidate on its own transaction: its enrollment locked (`enrollments`, nothing
//     else), read again under the lock with its cases and its rows, then the row;
//   - nothing written for a hold still running, a case closed, a slot released, a hold already
//     recorded, a closing the rule never admits, or one restored between the page and the lock;
//   - each item's failure caught, logged by its id at error and reported, the run going on;
//   - read in pages by id; run twice, it leaves what one run leaves (`runOnceAndTwice`).
import { describe, expect, it } from 'vitest';

import { runOnceAndTwice } from '../../jobs/double-run.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import type { EnrollmentCase } from '../moderation/index.js';
import type { EnrollmentOutcome } from './enrollment-events.repository.js';
import {
  createSlotHoldEndSweep,
  type HeldClosingRow,
  type SlotHoldEndStore,
} from './slot-hold-end.sweep.js';

const NOW = new Date('2026-11-20T12:00:00Z');
/** 20 days before NOW: a 14 days' window over. */
const LONG_AGO = new Date('2026-10-31T12:00:00Z');
/** 5 days before NOW: a 14 days' window still running. */
const LATELY = new Date('2026-11-15T12:00:00Z');

const E1 = '0199d0a0-0000-7000-8000-0000000000e1';
const E2 = '0199d0a0-0000-7000-8000-0000000000e2';
const E3 = '0199d0a0-0000-7000-8000-0000000000e3';
const E4 = '0199d0a0-0000-7000-8000-0000000000e4';
const E5 = '0199d0a0-0000-7000-8000-0000000000e5';

const closingRow = (id: string, values: Partial<HeldClosingRow> = {}): HeldClosingRow => ({
  id,
  status: 'cancelled',
  cancellationReason: 'admin',
  slotReleasedAt: null,
  ...values,
});

const caseOf = (
  reason: string,
  status: EnrollmentCase['status'] = 'open',
  createdAt = LONG_AGO,
): EnrollmentCase => ({ caseId: `case-${reason}`, reason, status, createdAt });

interface World {
  readonly rows: Map<string, HeldClosingRow>;
  readonly cases: Map<string, readonly EnrollmentCase[]>;
  /** Enrollments whose latest closing already has its `slot_hold_ended` row. */
  readonly recordedBefore: Set<string>;
  readonly written: EnrollmentOutcome[];
  readonly calls: string[];
  readonly lines: { level: string; fields: object; message: string }[];
  readonly reported: Error[];
  /** A move made between the page's read and the item's lock, as a lift would make it. */
  meanwhile?: (world: World) => void;
  /** An enrollment whose lock throws. */
  failing?: string;
}

function worldOf(
  rows: readonly HeldClosingRow[],
  cases: Record<string, readonly EnrollmentCase[]>,
  recordedBefore: readonly string[] = [],
): World {
  return {
    rows: new Map(rows.map((one) => [one.id, one])),
    cases: new Map(Object.entries(cases)),
    recordedBefore: new Set(recordedBefore),
    written: [],
    calls: [],
    lines: [],
    reported: [],
  };
}

function storeOf(world: World): SlotHoldEndStore {
  const recorded = () =>
    new Set([...world.recordedBefore, ...world.written.map(({ enrollmentId }) => enrollmentId)]);
  return {
    candidates: async (tx, after, limit) => {
      world.calls.push(`${tag(tx)} candidates ${after ?? '-'} ${String(limit)}`);
      return [...world.rows.values()]
        .filter(({ id }) => after === undefined || id > after)
        .sort((one, other) => (one.id < other.id ? -1 : 1))
        .slice(0, limit);
    },
    lockEnrollment: async (tx, enrollmentId) => {
      world.calls.push(`${tag(tx)} lock ${enrollmentId}`);
      if (world.failing === enrollmentId) throw new Error('lock failed');
      world.meanwhile?.(world);
    },
    enrollmentOf: async (tx, enrollmentId) => {
      world.calls.push(`${tag(tx)} read ${enrollmentId}`);
      return world.rows.get(enrollmentId) ?? null;
    },
    casesAmong: async (tx, enrollmentIds) => {
      world.calls.push(`${tag(tx)} cases ${enrollmentIds.join(',')}`);
      return new Map(enrollmentIds.map((id) => [id, world.cases.get(id) ?? []]));
    },
    holdEndsRecordedAmong: async (tx, enrollmentIds) => {
      world.calls.push(`${tag(tx)} recorded ${enrollmentIds.join(',')}`);
      const done = recorded();
      return new Set(enrollmentIds.filter((id) => done.has(id)));
    },
    recordEvents: async (tx, outcomes) => {
      world.calls.push(
        `${tag(tx)} write ${outcomes.map(({ enrollmentId }) => enrollmentId).join(',')}`,
      );
      world.written.push(...outcomes);
    },
  };
}

const tags = new WeakMap<object, string>();
const tag = (tx: Transaction): string => tags.get(tx) ?? '?';

function transactionsOf(): Transactions {
  let count = 0;
  return {
    run: async (work) => {
      const tx = {} as Transaction;
      count += 1;
      tags.set(tx, `tx${String(count)}`);
      return work(tx);
    },
  };
}

function sweepOf(world: World, options: { pageSize?: number; windowDays?: number } = {}) {
  const settingsAsked: string[] = [];
  const sweep = createSlotHoldEndSweep({
    transactions: transactionsOf(),
    settings: {
      read: async (key, schema) => {
        settingsAsked.push(key);
        return schema.parse(options.windowDays ?? 14);
      },
    },
    log: {
      info: (fields: object, message: string) =>
        world.lines.push({ level: 'info', fields, message }),
      error: (fields: object, message: string) =>
        world.lines.push({ level: 'error', fields, message }),
    } as never,
    pageSize: options.pageSize ?? 50,
    report: (error) => world.reported.push(error),
    clock: async () => NOW,
    store: storeOf(world),
  });
  return { sweep, settingsAsked };
}

describe('the hold’s end recorded (T074, FR-505)', () => {
  it('records one slot_hold_ended row for a ban’s held closing whose hold ended, with one info line { enrollmentId, kind }', async () => {
    const world = worldOf([closingRow(E1)], { [E1]: [caseOf('student_banned')] });
    const { sweep } = sweepOf(world);
    const run = await sweep.run();
    expect(run).toEqual({ recorded: [E1], failed: [] });
    expect(world.written).toEqual([{ kind: 'slot_hold_ended', enrollmentId: E1, occurredAt: NOW }]);
    expect(world.lines).toEqual([
      {
        level: 'info',
        fields: { enrollmentId: E1, kind: 'student_banned' },
        message: expect.any(String),
      },
    ]);
  });

  it('records each kind the one closing rule admits: a complaint’s, a fault’s, a ban’s and a teacher’s ban or revocation', async () => {
    const world = worldOf(
      [
        closingRow(E1, { status: 'terminated_no_show', cancellationReason: null }),
        closingRow(E2),
        closingRow(E3),
        closingRow(E4, { cancellationReason: 'teacher_suspended' }),
      ],
      {
        [E1]: [caseOf('absence_termination')],
        [E2]: [caseOf('student_fault_confirmed')],
        [E3]: [caseOf('student_banned')],
        [E4]: [caseOf('teacher_ended')],
      },
    );
    const { sweep } = sweepOf(world);
    expect((await sweep.run()).recorded).toEqual([E1, E2, E3, E4]);
    expect(world.lines.map(({ fields }) => fields)).toEqual([
      { enrollmentId: E1, kind: 'absence_termination' },
      { enrollmentId: E2, kind: 'student_fault_confirmed' },
      { enrollmentId: E3, kind: 'student_banned' },
      { enrollmentId: E4, kind: 'teacher_ended' },
    ]);
  });

  it('locks each due enrollment on its own transaction, reads it again under the lock, then writes; no other lock', async () => {
    const world = worldOf([closingRow(E1), closingRow(E2)], {
      [E1]: [caseOf('student_banned')],
      [E2]: [caseOf('student_banned')],
    });
    const { sweep } = sweepOf(world);
    await sweep.run();
    expect(world.calls).toEqual([
      'tx1 candidates - 50',
      `tx1 cases ${E1},${E2}`,
      `tx1 recorded ${E1},${E2}`,
      `tx2 lock ${E1}`,
      `tx2 read ${E1}`,
      `tx2 cases ${E1}`,
      `tx2 recorded ${E1}`,
      `tx2 write ${E1}`,
      `tx3 lock ${E2}`,
      `tx3 read ${E2}`,
      `tx3 cases ${E2}`,
      `tx3 recorded ${E2}`,
      `tx3 write ${E2}`,
    ]);
  });

  it('writes nothing for a hold still running, a case closed, a slot released, a hold already recorded, or a closing the rule never admits; and locks none of them', async () => {
    const world = worldOf(
      [
        closingRow(E1),
        closingRow(E2),
        closingRow(E3, { slotReleasedAt: LATELY }),
        closingRow(E4),
        closingRow(E5),
      ],
      {
        [E1]: [caseOf('student_banned', 'open', LATELY)],
        [E2]: [caseOf('student_banned', 'resolved')],
        [E3]: [caseOf('student_banned')],
        [E4]: [caseOf('student_banned')],
        // A teacher's end case on a closing cancelled `admin`: no closing the rule admits.
        [E5]: [caseOf('teacher_ended')],
      },
      [E4],
    );
    const { sweep } = sweepOf(world);
    expect(await sweep.run()).toEqual({ recorded: [], failed: [] });
    expect(world.written).toEqual([]);
    expect(world.lines).toEqual([]);
    expect(world.calls.filter((call) => call.includes(' lock '))).toEqual([]);
  });

  it('judges each window by the closing’s kind: a ban’s by ban_restore_window_days, a complaint’s by enrollment_restore_window_days', async () => {
    const world = worldOf(
      [closingRow(E1, { status: 'terminated_no_show', cancellationReason: null }), closingRow(E2)],
      { [E1]: [caseOf('absence_termination')], [E2]: [caseOf('student_banned')] },
    );
    const { sweep, settingsAsked } = sweepOf(world, { windowDays: 30 });
    expect((await sweep.run()).recorded).toEqual([]);
    expect([...new Set(settingsAsked)].sort()).toEqual([
      'ban_restore_window_days',
      'enrollment_restore_window_days',
    ]);
  });

  it('writes nothing for an enrollment restored between the page and its lock (a lift first): read again under the lock', async () => {
    const world = worldOf([closingRow(E1)], { [E1]: [caseOf('student_banned')] });
    world.meanwhile = (it) => {
      it.rows.set(E1, closingRow(E1, { status: 'confirmed', cancellationReason: null }));
      it.cases.set(E1, [caseOf('student_banned', 'dismissed')]);
    };
    const { sweep } = sweepOf(world);
    expect(await sweep.run()).toEqual({ recorded: [], failed: [] });
    expect(world.written).toEqual([]);
    expect(world.calls).toContain(`tx2 lock ${E1}`);
  });

  it('writes nothing for a slot released between the page and its lock', async () => {
    const world = worldOf([closingRow(E1)], { [E1]: [caseOf('student_banned')] });
    world.meanwhile = (it) => {
      it.rows.set(E1, closingRow(E1, { slotReleasedAt: NOW }));
    };
    const { sweep } = sweepOf(world);
    expect((await sweep.run()).recorded).toEqual([]);
    expect(world.written).toEqual([]);
  });

  it('catches each item’s failure on its own, logs its id at error and reports it, and records the next', async () => {
    const world = worldOf([closingRow(E1), closingRow(E2)], {
      [E1]: [caseOf('student_banned')],
      [E2]: [caseOf('student_banned')],
    });
    world.failing = E1;
    const { sweep } = sweepOf(world);
    expect(await sweep.run()).toEqual({ recorded: [E2], failed: [E1] });
    expect(world.lines[0]).toEqual({
      level: 'error',
      fields: { enrollmentId: E1 },
      message: expect.any(String),
    });
    expect(world.reported.map(({ message }) => message)).toEqual(['lock failed']);
    expect(world.written.map(({ enrollmentId }) => enrollmentId)).toEqual([E2]);
  });

  it('reads in pages by id, after the last id of a full page', async () => {
    const world = worldOf([closingRow(E1), closingRow(E2), closingRow(E3)], {
      [E1]: [caseOf('student_banned')],
      [E2]: [caseOf('student_banned')],
      [E3]: [caseOf('student_banned')],
    });
    const { sweep } = sweepOf(world, { pageSize: 2 });
    expect((await sweep.run()).recorded).toEqual([E1, E2, E3]);
    expect(world.calls.filter((call) => call.includes('candidates'))).toEqual([
      'tx1 candidates - 2',
      `tx4 candidates ${E2} 2`,
    ]);
  });

  it('run twice leaves what one run leaves: one row per held closing whose hold ended', async () => {
    const make = () =>
      worldOf([closingRow(E1), closingRow(E2)], {
        [E1]: [caseOf('student_banned')],
        [E2]: [caseOf('student_banned', 'open', LATELY)],
      });
    const { once, twice } = await runOnceAndTwice({
      world: () => {
        const world = make();
        return { world, sweep: sweepOf(world).sweep };
      },
      run: async ({ sweep }) => {
        await sweep.run();
      },
      observe: ({ world }) => world.written,
    });
    expect(once).toEqual([{ kind: 'slot_hold_ended', enrollmentId: E1, occurredAt: NOW }]);
    expect(twice).toEqual(once);
  });
});
