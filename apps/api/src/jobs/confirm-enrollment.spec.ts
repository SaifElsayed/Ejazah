// T039 (R-215, FR-361, FR-362, FR-375, FR-PAYG-19; ARCHITECTURE §8.1): the `confirm-enrollment`
// job's decisions, over recorded steps. Which branch a paid order takes, in R-215's order: an order
// that is not `paid` (a `refunded` one) or that a compensation case already covers is ignored (the
// note under T035); an enrollment whose `confirmed` event names another order gets one
// `duplicate_payment` case and nothing else (FR-375), while a replay of the confirming order does
// nothing; an enrollment with a case does nothing (FR-PAYG-19); one R-219 cancelled takes the
// refusal at once (`party_restricted`); an active hold is converted and the enrollment confirmed
// with its sessions, no party checked; a late one checks the parties (`party_restricted` when they
// may not book), then re-holds and confirms; the database's four named refusals are refused in a
// new transaction (`slot_unavailable`), anything else rethrown. The same steps over the real tables
// are `tests/db-integrity/confirm-enrollment.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { LockedEnrollment } from '../modules/booking/index.js';
import type { Transaction } from '../platform/db/prisma.repository.js';
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
  latestCase: Date | null;
  enrollment: Partial<LockedEnrollment>;
  bookable: boolean;
  /** No order has the payment's id. */
  orderMissing?: boolean;
  /** Thrown by the step named, once, in the first transaction. */
  failAt?: { step: 'rehold' | 'generate' | 'confirm'; error: Error };
}

interface Recorded {
  readonly calls: string[];
  readonly transactions: number;
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
    ...overrides,
  };
}

function harness(world: World) {
  const calls: string[] = [];
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
    latestCaseOpenedAt: async () => world.latestCase,
    openCase: async (_tx, enrollmentId, reason) => {
      calls.push(`case ${reason}`);
      expect(enrollmentId).toBe(ENROLLMENT);
    },
    confirm: async (_tx, { enrollmentId, paymentId, at }) => {
      failing('confirm');
      expect([enrollmentId, paymentId, at]).toEqual([ENROLLMENT, PAYMENT, NOW]);
      const converted = world.enrollment.activeHoldId !== null || calls.includes('rehold');
      calls.push(converted ? 'confirm' : 'confirm: no hold');
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
    },
    slotOf: async (_tx, slotId) => {
      expect(slotId).toBe(SLOT);
      return { dayOfWeek: 4, startTimeLocal: '09:00:00' };
    },
    generate: async (_tx, enrollment, confirmedAt, leadHours) => {
      failing('generate');
      expect(enrollment).toEqual({
        id: ENROLLMENT,
        teacherUserId: TEACHER,
        studentUserId: STUDENT,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSlotTimezone: 'Africa/Cairo',
        slot: { dayOfWeek: 4, startTimeLocal: '09:00:00' },
      });
      expect([confirmedAt, leadHours]).toEqual([NOW, 24]);
      calls.push('generate');
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
    steps,
    clock: () => NOW,
  });
  return {
    job,
    recorded: (): Recorded => ({ calls: [...calls], transactions }),
  };
}

const paid = (overrides: Partial<World> = {}): World => ({
  status: 'paid',
  paidRecordedAt: PAID_AT,
  latestCase: null,
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

describe('confirm-enrollment: a late payment (FR-362, FR-PAYG-19)', () => {
  const late = { activeHoldId: null, status: 'cancelled' as const };

  it('checks the parties, then re-holds, confirms and generates', async () => {
    expect((await run(paid({ enrollment: late }))).calls).toEqual([
      ...PREAMBLE,
      'confirm: no hold',
      'pair',
      'rehold',
      'confirm',
      'generate',
    ]);
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
    const resolvedEarlier = new Date('2026-11-03T07:00:00Z');
    const recorded = await run(
      paid({ enrollment: confirmedBy(OTHER_PAYMENT), latestCase: resolvedEarlier }),
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

describe('confirm-enrollment: what it ignores (FR-PAYG-19; the note under T035)', () => {
  it.each([
    ['a refunded order', paid({ status: 'refunded' })],
    ['an order not paid', paid({ status: 'created', paidRecordedAt: null })],
    [
      'an order a case opened after its paid event covers',
      paid({
        latestCase: new Date('2026-11-03T07:59:30Z'),
        enrollment: { status: 'confirmed', confirmed: true, confirmingPaymentId: OTHER_PAYMENT },
      }),
    ],
    [
      'an enrollment with a compensation case, the order paid after it',
      paid({ latestCase: new Date('2026-11-03T07:00:00Z'), enrollment: { status: 'cancelled' } }),
    ],
  ])('ignores %s', async (_name, world) => {
    expect((await run(world)).calls).toEqual(PREAMBLE);
  });

  it('counts a case opened in the same millisecond as the paid event as covering it', async () => {
    const recorded = await run(
      paid({
        latestCase: PAID_AT,
        enrollment: { status: 'confirmed', confirmed: true, confirmingPaymentId: OTHER_PAYMENT },
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
