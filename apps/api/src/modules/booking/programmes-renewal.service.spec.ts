// 006:T016 of specs/006-programme (FR-713a, FR-715, FR-716, FR-722, FR-724; R-508, R-509, R-510;
// SRS DEC-95, DEC-110, DEC-113; B-P3's conflict check) — booking's side of the renewal, over stood-in
// stores: `programme.autoRenewOff` (the student's, keyed, under the programme's then the enrollment's
// lock, the card deleted through payments' entry), its refusals `closed` and `party_suspended`, each
// with one line and nothing deleted; another student's programme NOT_FOUND.
import type { ProgrammeActionInput } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { bindToTransaction } from '../../platform/live/live-publisher.js';
import type { HeldRow } from './holds.repository.js';
import type { ProgrammeFacts, ProgrammeMonthRow, ProgrammeState } from './programmes.repository.js';
import type { AutomaticOrderFacts, MonthOrders, MonthSession } from './programmes.rules.js';
import {
  type AutoRenewOffStore,
  checkedProgrammeRenew,
  type ProgrammePayOrders,
  type ProgrammeRenewStore,
  type ProgrammeServiceDependencies,
  type ProgrammePaidStore,
  type ProgrammeServices,
  recordProgrammePaid,
  turnAutoRenewOff,
} from './programmes.service.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000016d1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000016d2';
const OTHER_STUDENT = '0199d0a0-0000-7000-8000-0000000016d3';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000016e1';
const STOP = '0199d0a0-0000-7000-8000-0000000016f1';
const KEY = '0199d0a0-0000-7000-8000-0000000016aa';

const tx = {} as Transaction;

/** The refusal's cause; a failure when the call was not refused `CONFLICT` with one. */
async function causeOf(call: Promise<unknown>): Promise<string> {
  const error: unknown = await call.then(
    () => new Error('answered instead of refused'),
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DomainError);
  const domain = error as DomainError;
  expect(domain.code).toBe('CONFLICT');
  return String(domain.details?.[0]?.code);
}

function facts(change: Partial<ProgrammeFacts> = {}): ProgrammeFacts {
  return {
    enrollmentId: ENROLLMENT,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    status: 'confirmed',
    state: 'active',
    offerDueAt: null,
    payByAt: null,
    ...change,
  };
}

interface OffWorld {
  programme: ProgrammeFacts | null;
  suspension: string | null;
}

function offWorld(change: Partial<OffWorld> = {}) {
  const world: OffWorld = { programme: facts(), suspension: null, ...change };
  const calls: string[] = [];
  const keyed: unknown[] = [];
  const signals: [readonly string[], unknown][] = [];
  const lines: [Readonly<Record<string, unknown>>, string][] = [];
  const store: AutoRenewOffStore = {
    programmeFactsOf: async (_tx, id) => {
      calls.push(`read ${id}`);
      return world.programme;
    },
    lockProgramme: async (_tx, id) => void calls.push(`lock programmes ${id}`),
    lockEnrollment: async (_tx, id) => void calls.push(`lock enrollments ${id}`),
    openCaseOf: async (_tx, id, reason) => {
      calls.push(`case ${reason}`);
      expect(id).toBe(ENROLLMENT);
      return world.suspension === reason ? 'case' : null;
    },
  };
  const dependencies = {
    idempotency: {
      run: async (request, effect) => {
        keyed.push(request);
        return effect(tx);
      },
    } as ProgrammeServiceDependencies['idempotency'],
    settings: {
      read: async () => undefined,
    } as unknown as ProgrammeServiceDependencies['settings'],
    amounts: () => {
      throw new Error('no amount here');
    },
    log: { info: (fields, message) => void lines.push([fields, message]) },
    deleteProgrammeCard: async (_tx, id) => void calls.push(`delete card ${id}`),
    offStore: store,
  } satisfies Parameters<typeof turnAutoRenewOff>[3];
  const live = {
    afterCommit: (to: readonly string[], event: unknown) => void signals.push([to, event]),
  } as unknown as Parameters<ProgrammeServices['autoRenewOff']>[2];
  const input: ProgrammeActionInput = { enrollmentId: ENROLLMENT, idempotencyKey: KEY };
  const off = (studentUserId: string = STUDENT) =>
    turnAutoRenewOff(studentUserId, input, live, dependencies);
  return { world, off, calls, keyed, signals, lines };
}

