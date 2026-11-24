// T039 (R-215, FR-361, FR-362, FR-375, FR-PAYG-19; ARCHITECTURE §8.1): the `confirm-enrollment`
// job's decisions, over recorded steps. Which branch a paid order takes, in R-215's order: an order
// that is not `paid` (a `refunded` one) or that a compensation case already covers is ignored (the
// note under T035); an enrollment whose `confirmed` event names another order gets one
// `duplicate_payment` case and nothing else (FR-375), while a replay of the confirming order does
// nothing; an order no case covers, on an enrollment whose cases were all closed before it was
// paid, gets one `duplicate_payment` case (T082, FR-PAYG-19 as amended 2026-11-04); one R-219
// cancelled takes the refusal at once (`party_restricted`); an active hold is converted and the
// enrollment confirmed
// with its sessions, no party checked; a late one checks the parties (`party_restricted` when they
// may not book), then re-holds and confirms; the database's four named refusals are refused in a
// new transaction (`slot_unavailable`), anything else rethrown. The same steps over the real tables
// are `tests/db-integrity/confirm-enrollment.spec.ts`. T027 of specs/004-sessions (FR-466, H3; the
// note under T027, Q2 (a)): the late branch reads the reservations of both parties, under the locks
// it already holds, over the sessions generation would write, and takes the refusal branch
// (`slot_unavailable`, a case) when one would overlap, re-holding nothing; the branch converting a
// still-active hold reads none. Over the real tables: `tests/db-integrity/remedy-reservations.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { LockedEnrollment } from '../modules/booking/index.js';
import type { CaseInstants } from '../modules/moderation/index.js';
import type { Transaction } from '../platform/db/prisma.repository.js';
import { publisherOn } from '../platform/live/live-publisher.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import {
  CONFIRM_ENROLLMENT,
  type ConfirmationSteps,
  confirmEnrollment,
} from './confirm-enrollment.js';
import { runOnceAndTwice } from './double-run.js';

const NOW = new Date('2026-11-03T08:00:00Z');
const PAYMENT = '019a4a00-0000-7000-8000-000000000001';
const OTHER_PAYMENT = '019a4a00-0000-7000-8000-000000000002';
const ENROLLMENT = '019a4a00-0000-7000-8000-000000000003';
const STUDENT = '019a4a00-0000-7000-8000-000000000004';
const TEACHER = '019a4a00-0000-7000-8000-000000000005';
const SLOT = '019a4a00-0000-7000-8000-000000000006';
const HOLD = '019a4a00-0000-7000-8000-000000000007';
const PAID_AT = new Date('2026-11-03T07:59:00Z');
/** 006:T009: an offer's pay_by_at, the offer + 48 hours, after NOW. */
const PAY_BY = new Date('2026-11-04T10:00:00Z');

const SETTINGS: Record<string, number> = {
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
};

const settings: SettingsReader = {
  read: async (key, schema) => schema.parse(SETTINGS[key]),
};

interface World {
  /** The order as the payments module reads it under the lock. */
  status: 'paid' | 'refunded' | 'created';
  paidRecordedAt: Date | null;
  /** The enrollment's compensation cases as moderation folds them; null when it has none. */
  cases: CaseInstants | null;
  enrollment: Partial<LockedEnrollment>;
  bookable: boolean;
  /** No order has the payment's id. */
  orderMissing?: boolean;
  /** Thrown by the step named, once, in the first transaction. */
  failAt?: { step: 'rehold' | 'generate' | 'confirm'; error: Error };
  /** The times open remedies reserve for the parties (T027). */
  reserved?: readonly { startsAt: Date; endsAt: Date }[];
  /** 006:T005: the order's kind; `package` when not named. */
  kind?: 'package' | 'assessment' | 'rest_in_full' | 'instalment';
  /** 006:T006: an instalment's month, and the order's marker when already set (V-3). */
  instalmentMonth?: number;
  confirmedAt?: Date;
  /** 006:T006: the enrollment's other programme orders the confirm step already processed. */
  processed?: readonly { kind: 'rest_in_full' | 'instalment'; instalmentMonth: number | null }[];
  /** 006:T006: an open suspension case of the enrollment. */
  suspension?: 'teacher_suspended' | 'student_suspended';
  /** 006:T006: the enrollment's sessions, by number and end. */
  sessions?: readonly { sequenceNumber: number; endsAt: Date }[];
}

interface Recorded {
  readonly calls: string[];
  /** 006:T009 (Q-C1 (a)): the programme's payment each attempt wrote, as `<plan> <months paid>`. */
  readonly programmePaid: string[];
  /** 006:T016: the log each `recordProgrammePaid` was handed (the job's own, for its lines). */
  readonly paidLogs: unknown[];
  readonly transactions: number;
  /** 005:T016: the work each attempt queued on its own after-commit list, as it was sent. */
  readonly sent: string[];
}

function locked(overrides: Partial<LockedEnrollment>): LockedEnrollment {
  return {
    id: ENROLLMENT,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    slotId: SLOT,
    status: 'pending_payment',
    cancellationReason: null,
    snapshotSessionCount: 4,
    snapshotDurationMinutes: 60,
    snapshotSlotTimezone: 'Africa/Cairo',
    activeHoldId: HOLD,
    confirmingPaymentId: null,
    confirmed: false,
    cancelledByTermination: false,
    // 006:T006 (rule d): no programme unless the world names one.
    programmeState: null,
    // 006:T009 (rule d): no programme, no pay_by.
    programmePayByAt: null,
    ...overrides,
  };
}

