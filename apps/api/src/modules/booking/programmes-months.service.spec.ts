// 006:T015 of specs/006-programme (FR-714, FR-717, FR-721; R-507, R-508, R-509; SRS DEC-110,
// DEC-113; Q-1 (a), Q-3 (a)) — the sweep's month steps (`programmes.service.ts`,
// `createProgrammeMonths`) over an in-memory store: the locks before the read again, in kernel.md's
// order; the suspension; the due point derived and written when it moved; the due step's and the
// retries' orders recorded on the step's transaction with their attempt, the gateway's call handed
// back for after the commit and never made inside it; the item; the pause with its event and its
// signal; one line per action, ids and a reason only; and a second run that does nothing.
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { bindToTransaction } from '../../platform/live/live-publisher.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { ProgrammeMonthRow } from './programmes.repository.js';
import type { AutomaticOrderFacts, MonthOrders } from './programmes.rules.js';
import {
  createProgrammeMonths,
  type ProgrammeChargeRequest,
  type ProgrammeMonthStore,
} from './programmes.service.js';

const ENROLLMENT = '019a4a00-0000-7000-8000-0000000000e1';
const STUDENT = '019a4a00-0000-7000-8000-0000000000e2';
const TEACHER = '019a4a00-0000-7000-8000-0000000000e3';
const SLOT = '019a4a00-0000-7000-8000-0000000000e4';
const PAYMENT = '019a4a00-0000-7000-8000-0000000000e5';
/** Month 1's last session: Thursday 2026-11-26 18:00–18:30 Cairo (16:30Z). */
const MONTH_ONE_END = new Date('2026-11-26T16:30:00Z');
/** The next Thursday's 18:00 Cairo (16:00Z), the weekly time's next occurrence. */
const NEXT_THURSDAY = new Date('2026-12-03T16:00:00Z');
const at = (iso: string) => new Date(iso);

const VALUES: Record<string, unknown> = {
  programme_charge_retry_days: [1, 3, 5, 7],
  slot_hold_ttl_minutes: 10,
  programme_charge_inquiry_tries: 6,
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(VALUES[key]) };

interface World {
  now: Date;
  row: ProgrammeMonthRow;
  cases: string[];
  orders: MonthOrders;
  item: { open: boolean; lastAt: Date | null };
  calls: string[];
  lines: Readonly<Record<string, unknown>>[];
  recorded: ProgrammeChargeRequest[];
  charged: number;
  signals: unknown[];
}

function worldOf(change: Partial<World> = {}): World {
  return {
    now: at('2026-11-26T16:31:00Z'),
    row: {
      enrollmentId: ENROLLMENT,
      studentUserId: STUDENT,
      teacherUserId: TEACHER,
      status: 'confirmed',
      state: 'active',
      plan: 'monthly',
      monthsPaid: 1,
      monthCount: 3,
      nextDueAt: MONTH_ONE_END,
      firstFailureAt: null,
      retriesDone: 0,
      slotId: SLOT,
      timezone: 'Africa/Cairo',
      offerSessionCount: 10,
      offerTotal_piasters: piasters(1_000_000),
    },
    cases: [],
    orders: { cardSaved: true, payable: false, processing: false, automatic: null },
    item: { open: false, lastAt: null },
    calls: [],
    lines: [],
    recorded: [],
    charged: 0,
    signals: [],
    ...change,
  };
}

const automatic = (change: Partial<AutomaticOrderFacts> = {}): AutomaticOrderFacts => ({
  paymentId: PAYMENT,
  status: 'created',
  expiresAt: at('2026-11-26T16:41:00Z'),
  declineKind: null,
  attempt: 0,
  failedAt: null,
  ...change,
});