describe('programme.autoRenewOff (006:T016; FR-713a, DEC-95, R-510)', () => {
  it('red first: keyed, it locks the programme then the enrollment, reads again, then deletes the card', async () => {
    const { off, calls, keyed } = offWorld();
    await expect(off()).resolves.toEqual({ ok: true });
    expect(keyed).toEqual([
      {
        scope: 'programme.autoRenewOff',
        key: KEY,
        actorId: STUDENT,
        input: { enrollmentId: ENROLLMENT },
      },
    ]);
    expect(calls).toEqual([
      `read ${ENROLLMENT}`,
      `lock programmes ${ENROLLMENT}`,
      `lock enrollments ${ENROLLMENT}`,
      `read ${ENROLLMENT}`,
      'case teacher_suspended',
      'case student_suspended',
      `delete card ${ENROLLMENT}`,
    ]);
  });

  it('red first: writes one line of ids and the reason and signals both parties after the commit', async () => {
    const { off, lines, signals } = offWorld();
    await off();
    expect(lines).toEqual([
      [
        { studentUserId: STUDENT, enrollmentId: ENROLLMENT, reason: 'auto_renew_off' },
        'The automatic renewal was turned off',
      ],
    ]);
    expect(signals).toEqual([
      [[STUDENT, TEACHER], { type: 'enrollment', enrollmentId: ENROLLMENT }],
    ]);
  });

  it.each<ProgrammeState>(['awaiting_offer', 'offered', 'active', 'paused'])(
    'red first: answers at any time before the close: %s',
    async (state) => {
      const { off, calls } = offWorld({ programme: facts({ state }) });
      await expect(off()).resolves.toEqual({ ok: true });
      expect(calls).toContain(`delete card ${ENROLLMENT}`);
    },
  );

  it('red first: another student’s programme, or none, answers NOT_FOUND with no lock and nothing deleted', async () => {
    for (const [programme, student] of [
      [facts(), OTHER_STUDENT],
      [null, STUDENT],
    ] as const) {
      const { off, calls, lines } = offWorld({ programme });
      const error: unknown = await off(student).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('NOT_FOUND');
      expect(calls).toEqual([`read ${ENROLLMENT}`]);
      expect(lines).toEqual([]);
    }
  });

  it('red first: refuses a closed programme, or one whose enrollment is no longer confirmed, closed: nothing deleted, one line', async () => {
    for (const programme of [facts({ state: 'closed' }), facts({ status: 'cancelled' })]) {
      const { off, calls, lines, signals } = offWorld({ programme });
      expect(await causeOf(off())).toBe('closed');
      expect(calls.filter((call) => call.startsWith('delete'))).toEqual([]);
      expect(lines).toEqual([
        [
          { studentUserId: STUDENT, enrollmentId: ENROLLMENT, reason: 'closed' },
          'The automatic renewal off was refused',
        ],
      ]);
      expect(signals).toEqual([]);
    }
  });

  it.each(['teacher_suspended', 'student_suspended'])(
    'red first: refuses party_suspended while a %s case is open: nothing deleted, one line',
    async (suspension) => {
      const { off, calls, lines } = offWorld({ suspension });
      expect(await causeOf(off())).toBe('party_suspended');
      expect(calls.filter((call) => call.startsWith('delete'))).toEqual([]);
      expect(lines).toEqual([
        [
          { studentUserId: STUDENT, enrollmentId: ENROLLMENT, reason: 'party_suspended' },
          'The automatic renewal off was refused',
        ],
      ]);
    },
  );
});