function harness(world: World) {
  const calls: string[] = [];
  const sent: string[] = [];
  const programmePaid: string[] = [];
  const paidLogs: unknown[] = [];
  const logged: [object, string][] = [];
  let transactions = 0;
  let failed = false;
  const tx = {} as Transaction;
  const failing = (step: 'rehold' | 'generate' | 'confirm') => {
    if (world.failAt?.step === step && !failed) {
      failed = true;
      throw world.failAt.error;
    }
  };
  const steps: ConfirmationSteps = {
    orderEnrollmentOf: async (_tx, paymentId) => {
      calls.push(`order ${paymentId === PAYMENT ? 'this' : 'other'}`);
      return world.orderMissing === true ? null : ENROLLMENT;
    },
    partiesOf: async () => ({
      id: ENROLLMENT,
      studentUserId: STUDENT,
      teacherUserId: TEACHER,
      slotId: SLOT,
    }),
    lock: async () => {
      calls.push('lock');
      return locked(world.enrollment);
    },
    paidOrderOf: async () => ({ status: world.status, paidRecordedAt: world.paidRecordedAt }),
    // 006:T005: the order's kind, read under the locks with its status.
    orderTermsOf: async (_tx, paymentId) => {
      expect(paymentId).toBe(PAYMENT);
      return {
        kind: world.kind ?? 'package',
        instalmentMonth: world.instalmentMonth ?? null,
        confirmedAt: world.confirmedAt ?? null,
      };
    },
    // 006:T006: the per-order marker, the processed programme orders, a suspension, the sessions.
    // 006:T009 (Q-C1 (a)): the programme's payment, through booking's entry.
    recordProgrammePaid: async (_tx, enrollmentId, payment, log) => {
      expect(enrollmentId).toBe(ENROLLMENT);
      paidLogs.push(log);
      programmePaid.push(`${payment.plan} ${String(payment.monthsPaid)}`);
    },
    // 006:T009, PR #156 r2 Follow-up 1: no instant of the job's; the marker reads the database's.
    markConfirmed: async (...args: unknown[]) => {
      expect(args.slice(1)).toEqual([PAYMENT]);
      calls.push('mark confirmed');
    },
    programmeOrdersOf: async (_tx, enrollmentId) => {
      expect(enrollmentId).toBe(ENROLLMENT);
      return world.processed ?? [];
    },
    openCaseOf: async (_tx, enrollmentId, reason) => {
      expect(enrollmentId).toBe(ENROLLMENT);
      return world.suspension === reason ? 'open-case' : null;
    },
    sessionsOf: async (_tx, enrollmentId) => {
      expect(enrollmentId).toBe(ENROLLMENT);
      return world.sessions ?? [];
    },
    startProgramme: async (_tx, enrollmentId) => {
      expect(enrollmentId).toBe(ENROLLMENT);
      calls.push('programme awaiting_offer');
    },
    casesOf: async (_tx, enrollmentId) => {
      expect(enrollmentId).toBe(ENROLLMENT);
      return world.cases;
    },
    openCase: async (_tx, enrollmentId, reason) => {
      calls.push(`case ${reason}`);
      expect(enrollmentId).toBe(ENROLLMENT);
    },
    confirm: async (_tx, { enrollmentId, paymentId, at }) => {
      failing('confirm');
      expect([enrollmentId, paymentId, at]).toEqual([ENROLLMENT, PAYMENT, NOW]);
      const converted = world.enrollment.activeHoldId !== null || calls.includes('rehold');
      calls.push(converted ? 'confirm' : 'confirm: no hold');
      // 005:T016: booking's writer queues the push on the attempt's own list, as the real one does.
      if (converted) publisherOn(_tx)?.afterCommitDo?.(() => void sent.push('payment_confirmed'));
      return converted ? 'confirmed' : 'no_active_hold';
    },
    bookablePair: async (_tx, student, teacher) => {
      calls.push('pair');
      expect([student, teacher]).toEqual([STUDENT, TEACHER]);
      return world.bookable;
    },
    rehold: async (_tx, enrollment, terms) => {
      failing('rehold');
      expect(enrollment).toEqual({ id: ENROLLMENT, slotId: SLOT, studentUserId: STUDENT });
      expect([terms.now, terms.ttlMinutes, terms.graceMinutes]).toEqual([NOW, 10, 5]);
      calls.push('rehold');
    },
    refuse: async (_tx, enrollment, refusal, at) => {
      expect([enrollment.id, at]).toEqual([ENROLLMENT, NOW]);
      calls.push(`refuse ${refusal}`);
      publisherOn(_tx)?.afterCommitDo?.(() => void sent.push(`refused ${refusal}`));
    },
    slotOf: async (_tx, slotId) => {
      expect(slotId).toBe(SLOT);
      return { dayOfWeek: 4, startTimeLocal: '09:00:00' };
    },
    reservedTimesOf: async (_tx, userIds, window) => {
      calls.push('reserved');
      expect([...userIds].sort()).toEqual([STUDENT, TEACHER].sort());
      // The four Thursdays generation would write from NOW with a lead of 24 hours; 006:T005: an
      // assessment's one Thursday, for its 30 minutes.
      expect(window).toEqual(
        world.kind === 'assessment'
          ? { from: new Date('2026-11-05T07:00:00Z'), to: new Date('2026-11-05T07:30:00Z') }
          : { from: new Date('2026-11-05T07:00:00Z'), to: new Date('2026-11-26T08:00:00Z') },
      );
      return (world.reserved ?? []).map((time) => ({ remedyId: 'r', sessionId: 's', ...time }));
    },
    generate: async (_tx, enrollment, confirmedAt, leadHours, plan) => {
      failing('generate');
      expect(enrollment).toEqual({
        id: ENROLLMENT,
        teacherUserId: TEACHER,
        studentUserId: STUDENT,
        snapshotSessionCount: world.enrollment.snapshotSessionCount ?? 4,
        snapshotDurationMinutes: world.enrollment.snapshotDurationMinutes ?? 60,
        snapshotSlotTimezone: 'Africa/Cairo',
        slot: { dayOfWeek: 4, startTimeLocal: '09:00:00' },
      });
      if (plan === undefined || plan.months === undefined) {
        expect([confirmedAt, leadHours]).toEqual([NOW, 24]);
      }
      calls.push(
        plan === undefined
          ? 'generate'
          : `generate ${String(plan.count)} from ${String(plan.firstSequenceNumber)}${
              plan.months === undefined ? '' : ` months ${plan.months.join(',')}`
            } after ${confirmedAt.toISOString()} lead ${String(leadHours)}`,
      );
    },
  };
  const job = confirmEnrollment({
    database: {
      $transaction: (async (work: (tx: Transaction) => Promise<unknown>) => {
        transactions += 1;
        calls.push('begin');
        return work(tx);
      }) as never,
    },
    settings,
    // 005:T016: the steps are stand-ins here; the port reaches booking's writer in the real steps.
    notices: { record: () => Promise.reject(new Error('the stand-in steps record no push')) },
    steps,
    clock: () => NOW,
    enrollments: { enrollmentFor: async () => null },
    log: {
      // Two arguments only, as the job writes them: its fields and its message.
      info: ((fields: object, message: string) => void logged.push([fields, message])) as never,
    },
  });
  return {
    job,
    recorded: (): Recorded => ({
      calls: [...calls],
      programmePaid: [...programmePaid],
      paidLogs: [...paidLogs],
      transactions,
      sent: [...sent],
    }),
    logged,
  };
}