/** The steps over `world`: each write moves the world as the database would. */
function monthsOver(world: World) {
  const tx = {} as Transaction;
  const store: ProgrammeMonthStore = {
    programmeMonthOf: async () => {
      world.calls.push('read');
      return { ...world.row };
    },
    keyShareTeacher: async (_tx, teacherUserId) => {
      world.calls.push(`key share users ${teacherUserId === TEACHER ? 'teacher' : '?'}`);
    },
    lockProgramme: async () => {
      world.calls.push('lock programmes');
    },
    lockEnrollment: async () => {
      world.calls.push('lock enrollments');
    },
    openCaseOf: async (_tx, _id, reason) => (world.cases.includes(reason) ? 'case' : null),
    sessionsOf: async () => [
      { endsAt: at('2026-10-29T16:00:00Z') },
      { programmeMonth: 1, endsAt: MONTH_ONE_END },
    ],
    readSlot: async () => ({
      id: SLOT,
      dayOfWeek: 4,
      startTimeLocal: '18:00:00',
      durationMinutes: 30,
      timezone: 'Africa/Cairo',
      isActive: true,
      createdAt: at('2026-10-01T00:00:00Z'),
    }),
    openItemExists: async () => world.item.open,
    lastItemAt: async () => world.item.lastAt,
    insertItem: async () => {
      world.calls.push('insert charge_unknown');
      world.item = { open: true, lastAt: world.now };
      return 'item';
    },
    withdrawItem: async () => {
      world.calls.push('withdraw charge_unknown');
      world.item = { ...world.item, open: false };
      return true;
    },
    writeNextDue: async (_tx, _id, nextDueAt) => {
      world.calls.push(`next_due_at ${nextDueAt?.toISOString() ?? 'null'}`);
      world.row = { ...world.row, nextDueAt };
    },
    writeFirstFailure: async (_tx, _id, failedAt) => {
      world.calls.push(`first_failure_at ${failedAt.toISOString()}`);
      world.row = { ...world.row, firstFailureAt: failedAt };
      return true;
    },
    writeAttempt: async (_tx, _id, attempt) => {
      world.calls.push(`attempt ${String(attempt)}`);
      world.row =
        attempt === 0
          ? { ...world.row, firstFailureAt: null, retriesDone: 0 }
          : { ...world.row, retriesDone: attempt };
      return true;
    },
    writePaused: async (_tx, _id, pausedAt) => {
      world.calls.push(`paused ${pausedAt.toISOString()}`);
      if (world.row.state !== 'active') return false;
      world.row = { ...world.row, state: 'paused' };
      return true;
    },
    recordPaused: async () => {
      world.calls.push('event programme_paused');
    },
  };
  return createProgrammeMonths({
    transactions: {
      run: async (work) => {
        world.calls.push('begin');
        const unbind = bindToTransaction(tx, {
          afterCommit: (to, event) => world.signals.push({ to, event }),
        });
        try {
          return await work(tx);
        } finally {
          unbind();
        }
      },
    },
    settings,
    orders: async (_tx, enrollmentId, month) => {
      world.calls.push(`orders ${enrollmentId === ENROLLMENT ? 'this' : '?'} month ${String(month)}`);
      return world.orders;
    },
    charges: {
      record: async (_tx, request) => {
        world.calls.push(`record attempt ${String(request.attempt)}`);
        world.recorded.push(request);
        world.orders = {
          ...world.orders,
          automatic: automatic({ attempt: request.attempt, expiresAt: world.now }),
        };
        return {
          outcome: 'recorded',
          paymentId: PAYMENT,
          charge: async () => {
            world.charged += 1;
            return 'sent';
          },
        };
      },
    },
    log: { info: (fields) => world.lines.push(fields) },
    clock: async () => world.now,
    store,
  });
}