describe('the paid month’s resume, booking’s entry the confirm step calls (006:T016; FR-722, FR-724)', () => {
  const RESUMED_AT = new Date('2026-11-26T10:00:00Z');

  function paidWorld({ resumed, stop }: { resumed: boolean; stop: string | null }) {
    const calls: string[] = [];
    const lines: [Readonly<Record<string, unknown>>, string][] = [];
    const signals: [readonly string[], unknown][] = [];
    const store: ProgrammePaidStore = {
      writeProgrammePaid: async (_tx, id, payment) => {
        calls.push(`paid ${id} ${payment.plan} ${String(payment.monthsPaid)}`);
        return resumed;
      },
      withdrawOpenStop: async (_tx, id) => {
        calls.push(`withdraw stop ${id}`);
        return stop;
      },
      recordResumed: async (_tx, id, at) => void calls.push(`event ${id} ${at.toISOString()}`),
      programmeFactsOf: async (_tx, id) => {
        calls.push(`read ${id}`);
        return facts({ state: 'active' });
      },
      clock: async () => RESUMED_AT,
    };
    const paidTx = {} as Transaction;
    const unbind = bindToTransaction(paidTx, {
      afterCommit: (to: readonly string[], event: unknown) => void signals.push([to, event]),
    } as never);
    const log = {
      info: (fields: Readonly<Record<string, unknown>>, message: string) =>
        void lines.push([fields, message]),
    };
    const record = () =>
      recordProgrammePaid(paidTx, ENROLLMENT, { plan: 'monthly', monthsPaid: 3 }, log, store);
    return { record, calls, lines, signals, unbind };
  }

  it('red first: a paused programme resumed by its paid month writes programme_resumed at the database’s instant, one line, and signals both parties', async () => {
    const { record, calls, lines, signals, unbind } = paidWorld({ resumed: true, stop: null });
    await record();
    unbind();
    expect(calls).toEqual([
      `paid ${ENROLLMENT} monthly 3`,
      `withdraw stop ${ENROLLMENT}`,
      `event ${ENROLLMENT} ${RESUMED_AT.toISOString()}`,
      `read ${ENROLLMENT}`,
    ]);
    expect(lines).toEqual([
      [
        { enrollmentId: ENROLLMENT, reason: 'resumed' },
        'A paused programme was resumed by a paid month',
      ],
    ]);
    expect(signals).toEqual([
      [[STUDENT, TEACHER], { type: 'enrollment', enrollmentId: ENROLLMENT }],
    ]);
  });

  it('red first: an open stop request withdrawn by the paid month writes one line of ids and the reason', async () => {
    const { record, lines, unbind } = paidWorld({ resumed: true, stop: STOP });
    await record();
    unbind();
    expect(lines).toContainEqual([
      { enrollmentId: ENROLLMENT, requestId: STOP, reason: 'renewed' },
      'A programme stop request was withdrawn by a paid month',
    ]);
  });

  it('a month paid on an active programme writes no event, no line and no signal', async () => {
    const { record, calls, lines, signals, unbind } = paidWorld({ resumed: false, stop: null });
    await record();
    unbind();
    expect(calls).toEqual([`paid ${ENROLLMENT} monthly 3`, `withdraw stop ${ENROLLMENT}`]);
    expect(lines).toEqual([]);
    expect(signals).toEqual([]);
  });
});