const paid = (overrides: Partial<World> = {}): World => ({
  status: 'paid',
  paidRecordedAt: PAID_AT,
  cases: null,
  enrollment: {},
  bookable: true,
  ...overrides,
});

async function run(world: World): Promise<Recorded> {
  const { job, recorded } = harness(world);
  await job.handle({ paymentId: PAYMENT });
  return recorded();
}

/** The database's refusal as `@prisma/adapter-pg` reports it (T006). */
function refusedBy(code: '23505' | '23P01', constraint: string): Error {
  return Object.assign(new Error('refused'), {
    name: 'DriverAdapterError',
    cause: {
      originalCode: code,
      originalMessage: `violates constraint "${constraint}"`,
      constraint: code === '23505' ? { index: constraint } : undefined,
    },
  });
}

const PREAMBLE = ['begin', 'order this', 'lock'];

describe('confirm-enrollment: the job', () => {
  it('is named as its file and takes the payment id alone (R-SEC-2)', async () => {
    const { job } = harness(paid());
    expect([job.name, job.schedule]).toEqual([CONFIRM_ENROLLMENT, undefined]);
    expect(CONFIRM_ENROLLMENT).toBe('confirm-enrollment');
    await expect(job.handle({ paymentId: 'not-an-id' })).rejects.toThrow();
  });
});

describe('confirm-enrollment: with the hold active (FR-361)', () => {
  it('converts the hold, confirms and generates in one transaction, checking no party', async () => {
    expect((await run(paid())).calls).toEqual([...PREAMBLE, 'confirm', 'generate']);
  });

  it('confirms an enrollment kept awaiting payment whose hold is still active', async () => {
    const recorded = await run(paid({ enrollment: { status: 'pending_payment' } }));
    expect(recorded.transactions).toBe(1);
  });
});

describe('confirm-enrollment: an assessment (006:T005; FR-701, R-504)', () => {
  /** The assessment's snapshot: one session of 30 minutes. */
  const assessment = { snapshotSessionCount: 1, snapshotDurationMinutes: 30 };

  it('confirms the hold, generates session 1 only and writes the programme awaiting its offer', async () => {
    expect((await run(paid({ kind: 'assessment', enrollment: assessment }))).calls).toEqual([
      ...PREAMBLE,
      'confirm',
      'generate 1 from 1 after 2026-11-03T08:00:00.000Z lead 24',
      'programme awaiting_offer',
      'mark confirmed',
    ]);
  });

  it('does the same on a late payment, after the parties’ check and the re-hold', async () => {
    const late = { ...assessment, activeHoldId: null, status: 'cancelled' as const };
    expect((await run(paid({ kind: 'assessment', enrollment: late }))).calls).toEqual([
      ...PREAMBLE,
      'confirm: no hold',
      'pair',
      'reserved',
      'rehold',
      'confirm',
      'generate 1 from 1 after 2026-11-03T08:00:00.000Z lead 24',
      'programme awaiting_offer',
      'mark confirmed',
    ]);
  });

  it('writes no programme for a package’s order, and no plan', async () => {
    const { calls } = await run(paid());
    expect(calls).not.toContain('programme awaiting_offer');
    expect(calls.at(-1)).toBe('generate');
  });

  it('writes no programme when the assessment’s confirmation is refused', async () => {
    const { calls } = await run(
      paid({ kind: 'assessment', enrollment: { ...assessment, cancelledByTermination: true } }),
    );
    expect(calls).not.toContain('programme awaiting_offer');
  });
});