describe('a month step’s locks and reads (006:T015; kernel.md, 006:T015’s row)', () => {
  it('key-shares the teacher, locks the programme then the enrollment, and reads again under them', async () => {
    const world = worldOf();
    await monthsOver(world).step('due', ENROLLMENT, { askedNoAnswer: false });
    expect(world.calls.slice(0, 6)).toEqual([
      'begin',
      'read',
      'key share users teacher',
      'lock programmes',
      'lock enrollments',
      'read',
    ]);
    expect(world.calls).toContain('orders this month 2');
  });

  it.each(['teacher_suspended', 'student_suspended'])(
    'red first: an open %s case: nothing recorded, nothing written',
    async (reason) => {
      const world = worldOf({ cases: [reason] });
      expect(await monthsOver(world).step('due', ENROLLMENT, { askedNoAnswer: false })).toEqual({
        action: 'none',
      });
      expect(world.recorded).toEqual([]);
      expect(world.calls.filter((call) => !/^(begin|read|key|lock)/.test(call))).toEqual([]);
    },
  );

  it('leaves a programme that is not paid or not confirmed', async () => {
    for (const row of [
      { ...worldOf().row, state: 'offered' as const },
      { ...worldOf().row, status: 'cancelled' as const },
    ]) {
      const world = worldOf({ row });
      expect(await monthsOver(world).step('due', ENROLLMENT, { askedNoAnswer: false })).toEqual({
        action: 'none',
      });
      expect(world.recorded).toEqual([]);
    }
  });
});

describe('the due point (Q-3 (a))', () => {
  it('red first: writes the derived due point when it moved, on any step', async () => {
    const world = worldOf({ row: { ...worldOf().row, nextDueAt: null } });
    await monthsOver(world).step('pause', ENROLLMENT, { askedNoAnswer: false });
    expect(world.calls).toContain(`next_due_at ${MONTH_ONE_END.toISOString()}`);
    expect(world.row.nextDueAt).toEqual(MONTH_ONE_END);
  });

  it('writes nothing when it did not move', async () => {
    const world = worldOf({ now: at('2026-11-26T16:00:00Z') });
    await monthsOver(world).step('due', ENROLLMENT, { askedNoAnswer: false });
    expect(world.calls.some((call) => call.startsWith('next_due_at'))).toBe(false);
  });
});

describe('the due step and the retries (R-508 steps 2, 3; R-509)', () => {
  it('records month 2’s attempt 0 on the step’s transaction; the gateway’s call is handed back, not made', async () => {
    const world = worldOf();
    const done = await monthsOver(world).step('due', ENROLLMENT, { askedNoAnswer: false });
    expect(done.action).toBe('due');
    expect(world.recorded).toEqual([
      {
        enrollmentId: ENROLLMENT,
        teacherUserId: TEACHER,
        instalmentMonth: 2,
        attempt: 0,
        offerTotal_piasters: piasters(1_000_000),
        offerSessionCount: 10,
      },
    ]);
    expect(world.calls.slice(-2)).toEqual(['record attempt 0', 'attempt 0']);
    expect(world.charged).toBe(0);
    await done.charge?.();
    expect(world.charged).toBe(1);
    expect(world.lines).toEqual([{ enrollmentId: ENROLLMENT, instalmentMonth: 2, reason: 'due' }]);
  });

  it('a second run records nothing more (the month’s order is there)', async () => {
    const world = worldOf();
    const months = monthsOver(world);
    await months.step('due', ENROLLMENT, { askedNoAnswer: false });
    expect(await months.step('due', ENROLLMENT, { askedNoAnswer: false })).toEqual({
      action: 'none',
    });
    expect(world.recorded).toHaveLength(1);
  });

  it('marks the first failure once, then retries a day later as attempt 1', async () => {
    const world = worldOf({
      now: at('2026-11-26T16:42:00Z'),
      orders: {
        cardSaved: true,
        payable: false,
        processing: false,
        automatic: automatic({ status: 'expired' }),
      },
    });
    const months = monthsOver(world);
    expect((await months.step('retry', ENROLLMENT, { askedNoAnswer: false })).action).toBe(
      'failed',
    );
    expect((await months.step('retry', ENROLLMENT, { askedNoAnswer: false })).action).toBe('none');
    world.now = at('2026-11-27T16:42:00Z');
    const done = await months.step('retry', ENROLLMENT, { askedNoAnswer: false });
    expect(done.action).toBe('retry');
    expect(world.recorded.map(({ attempt }) => attempt)).toEqual([1]);
    expect(world.row.retriesDone).toBe(1);
    expect(world.lines.at(-1)).toEqual({
      enrollmentId: ENROLLMENT,
      instalmentMonth: 2,
      reason: 'retry',
      attempt: 1,
    });
  });
});