describe('programme.renew’s check (006:T016; FR-715, FR-716, FR-720, FR-BOOK-12)', () => {
  /** Month 1’s last session ends Thursday 2026-12-03 08:00Z: month 2 is due then. */
  const DUE = new Date('2026-12-03T08:00:00Z');
  const EARLY = new Date('2026-11-30T08:00:00Z');
  const OWN_HOLD = '0199d0a0-0000-7000-8000-0000000016b1';
  const HELD_ENROLLMENT = '0199d0a0-0000-7000-8000-0000000016e0';
  const ORDER = '0199d0a0-0000-7000-8000-0000000016c1';
  const ORDER_EXPIRES = new Date('2026-11-30T08:10:00Z');

  const active: ProgrammeMonthRow = {
    enrollmentId: ENROLLMENT,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    status: 'confirmed',
    state: 'active',
    plan: 'monthly',
    monthsPaid: 1,
    monthCount: 10,
    nextDueAt: null,
    firstFailureAt: null,
    retriesDone: 0,
    slotId: '0199d0a0-0000-7000-8000-0000000016f9',
    timezone: 'Africa/Cairo',
    offerSessionCount: 40,
    offerTotal_piasters: piasters(1_000_000),
  };
  const monthOne: MonthSession[] = [
    { endsAt: new Date('2026-11-01T08:00:00Z') },
    { programmeMonth: 1, endsAt: new Date('2026-11-26T08:00:00Z') },
    { programmeMonth: 1, endsAt: DUE },
  ];
  const automatic = (change: Partial<AutomaticOrderFacts>): AutomaticOrderFacts => ({
    paymentId: ORDER,
    status: 'created',
    expiresAt: ORDER_EXPIRES,
    declineKind: null,
    attempt: 0,
    failedAt: null,
    ...change,
  });

  interface RenewWorld {
    row: ProgrammeMonthRow | null;
    now: Date;
    hold: HeldRow | null;
    suspension: string | null;
    sessions: readonly MonthSession[];
    month: MonthOrders;
    orders: ReadonlyMap<string, ProgrammePayOrders>;
  }

  function renewWorld(change: Partial<RenewWorld> = {}) {
    const world: RenewWorld = {
      row: active,
      now: EARLY,
      hold: null,
      suspension: null,
      sessions: monthOne,
      month: { cardSaved: false, payable: false, processing: false, automatic: null },
      orders: new Map(),
      ...change,
    };
    const calls: string[] = [];
    const lines: [Readonly<Record<string, unknown>>, string][] = [];
    const store: ProgrammeRenewStore = {
      programmeMonthOf: async (_tx, id) => {
        calls.push(`read ${id}`);
        return world.row;
      },
      lockRows: async (_tx, table, ids) => void calls.push(`lock ${table} ${ids.join(',')}`),
      ownActiveHold: async () => world.hold,
      activeHoldsByIds: async (_tx, ids) =>
        world.hold !== null && ids.includes(world.hold.id) ? [world.hold] : [],
      openCaseOf: async (_tx, _id, reason) => {
        calls.push(`case ${reason}`);
        return world.suspension === reason ? 'case' : null;
      },
      clock: async () => world.now,
      sessionsOf: async () => world.sessions,
    };
    const check = () =>
      checkedProgrammeRenew(
        tx,
        { studentUserId: STUDENT, enrollmentId: ENROLLMENT },
        {
          orders: async (_tx, ids, at) => {
            calls.push(`orders ${ids.join(',')} at ${at.toISOString()}`);
            return world.orders;
          },
          monthOrders: async (_tx, id, month, at) => {
            calls.push(`month ${String(month)} of ${id} at ${at.toISOString()}`);
            return world.month;
          },
          earlyDays: 3,
          log: { info: (fields, message) => void lines.push([fields, message]) },
          store,
        },
      );
    return { check, calls, lines };
  }

  const refusalLine = (reason: string) => [
    { studentUserId: STUDENT, enrollmentId: ENROLLMENT, reason },
    'A programme renewal was refused',
  ];

  it('red first: in kernel.md’s order, it answers the next month by hand from programme_renew_early_days before the due point', async () => {
    const { check, calls, lines } = renewWorld();
    await expect(check()).resolves.toEqual({
      enrollmentId: ENROLLMENT,
      studentUserId: STUDENT,
      teacherUserId: TEACHER,
      track: 'ijazah_track',
      instalmentMonth: 2,
      offerSessionCount: 40,
      total_piasters: piasters(1_000_000),
    });
    expect(calls).toEqual([
      `read ${ENROLLMENT}`,
      `lock users ${[STUDENT, TEACHER].sort().join(',')}`,
      `lock programmes ${ENROLLMENT}`,
      `lock enrollments ${ENROLLMENT}`,
      `read ${ENROLLMENT}`,
      'case teacher_suspended',
      'case student_suspended',
      `month 2 of ${ENROLLMENT} at ${EARLY.toISOString()}`,
      `orders ${ENROLLMENT} at ${EARLY.toISOString()}`,
    ]);
    expect(lines).toEqual([]);
  });

  it('red first: refuses not_due_yet without a card before the due point less the early days, and with no due point', async () => {
    for (const change of [
      { now: new Date('2026-11-30T07:59:59Z') },
      { sessions: monthOne.slice(0, 1) },
    ]) {
      const { check, lines } = renewWorld(change);
      expect(await causeOf(check())).toBe('not_due_yet');
      expect(lines).toEqual([refusalLine('not_due_yet')]);
    }
  });

  it('red first: refuses not_due_yet with a saved card and no failure: the month is charged by itself', async () => {
    const { check } = renewWorld({
      now: DUE,
      month: { cardSaved: true, payable: false, processing: false, automatic: null },
    });
    expect(await causeOf(check())).toBe('not_due_yet');
  });

  it.each<Partial<AutomaticOrderFacts>>([
    { status: 'failed', declineKind: 'soft' },
    { status: 'failed', declineKind: 'hard' },
    // A failure whose kind is not yet answered; a `no_payee` refusal is failed and hard.
    { status: 'failed', declineKind: null },
    { status: 'expired' },
  ])(
    'red first: answers «pay now» and «change card» after a failure of the month’s charge: %o',
    async (failed) => {
      for (const cardSaved of [true, false]) {
        const { check } = renewWorld({
          now: new Date('2026-11-01T08:00:00Z'),
          month: { cardSaved, payable: false, processing: false, automatic: automatic(failed) },
        });
        await expect(check()).resolves.toMatchObject({ instalmentMonth: 2 });
      }
    },
  );

  it('red first: refuses charge_pending while the month’s automatic order is created, unexpired or unanswered', async () => {
    for (const now of [EARLY, DUE]) {
      const { check, lines } = renewWorld({
        now,
        month: { cardSaved: true, payable: true, processing: false, automatic: automatic({}) },
      });
      expect(await causeOf(check())).toBe('charge_pending');
      expect(lines).toEqual([refusalLine('charge_pending')]);
    }
  });

  it('red first: refuses closed on a closed programme or an enrollment no longer confirmed', async () => {
    for (const row of [
      { ...active, state: 'closed' as const },
      { ...active, status: 'cancelled' as const },
    ]) {
      const { check, calls } = renewWorld({ row });
      expect(await causeOf(check())).toBe('closed');
      expect(calls.some((call) => call.startsWith('month'))).toBe(false);
    }
  });

  it('red first: refuses nothing_due before the first payment, in full, and once every month is paid', async () => {
    for (const row of [
      { ...active, state: 'offered' as const, plan: null },
      { ...active, state: 'awaiting_offer' as const, plan: null },
      { ...active, plan: 'in_full' as const, monthsPaid: 10 },
      { ...active, monthsPaid: 10 },
    ]) {
      const { check } = renewWorld({ row });
      expect(await causeOf(check())).toBe('nothing_due');
    }
  });

  it.each(['teacher_suspended', 'student_suspended'])(
    'red first: refuses party_suspended while a %s case is open',
    async (suspension) => {
      const { check, lines } = renewWorld({ suspension });
      expect(await causeOf(check())).toBe('party_suspended');
      expect(lines).toEqual([refusalLine('party_suspended')]);
    },
  );

  it('red first: another student’s programme, or none, answers NOT_FOUND before any lock', async () => {
    for (const row of [{ ...active, studentUserId: OTHER_STUDENT }, null]) {
      const { check, calls } = renewWorld({ row });
      const error: unknown = await check().catch((thrown: unknown) => thrown);
      expect((error as DomainError).code).toBe('NOT_FOUND');
      expect(calls).toEqual([`read ${ENROLLMENT}`]);
    }
  });

  it('red first: refuses PREVIOUS_CHECKOUT while an order of the programme is payable, or paid and not yet processed', async () => {
    const payable = renewWorld({
      orders: new Map([
        [
          ENROLLMENT,
          {
            payable: { paymentId: ORDER, gatewayOrderId: 'g-1', expiresAt: ORDER_EXPIRES },
            paid: false,
            programmeProcessing: false,
          },
        ],
      ]),
    });
    await expect(payable.check()).rejects.toEqual(
      new DomainError('PREVIOUS_CHECKOUT', undefined, {
        details: [
          { path: 'enrollmentId', code: ENROLLMENT },
          { path: 'state', code: 'payable' },
          { path: 'expiresAt', code: ORDER_EXPIRES.toISOString() },
        ],
      }),
    );
    const processing = renewWorld({
      orders: new Map([[ENROLLMENT, { payable: null, paid: true, programmeProcessing: true }]]),
    });
    const error = (await processing.check().catch((thrown: unknown) => thrown)) as DomainError;
    expect(error.code).toBe('PREVIOUS_CHECKOUT');
    expect(error.details?.[1]).toEqual({ path: 'state', code: 'processing' });
  });

  it('red first: refuses PREVIOUS_CHECKOUT while the student’s own hold’s order is payable, its enrollment locked with the programme’s', async () => {
    const { check, calls } = renewWorld({
      hold: {
        id: OWN_HOLD,
        slotId: '0199d0a0-0000-7000-8000-0000000016f8',
        studentUserId: STUDENT,
        enrollmentId: HELD_ENROLLMENT,
        expiresAt: ORDER_EXPIRES,
      },
      orders: new Map([
        [
          HELD_ENROLLMENT,
          {
            payable: { paymentId: ORDER, gatewayOrderId: 'g-2', expiresAt: ORDER_EXPIRES },
            paid: false,
            programmeProcessing: false,
          },
        ],
      ]),
    });
    const error = (await check().catch((thrown: unknown) => thrown)) as DomainError;
    expect(error.code).toBe('PREVIOUS_CHECKOUT');
    expect(calls).toContain(`lock slot_holds ${OWN_HOLD}`);
    expect(calls).toContain(`lock enrollments ${[ENROLLMENT, HELD_ENROLLMENT].sort().join(',')}`);
  });
});