describe('confirm-enrollment: a late payment (FR-362, FR-PAYG-19)', () => {
  const late = { activeHoldId: null, status: 'cancelled' as const };

  it('checks the parties, then re-holds, confirms and generates', async () => {
    expect((await run(paid({ enrollment: late }))).calls).toEqual([
      ...PREAMBLE,
      'confirm: no hold',
      'pair',
      'reserved',
      'rehold',
      'confirm',
      'generate',
    ]);
  });

  it('takes the refusal branch, re-holding nothing, when a session it would generate overlaps a reservation of either party (T027, H3)', async () => {
    const { job, recorded, logged } = harness(
      paid({
        enrollment: late,
        // The third Thursday, 2026-11-19 09:00 Cairo, partly over a reserved time.
        reserved: [
          { startsAt: new Date('2026-11-19T07:30:00Z'), endsAt: new Date('2026-11-19T08:30:00Z') },
        ],
      }),
    );
    await job.handle({ paymentId: PAYMENT });
    expect(recorded().calls).toEqual([
      ...PREAMBLE,
      'confirm: no hold',
      'pair',
      'reserved',
      'refuse slot_unavailable',
      'case slot_unavailable',
    ]);
    expect(recorded().transactions).toBe(1);
    expect(logged).toEqual([
      [
        { enrollmentId: ENROLLMENT, paymentId: PAYMENT, reason: 'reservation_overlap' },
        'Late payment refused: a session would overlap a reserved time',
      ],
    ]);
  });

  it('re-holds when a reserved time only touches a session it would generate, end to start', async () => {
    const recorded = await run(
      paid({
        enrollment: late,
        reserved: [
          { startsAt: new Date('2026-11-19T08:00:00Z'), endsAt: new Date('2026-11-19T09:00:00Z') },
        ],
      }),
    );
    expect(recorded.calls).toContain('rehold');
  });

  it('refuses for a party when the pair may not book, re-holding nothing', async () => {
    const recorded = await run(paid({ enrollment: late, bookable: false }));
    expect(recorded.calls).toEqual([
      ...PREAMBLE,
      'confirm: no hold',
      'pair',
      'refuse party_restricted',
      'case party_restricted',
    ]);
  });

  it.each([
    ['the slot held by another student', refusedBy('23505', 'slot_holds_slot_id_active_key')],
    [
      'the student holding another slot',
      refusedBy('23505', 'slot_holds_student_user_id_active_key'),
    ],
  ])('on %s refuses in a new transaction with slot_unavailable', async (_name, error) => {
    const recorded = await run(paid({ enrollment: late, failAt: { step: 'rehold', error } }));
    expect(recorded.calls).toEqual([
      ...PREAMBLE,
      'confirm: no hold',
      'pair',
      'reserved',
      ...PREAMBLE,
      'refuse slot_unavailable',
      'case slot_unavailable',
    ]);
    expect(recorded.transactions).toBe(2);
  });

  it.each([
    ['the teacher', refusedBy('23P01', 'sessions_teacher_no_overlap')],
    ['the student', refusedBy('23P01', 'sessions_student_no_overlap')],
  ])('on a session overlapping one of %s refuses in a new transaction', async (_name, error) => {
    const recorded = await run(paid({ failAt: { step: 'generate', error } }));
    expect(recorded.calls).toEqual([
      ...PREAMBLE,
      'confirm',
      ...PREAMBLE,
      'refuse slot_unavailable',
      'case slot_unavailable',
    ]);
  });

  it.each([
    ['another unique index', refusedBy('23505', 'users_phone_key')],
    ['another exclusion', refusedBy('23P01', 'some_other_exclusion')],
    ['any other error', new Error('connection lost')],
  ])('rethrows %s, refusing nothing', async (_name, error) => {
    const { job, recorded } = harness(
      paid({ enrollment: late, failAt: { step: 'rehold', error } }),
    );
    await expect(job.handle({ paymentId: PAYMENT })).rejects.toBe(error);
    expect(recorded().transactions).toBe(1);
    expect(recorded().calls.some((call) => call.startsWith('refuse'))).toBe(false);
  });
});

describe('confirm-enrollment: an enrollment R-219 cancelled (FR-362)', () => {
  it('takes the refusal at once with party_restricted, checking no hold and no party', async () => {
    const recorded = await run(
      paid({
        enrollment: {
          status: 'cancelled',
          cancellationReason: 'teacher_suspended',
          cancelledByTermination: true,
          activeHoldId: null,
        },
      }),
    );
    expect(recorded.calls).toEqual([
      ...PREAMBLE,
      'refuse party_restricted',
      'case party_restricted',
    ]);
  });
});

describe('confirm-enrollment: a confirmed enrollment (FR-375)', () => {
  const confirmedBy = (paymentId: string) => ({
    status: 'confirmed' as const,
    confirmed: true,
    activeHoldId: null,
    confirmingPaymentId: paymentId,
  });

  it('opens a duplicate_payment case for another order and changes nothing else', async () => {
    const recorded = await run(paid({ enrollment: confirmedBy(OTHER_PAYMENT) }));
    expect(recorded.calls).toEqual([...PREAMBLE, 'case duplicate_payment']);
  });

  it('checks the duplicate before the early return on an existing case', async () => {
    const resolvedEarlier: CaseInstants = {
      open: false,
      lastOpenedAt: new Date('2026-11-03T07:00:00Z'),
      lastClosedAt: new Date('2026-11-03T07:30:00Z'),
    };
    const recorded = await run(
      paid({ enrollment: confirmedBy(OTHER_PAYMENT), cases: resolvedEarlier }),
    );
    expect(recorded.calls).toEqual([...PREAMBLE, 'case duplicate_payment']);
  });

  it('does nothing on a replay of the confirming order', async () => {
    expect((await run(paid({ enrollment: confirmedBy(PAYMENT) }))).calls).toEqual(PREAMBLE);
  });

  it('opens a duplicate_payment case for a confirmed enrollment with no confirmed event', async () => {
    const recorded = await run(
      paid({ enrollment: { status: 'confirmed', confirmed: true, activeHoldId: null } }),
    );
    expect(recorded.calls).toEqual([...PREAMBLE, 'case duplicate_payment']);
  });
});

/** Cases opened at `openedAt`, open, or closed at `closedAt`. */
const casesOf = (openedAt: string, closedAt: string | null, open = false): CaseInstants => ({
  open,
  lastOpenedAt: new Date(openedAt),
  lastClosedAt: closedAt === null ? null : new Date(closedAt),
});