describe('the charge_unknown item (Q-1 (a))', () => {
  it('opens on the sixth unanswered ask, once', async () => {
    const world = worldOf({
      now: at('2026-11-26T17:31:00Z'),
      orders: { cardSaved: true, payable: false, processing: false, automatic: automatic() },
    });
    const months = monthsOver(world);
    expect((await months.step('item', ENROLLMENT, { askedNoAnswer: true })).action).toBe(
      'raise_item',
    );
    world.now = at('2026-11-26T17:41:00Z');
    expect((await months.step('item', ENROLLMENT, { askedNoAnswer: true })).action).toBe('none');
    expect(world.calls.filter((call) => call === 'insert charge_unknown')).toHaveLength(1);
  });

  it('an answer withdraws it', async () => {
    const world = worldOf({
      item: { open: true, lastAt: at('2026-11-26T17:31:00Z') },
      orders: {
        cardSaved: true,
        payable: false,
        processing: false,
        automatic: automatic({ status: 'paid' }),
      },
    });
    expect((await monthsOver(world).step('item', ENROLLMENT, { askedNoAnswer: false })).action).toBe(
      'withdraw_item',
    );
    expect(world.item.open).toBe(false);
  });
});

describe('the pause (R-508 step 4; FU-A1 (a); N-15)', () => {
  it('pauses since the next occurrence’s start, with its event and a signal to both parties', async () => {
    const world = worldOf({
      now: NEXT_THURSDAY,
      orders: {
        cardSaved: false,
        payable: false,
        processing: false,
        automatic: null,
      },
    });
    const months = monthsOver(world);
    expect((await months.step('pause', ENROLLMENT, { askedNoAnswer: false })).action).toBe('pause');
    expect(world.calls.slice(-2)).toEqual([
      `paused ${NEXT_THURSDAY.toISOString()}`,
      'event programme_paused',
    ]);
    expect(world.signals).toEqual([
      { to: [STUDENT, TEACHER], event: { type: 'enrollment', enrollmentId: ENROLLMENT } },
    ]);
    expect((await months.step('pause', ENROLLMENT, { askedNoAnswer: false })).action).toBe('none');
    expect(world.signals).toHaveLength(1);
  });
});

describe('the survey (no lock)', () => {
  it('names the steps that may act and the order to ask about on this minute', async () => {
    const world = worldOf({
      now: at('2026-11-26T16:41:00Z'),
      orders: { cardSaved: true, payable: false, processing: false, automatic: automatic() },
    });
    expect(await monthsOver(world).survey(ENROLLMENT)).toEqual({ ask: PAYMENT, steps: [] });
    expect(world.calls.some((call) => call.startsWith('lock'))).toBe(false);
  });

  it('names the due step at the due point, and when the due point moved', async () => {
    expect(await monthsOver(worldOf()).survey(ENROLLMENT)).toEqual({ ask: null, steps: ['due'] });
    const unset = worldOf({
      now: at('2026-11-26T16:00:00Z'),
      row: { ...worldOf().row, nextDueAt: null },
    });
    expect(await monthsOver(unset).survey(ENROLLMENT)).toEqual({ ask: null, steps: ['due'] });
  });

  it('nothing for a programme not paid', async () => {
    const world = worldOf({ row: { ...worldOf().row, state: 'awaiting_offer' } });
    expect(await monthsOver(world).survey(ENROLLMENT)).toBeNull();
  });
});