describe('confirm-enrollment: what it ignores (FR-PAYG-19; the note under T035)', () => {
  const duplicate = {
    status: 'confirmed' as const,
    confirmed: true,
    confirmingPaymentId: OTHER_PAYMENT,
  };

  it.each([
    ['a refunded order', paid({ status: 'refunded' })],
    ['an order not paid', paid({ status: 'created', paidRecordedAt: null })],
    [
      'an order a case opened after its paid event covers',
      paid({ cases: casesOf('2026-11-03T07:59:30Z', null, true), enrollment: duplicate }),
    ],
    [
      'an order paid while a case of its enrollment is open (T082)',
      paid({
        cases: casesOf('2026-11-03T07:00:00Z', null, true),
        enrollment: { status: 'cancelled' },
      }),
    ],
    [
      'an order paid while a case was open, the case since resolved (T082)',
      paid({
        cases: casesOf('2026-11-03T07:00:00Z', '2026-11-03T07:59:30Z'),
        enrollment: { status: 'cancelled' },
      }),
    ],
    [
      'an order of a confirmed enrollment paid while its duplicate case is open (T082)',
      paid({ cases: casesOf('2026-11-03T07:00:00Z', null, true), enrollment: duplicate }),
    ],
    [
      'an order paid after one case was closed while another is open (T082)',
      paid({
        cases: { ...casesOf('2026-11-03T07:00:00Z', '2026-11-03T07:30:00Z'), open: true },
        enrollment: { status: 'cancelled' },
      }),
    ],
  ])('ignores %s', async (_name, world) => {
    expect((await run(world)).calls).toEqual(PREAMBLE);
  });

  it('counts a case opened in the same millisecond as the paid event as covering it', async () => {
    const recorded = await run(
      paid({
        cases: { open: false, lastOpenedAt: PAID_AT, lastClosedAt: null },
        enrollment: duplicate,
      }),
    );
    expect(recorded.calls).toEqual(PREAMBLE);
  });

  it('fails loudly on a payment id no order holds, writing nothing', async () => {
    const { job, recorded } = harness(paid({ orderMissing: true }));
    await expect(job.handle({ paymentId: PAYMENT })).rejects.toThrow(/no order/i);
    expect(recorded().calls).toEqual(['begin', 'order this']);
  });
});

describe('confirm-enrollment: an order paid after every case was closed (T082, FR-PAYG-19)', () => {
  const closedBeforePaid = casesOf('2026-11-03T07:00:00Z', '2026-11-03T07:30:00Z');

  it.each([
    ['cancelled with its refusal’s case resolved', { status: 'cancelled' as const }],
    [
      'R-219 cancelled, its party_restricted case dismissed',
      {
        status: 'cancelled' as const,
        cancellationReason: 'teacher_suspended' as const,
        cancelledByTermination: true,
        activeHoldId: null,
      },
    ],
  ])(
    'opens one duplicate_payment case on an enrollment %s, and nothing else',
    async (_name, enrollment) => {
      const recorded = await run(paid({ cases: closedBeforePaid, enrollment }));
      expect(recorded.calls).toEqual([...PREAMBLE, 'case duplicate_payment']);
    },
  );

  it('counts a closed case with no recorded closing as closed when it was opened', async () => {
    const recorded = await run(
      paid({
        cases: casesOf('2026-11-03T07:00:00Z', null),
        enrollment: { status: 'cancelled' },
      }),
    );
    expect(recorded.calls).toEqual([...PREAMBLE, 'case duplicate_payment']);
  });

  it('a second run opens no second case: the first one’s case, open, covers the order', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => {
        const world = paid({ cases: closedBeforePaid, enrollment: { status: 'cancelled' } });
        const { job, recorded } = harness(world);
        return { world, job, recorded };
      },
      run: async ({ world, job }) => {
        await job.handle({ paymentId: PAYMENT });
        world.cases = { ...closedBeforePaid, open: true, lastOpenedAt: NOW };
      },
      observe: ({ recorded }) =>
        recorded().calls.filter((call) => !['begin', 'order this', 'lock'].includes(call)),
    });
    expect(once).toEqual(['case duplicate_payment']);
    expect(twice).toEqual(once);
  });
});

describe('confirm-enrollment: idempotent (R-API-14)', () => {
  it('leaves after two runs what one run leaves', async () => {
    // A world whose second run sees the first's confirmation, as the database would show it.
    const { once, twice } = await runOnceAndTwice({
      world: () => {
        const world = paid();
        const { job, recorded } = harness(world);
        return { world, job, recorded };
      },
      run: async ({ world, job }) => {
        await job.handle({ paymentId: PAYMENT });
        world.enrollment = {
          status: 'confirmed',
          confirmed: true,
          activeHoldId: null,
          confirmingPaymentId: PAYMENT,
        };
      },
      observe: ({ recorded }) =>
        recorded().calls.filter((call) => !['begin', 'order this', 'lock'].includes(call)),
    });
    expect(once).toEqual(['confirm', 'generate']);
    expect(twice).toEqual(once);
  });
});

describe('confirm-enrollment: each attempt’s own after-commit list (005:T016, Q-N3 (a))', () => {
  it('sends the confirmation’s push once its transaction has committed', async () => {
    const recorded = await run(paid());
    expect(recorded.sent).toEqual(['payment_confirmed']);
  });

  it('drops the push of a confirm attempt the database refuses; the refuse attempt sends only its own', async () => {
    const recorded = await run(
      paid({
        failAt: { step: 'generate', error: refusedBy('23P01', 'sessions_student_no_overlap') },
      }),
    );
    expect(recorded.transactions).toBe(2);
    expect(recorded.sent).toEqual(['refused slot_unavailable']);
  });

  it('sends nothing when the attempt fails and is not refused', async () => {
    const { job, recorded } = harness(
      paid({ failAt: { step: 'generate', error: new Error('lost') } }),
    );
    await expect(job.handle({ paymentId: PAYMENT })).rejects.toThrow('lost');
    expect(recorded().sent).toEqual([]);
  });
});

describe('confirm-enrollment: the per-order marker (006:T006; R-502, V-3)', () => {
  const assessment = { snapshotSessionCount: 1, snapshotDurationMinutes: 30 };

  it('does nothing on a replay of an order the step already processed', async () => {
    const replay = paid({ kind: 'assessment', enrollment: assessment, confirmedAt: PAID_AT });
    expect((await run(replay)).calls).toEqual(PREAMBLE);
  });

  it('writes no marker on a package’s order, which keeps the enrollment’s own', async () => {
    expect((await run(paid())).calls).not.toContain('mark confirmed');
  });

  it('confirms an expected assessment over an open case that would cover a package’s order', async () => {
    const recorded = await run(
      paid({
        kind: 'assessment',
        enrollment: assessment,
        cases: { open: true, lastOpenedAt: new Date('2026-11-03T07:00:00Z'), lastClosedAt: null },
      }),
    );
    expect(recorded.calls).toContain('programme awaiting_offer');
    expect(recorded.calls).not.toContain('case duplicate_payment');
  });
});

describe('confirm-enrollment: a month paid, the path with no hold (006:T006; FR-718, R-502, R-507)', () => {
  /** An offer of 10 sessions after the assessment: N + 1 = 11, three months (4, 4, 2). */
  const offered = (state: 'offered' | 'active' | 'paused' = 'active') => ({
    status: 'confirmed' as const,
    activeHoldId: null,
    confirmed: true,
    confirmingPaymentId: OTHER_PAYMENT,
    snapshotSessionCount: 11,
    snapshotDurationMinutes: 60,
    programmeState: state,
    // 006:T009: the offer's 48 hours end on Wednesday 2026-11-04 at 10:00Z.
    programmePayByAt: PAY_BY,
  });
  /** Month 1's four sessions after the assessment, the last ending 2026-12-03 08:00Z. */
  const monthOne = [
    { sequenceNumber: 1, endsAt: new Date('2026-11-01T08:00:00Z') },
    { sequenceNumber: 2, endsAt: new Date('2026-11-02T08:00:00Z') },
    { sequenceNumber: 3, endsAt: new Date('2026-11-03T08:00:00Z') },
    { sequenceNumber: 4, endsAt: new Date('2026-11-04T08:00:00Z') },
    { sequenceNumber: 5, endsAt: new Date('2026-12-03T08:00:00Z') },
  ];

  it('generates month 2’s four sessions from the last number + 1, after month 1’s last session, with its month', async () => {
    const recorded = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 2,
        enrollment: offered(),
        processed: [{ kind: 'instalment', instalmentMonth: 1 }],
        sessions: monthOne,
      }),
    );
    expect(recorded.calls).toEqual([
      ...PREAMBLE,
      'generate 4 from 6 months 2,2,2,2 after 2026-12-03T08:00:00.000Z lead 0',
      'mark confirmed',
    ]);
  });

  it('generates month m+1 while month m’s duplicate_payment case is open: the case gates are skipped', async () => {
    const recorded = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 2,
        enrollment: offered(),
        processed: [{ kind: 'instalment', instalmentMonth: 1 }],
        sessions: monthOne,
        cases: { open: true, lastOpenedAt: new Date('2026-11-03T07:00:00Z'), lastClosedAt: null },
      }),
    );
    expect(recorded.calls).toContain(
      'generate 4 from 6 months 2,2,2,2 after 2026-12-03T08:00:00.000Z lead 0',
    );
    expect(recorded.calls).not.toContain('case duplicate_payment');
  });

  it('generates the last month’s remainder: month 3 of 4, 4 and 2 sessions', async () => {
    const recorded = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 3,
        enrollment: offered('paused'),
        processed: [
          { kind: 'instalment', instalmentMonth: 1 },
          { kind: 'instalment', instalmentMonth: 2 },
        ],
        sessions: [{ sequenceNumber: 9, endsAt: new Date('2026-10-01T08:00:00Z') }],
      }),
    );
    expect(recorded.calls).toContain(
      'generate 2 from 10 months 3,3 after 2026-11-03T08:00:00.000Z lead 24',
    );
  });

  // 006:T009 (the conflict check's settled reading): the first payment's sessions start at the first
  // weekly occurrence after pay_by_at, with no lead, so none falls inside the 48 hours.
  it('generates the rest in full, every session from 2 with its month, from after pay_by_at with no lead', async () => {
    const recorded = await run(
      paid({
        kind: 'rest_in_full',
        enrollment: offered('offered'),
        sessions: [{ sequenceNumber: 1, endsAt: new Date('2026-10-29T08:00:00Z') }],
      }),
    );
    expect(recorded.calls).toEqual([
      ...PREAMBLE,
      'generate 10 from 2 months 1,1,1,1,2,2,2,2,3,3 after 2026-11-04T10:00:00.000Z lead 0',
      'mark confirmed',
    ]);
  });

  it('generates month 1’s four sessions from 2, from after pay_by_at with no lead (006:T009)', async () => {
    const recorded = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 1,
        enrollment: offered('offered'),
        sessions: [{ sequenceNumber: 1, endsAt: new Date('2026-10-29T08:00:00Z') }],
      }),
    );
    expect(recorded.calls).toEqual([
      ...PREAMBLE,
      'generate 4 from 2 months 1,1,1,1 after 2026-11-04T10:00:00.000Z lead 0',
      'mark confirmed',
    ]);
  });

  it('generates month 1 after the assessment’s make-up when it ends after pay_by_at (006:T009)', async () => {
    const recorded = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 1,
        enrollment: offered('offered'),
        sessions: [
          { sequenceNumber: 1, endsAt: new Date('2026-10-29T08:00:00Z') },
          { sequenceNumber: 2, endsAt: new Date('2026-11-05T08:00:00Z') },
        ],
      }),
    );
    expect(recorded.calls).toContain(
      'generate 4 from 3 months 1,1,1,1 after 2026-11-05T08:00:00.000Z lead 0',
    );
  });

  // 006:T015 (PR #158 r1 Follow-up 3, settled by its text): a first payment confirmed after
  // `pay_by_at` (paid in time, processed late) starts after the confirm instant, with no lead, so no
  // session is written already begun.
  it('generates month 1 after the confirm instant when it is processed after pay_by_at (006:T015, FU3)', async () => {
    const recorded = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 1,
        enrollment: { ...offered('offered'), programmePayByAt: new Date('2026-11-01T10:00:00Z') },
        sessions: [{ sequenceNumber: 1, endsAt: new Date('2026-10-29T08:00:00Z') }],
      }),
    );
    expect(recorded.calls.filter((call) => call.startsWith('generate'))).toEqual([
      'generate 4 from 2 months 1,1,1,1 after 2026-11-03T08:00:00.000Z lead 0',
    ]);
  });

  it('generates the rest in full after the confirm instant when it is processed after pay_by_at (006:T015, FU3)', async () => {
    const recorded = await run(
      paid({
        kind: 'rest_in_full',
        enrollment: { ...offered('offered'), programmePayByAt: new Date('2026-11-01T10:00:00Z') },
        sessions: [{ sequenceNumber: 1, endsAt: new Date('2026-10-29T08:00:00Z') }],
      }),
    );
    expect(recorded.calls.filter((call) => call.startsWith('generate'))).toEqual([
      'generate 10 from 2 months 1,1,1,1,2,2,2,2,3,3 after 2026-11-03T08:00:00.000Z lead 0',
    ]);
  });

  it('treats a second paid order for a paid month as duplicate_payment, generating nothing', async () => {
    const recorded = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 1,
        enrollment: offered(),
        processed: [{ kind: 'instalment', instalmentMonth: 1 }],
        sessions: monthOne,
      }),
    );
    expect(recorded.calls).toEqual([...PREAMBLE, 'case duplicate_payment', 'mark confirmed']);
  });

  it('treats a month after the rest was paid in full, and the rest twice, as duplicate_payment', async () => {
    for (const [kind, instalmentMonth] of [
      ['instalment', 2],
      ['rest_in_full', undefined],
    ] as const) {
      const recorded = await run(
        paid({
          kind,
          ...(instalmentMonth === undefined ? {} : { instalmentMonth }),
          enrollment: offered(),
          processed: [{ kind: 'rest_in_full', instalmentMonth: null }],
        }),
      );
      expect(recorded.calls).toEqual([...PREAMBLE, 'case duplicate_payment', 'mark confirmed']);
    }
  });

  // PR #156 r1 Major 1: the awaited month comes from the months processed, not their count, so a
  // duplicate already processed never moves the next month (PROBE-P1).
  it('generates month 2 after month 1 was processed twice (the second a duplicate)', async () => {
    const recorded = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 2,
        enrollment: offered(),
        processed: [
          { kind: 'instalment', instalmentMonth: 1 },
          { kind: 'instalment', instalmentMonth: 1 },
        ],
        sessions: monthOne,
      }),
    );
    expect(recorded.calls).toEqual([
      ...PREAMBLE,
      'generate 4 from 6 months 2,2,2,2 after 2026-12-03T08:00:00.000Z lead 0',
      'mark confirmed',
    ]);
  });

  it('generates month 3 after month 1 twice, then month 2 twice; a third month 2 is a duplicate', async () => {
    const processed = [
      { kind: 'instalment', instalmentMonth: 1 },
      { kind: 'instalment', instalmentMonth: 1 },
      { kind: 'instalment', instalmentMonth: 2 },
      { kind: 'instalment', instalmentMonth: 2 },
    ] as const;
    const sessions = [{ sequenceNumber: 9, endsAt: new Date('2026-10-01T08:00:00Z') }];
    const third = await run(
      paid({ kind: 'instalment', instalmentMonth: 3, enrollment: offered(), processed, sessions }),
    );
    expect(third.calls).toContain(
      'generate 2 from 10 months 3,3 after 2026-11-03T08:00:00.000Z lead 24',
    );
    const again = await run(
      paid({ kind: 'instalment', instalmentMonth: 2, enrollment: offered(), processed, sessions }),
    );
    expect(again.calls).toEqual([...PREAMBLE, 'case duplicate_payment', 'mark confirmed']);
  });

  it('generates month 2 after month 1 and a rest_in_full that was itself a duplicate', async () => {
    const recorded = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 2,
        enrollment: offered(),
        processed: [
          { kind: 'instalment', instalmentMonth: 1 },
          { kind: 'rest_in_full', instalmentMonth: null },
        ],
        sessions: monthOne,
      }),
    );
    expect(recorded.calls).toContain(
      'generate 4 from 6 months 2,2,2,2 after 2026-12-03T08:00:00.000Z lead 0',
    );
  });

  it('treats a rest_in_full after month 1 as duplicate_payment', async () => {
    const recorded = await run(
      paid({
        kind: 'rest_in_full',
        enrollment: offered(),
        processed: [{ kind: 'instalment', instalmentMonth: 1 }],
        sessions: monthOne,
      }),
    );
    expect(recorded.calls).toEqual([...PREAMBLE, 'case duplicate_payment', 'mark confirmed']);
  });

  it('treats a month order on a programme not awaiting a payment as duplicate_payment', async () => {
    for (const programmeState of ['awaiting_offer', 'closed', null] as const) {
      const recorded = await run(
        paid({
          kind: 'instalment',
          instalmentMonth: 1,
          enrollment: { ...offered(), programmeState },
        }),
      );
      expect(recorded.calls).toEqual([...PREAMBLE, 'case duplicate_payment', 'mark confirmed']);
    }
  });

  it('opens a case instead of generating while a suspension case is open, one log line', async () => {
    for (const suspension of ['teacher_suspended', 'student_suspended'] as const) {
      const { job, recorded, logged } = harness(
        paid({
          kind: 'instalment',
          instalmentMonth: 1,
          enrollment: offered('offered'),
          suspension,
        }),
      );
      await job.handle({ paymentId: PAYMENT });
      expect(recorded().calls).toEqual([...PREAMBLE, 'case party_restricted', 'mark confirmed']);
      expect(logged).toEqual([
        [
          { enrollmentId: ENROLLMENT, paymentId: PAYMENT, reason: 'party_suspended' },
          'A paid programme order was not generated',
        ],
      ]);
    }
  });

  it('never cancels a programme on a refused generation: the order stays paid, a case, one log line', async () => {
    const { job, recorded, logged } = harness(
      paid({
        kind: 'instalment',
        instalmentMonth: 1,
        enrollment: offered('offered'),
        failAt: { step: 'generate', error: refusedBy('23P01', 'sessions_student_no_overlap') },
      }),
    );
    await job.handle({ paymentId: PAYMENT });
    expect(recorded().calls).toEqual([
      // The first attempt's generation is refused by the database (the stand-in throws before it
      // records), the second transaction settles it.
      ...PREAMBLE,
      ...PREAMBLE,
      'case slot_unavailable',
      'mark confirmed',
    ]);
    expect(recorded().calls.some((call) => call.startsWith('refuse'))).toBe(false);
    expect(logged).toEqual([
      [
        { enrollmentId: ENROLLMENT, paymentId: PAYMENT, reason: 'generation_refused' },
        'A paid programme order was not generated',
      ],
    ]);
  });

  it('does nothing on a replay of a month already processed', async () => {
    const recorded = await run(
      paid({ kind: 'instalment', instalmentMonth: 1, enrollment: offered(), confirmedAt: PAID_AT }),
    );
    expect(recorded.calls).toEqual(PREAMBLE);
  });
});

// 006:T009 (the owner's Q-C1 (a), 2026-11-23): the confirm step writes the programme's payment.
describe('confirm-enrollment: the programme’s payment written (006:T009, Q-C1 (a))', () => {
  const offeredTen = (state: 'offered' | 'active' | 'paused' = 'offered') => ({
    status: 'confirmed' as const,
    activeHoldId: null,
    confirmed: true,
    confirmingPaymentId: OTHER_PAYMENT,
    snapshotSessionCount: 11,
    snapshotDurationMinutes: 60,
    programmeState: state,
    programmePayByAt: PAY_BY,
  });
  const assessmentOnly = [{ sequenceNumber: 1, endsAt: new Date('2026-10-29T08:00:00Z') }];

  it('writes the rest in full as months_paid = month_count (3 of 4, 4, 2), the plan in_full', async () => {
    const recorded = await run(
      paid({ kind: 'rest_in_full', enrollment: offeredTen(), sessions: assessmentOnly }),
    );
    expect(recorded.programmePaid).toEqual(['in_full 3']);
  });

  it('writes month 1 as months_paid 1, the plan monthly; month 2 as 2', async () => {
    const first = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 1,
        enrollment: offeredTen(),
        sessions: assessmentOnly,
      }),
    );
    expect(first.programmePaid).toEqual(['monthly 1']);
    const second = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 2,
        enrollment: offeredTen('active'),
        processed: [{ kind: 'instalment', instalmentMonth: 1 }],
        sessions: assessmentOnly,
      }),
    );
    expect(second.programmePaid).toEqual(['monthly 2']);
  });

  it('writes the payment of a month paid during a suspension, whose sessions wait for its case', async () => {
    const recorded = await run(
      paid({
        kind: 'instalment',
        instalmentMonth: 1,
        enrollment: offeredTen(),
        suspension: 'teacher_suspended',
      }),
    );
    expect(recorded.programmePaid).toEqual(['monthly 1']);
  });

  // 006:T016 (FR-724, B-P3’s conflict check): booking's entry resumes a paused programme and
  // withdraws an open stop with one line, written through the job's own log.
  it('red first: hands booking’s entry the job’s log for the resume’s and the withdrawal’s lines (006:T016)', async () => {
    const { job, recorded, logged } = harness(
      paid({
        kind: 'instalment',
        instalmentMonth: 2,
        enrollment: offeredTen('paused'),
        processed: [{ kind: 'instalment', instalmentMonth: 1 }],
        sessions: assessmentOnly,
      }),
    );
    await job.handle({ paymentId: PAYMENT });
    const [log] = recorded().paidLogs as [{ info?: (fields: object, message: string) => void }?];
    expect(log?.info).toBeTypeOf('function');
    log?.info?.({ probe: true }, 'probe');
    expect(logged).toContainEqual([{ probe: true }, 'probe']);
  });

  it('never takes a second first payment as a fresh one: no payment written, a duplicate_payment case', async () => {
    for (const [kind, instalmentMonth] of [
      ['rest_in_full', undefined],
      ['instalment', 1],
    ] as const) {
      const recorded = await run(
        paid({
          kind,
          ...(instalmentMonth === undefined ? {} : { instalmentMonth }),
          enrollment: offeredTen('active'),
          processed: [{ kind: 'instalment', instalmentMonth: 1 }],
          sessions: assessmentOnly,
        }),
      );
      expect(recorded.programmePaid).toEqual([]);
      expect(recorded.calls).toContain('case duplicate_payment');
    }
  });
});
