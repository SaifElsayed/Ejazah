// T039 — the `confirm-enrollment` job over the real tables, with the steps `worker.ts` binds: the
// payments, booking, identity, catalog, sessions and moderation entries (R-215, FR-361, FR-362,
// FR-375, FR-PAYG-19, SC-305; ARCHITECTURE §8.1).
//
//   - with the hold active: one transaction converts it, confirms the enrollment (`confirmed_at`,
//     the reason NULL), writes its four sessions and one `confirmed` row naming the order;
//   - a late payment: the slot's expired holds released with FR-363's cancellations, a new hold for
//     the enrollment converted, the enrollment confirmed from `cancelled`;
//   - refused by the database (another student's hold on the slot; a session overlapping the
//     student's own): nothing of it kept, then the refusal, `slot_unavailable`, one case;
//   - the parties checked before a late branch: the teacher suspended or failing the predicate, the
//     student not active, each ending cancelled with one `party_restricted` case; an enrollment
//     R-219 cancelled keeps its reason and gets one `party_restricted` case;
//   - a second and a third paid order on one confirmed enrollment: one open `duplicate_payment`
//     case, the enrollment as it was; a replay of the confirming order: no case; after the case is
//     resolved, a replay of the second order opens none (the note under T035) and a fourth opens one;
//   - the cases that cover an order (T082): one paid while a case is open, or before a case was
//     resolved or dismissed, does nothing; one paid after every case was closed opens one
//     `duplicate_payment` case, a second run none; two cases, one open and one closed;
//   - a refunded order is ignored; two runs leave what one leaves.
//   - T004 of specs/004-sessions (the owner's decision of 2026-11-06 on PR #126's review, follow-up
//     1): a `teacher_ended` case open on a confirmed enrollment covers nothing, so a second paid
//     order opens its `duplicate_payment` case (FR-493), the covering rule reading Phase 2's
//     three reasons only.
//
// The job runs its own transactions, the refusal a second one, so every world is committed, each
// with accounts, a slot and orders of its own (`confirmation-world.ts`).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONFIRM_ENROLLMENT, confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { runOnceAndTwice } from '../../apps/api/src/jobs/double-run';
import { openCompensationCase } from '../../apps/api/src/modules/moderation/index';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import {
  CAIRO,
  confirmationWorld,
  EARLIER,
  FOUR_THURSDAYS,
  LATER,
  NOW,
  settings,
  THURSDAY_0900,
  type WorldOptions,
} from './confirmation-world';
import { connectAsApplication, type Db, makeAdmin } from './harness';

let db: Db;
let database: Database;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db?.end();
  await closeDatabase(database);
});

const { person, world, order, enrollmentOf, holdsOf, sessionsOf, eventsOf, casesOf } =
  confirmationWorld(() => database);

const job = () => confirmEnrollment({ database, settings, clock: () => NOW });
const confirm = (paymentId: string) => job().handle({ paymentId });

async function resolve(caseId: string): Promise<void> {
  await close(caseId, 'resolved');
}

/**
 * Closes the case as an administrator's decision would (Phase 3 writes `resolved_at` with the
 * status, the note under T082). `earlier` moves its opening and its closing a few minutes back, so
 * an order paid after it is later by more than the millisecond the rule compares at.
 */
async function close(
  caseId: string,
  status: 'resolved' | 'dismissed',
  earlier = false,
): Promise<void> {
  const adminId = await makeAdmin(db);
  await db.query(
    `UPDATE disputes
        SET status = $2::dispute_status,
            resolution = CASE WHEN $2 = 'resolved' THEN 'compensation_ordered'::dispute_resolution END,
            resolution_notes = 'Probe decision', resolved_by_admin_id = $3,
            created_at = CASE WHEN $4 THEN now() - interval '3 minutes' ELSE created_at END,
            resolved_at = CASE WHEN $4 THEN now() - interval '2 minutes' ELSE now() END,
            updated_at = now()
      WHERE id = $1`,
    [caseId, status, adminId, earlier],
  );
}

/** One compensation case opened by moderation, committed. */
async function openCase(
  enrollmentId: string,
  reason: 'slot_unavailable' | 'party_restricted' | 'duplicate_payment',
): Promise<string> {
  const { caseId } = await database.$transaction((tx) =>
    openCompensationCase(tx, enrollmentId, reason),
  );
  return caseId;
}

describe('confirm-enrollment with the hold active (FR-361)', () => {
  it('converts the hold, confirms, writes the sessions and one confirmed row naming the order', async () => {
    const on = await world();
    const paid = await order(on.enrollmentId);
    await confirm(paid);
    expect(await enrollmentOf(on.enrollmentId)).toEqual({
      status: 'confirmed',
      cancellationReason: null,
      confirmedAt: NOW,
    });
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: NOW }]);
    expect(await sessionsOf(on.enrollmentId)).toEqual(FOUR_THURSDAYS);
    expect(await eventsOf(on.enrollmentId)).toEqual([
      { kind: 'confirmed', cancellationReason: null, paymentId: paid, occurredAt: NOW },
    ]);
    expect(await casesOf(on.enrollmentId)).toEqual([]);
  });

  it('converts a hold past its expiry that no sweep released yet (ADR 0010 D4)', async () => {
    const on = await world({ enrollment: { status: 'pending_payment', hold: 'expired' } });
    await confirm(await order(on.enrollmentId));
    expect((await enrollmentOf(on.enrollmentId)).status).toBe('confirmed');
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: NOW }]);
  });
});

describe('confirm-enrollment on a late payment (FR-362, FR-PAYG-19)', () => {
  it('releases the slot’s expired hold, re-holds, converts and confirms from cancelled', async () => {
    const on = await world({ enrollment: { status: 'cancelled', reason: 'payment_expired' } });
    // Another student's checkout on the slot, expired and not yet released, awaiting payment.
    const otherStudent = await person('female');
    const { id: otherEnrollment } = await database.enrollment.create({
      data: {
        studentUserId: otherStudent,
        teacherUserId: on.teacherId,
        packageId: on.packageId,
        slotId: on.slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: on.subjectId,
        snapshotSlotTimezone: CAIRO,
        status: 'pending_payment',
        purchasedAt: EARLIER,
        quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
      },
      select: { id: true },
    });
    const { id: otherHold } = await database.slotHold.create({
      data: {
        slotId: on.slotId,
        packageId: on.packageId,
        sessionCount: 4,
        studentUserId: otherStudent,
        enrollmentId: otherEnrollment,
        expiresAt: EARLIER,
      },
      select: { id: true },
    });
    const paid = await order(on.enrollmentId);
    await confirm(paid);
    expect(await enrollmentOf(on.enrollmentId)).toEqual({
      status: 'confirmed',
      cancellationReason: null,
      confirmedAt: NOW,
    });
    const holds = await holdsOf(on.enrollmentId);
    expect(holds).toHaveLength(2);
    expect(holds.every(({ releasedAt }) => releasedAt !== null)).toBe(true);
    expect(holds[1]?.releasedAt).toEqual(NOW);
    expect(await sessionsOf(on.enrollmentId)).toEqual(FOUR_THURSDAYS);
    expect(await eventsOf(on.enrollmentId)).toEqual([
      { kind: 'confirmed', cancellationReason: null, paymentId: paid, occurredAt: NOW },
    ]);
    expect(await enrollmentOf(otherEnrollment)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'payment_expired',
    });
    expect(await holdsOf(otherEnrollment)).toEqual([{ id: otherHold, releasedAt: NOW }]);
  });

  it('confirms an enrollment kept awaiting payment after its hold was released (FR-363)', async () => {
    const on = await world({ enrollment: { status: 'pending_payment', hold: 'released' } });
    await confirm(await order(on.enrollmentId));
    expect((await enrollmentOf(on.enrollmentId)).status).toBe('confirmed');
    expect(await sessionsOf(on.enrollmentId)).toEqual(FOUR_THURSDAYS);
  });

  it('refuses when another student holds the slot: slot_unavailable, one case, nothing kept', async () => {
    const on = await world({ enrollment: { status: 'cancelled', reason: 'payment_expired' } });
    const otherStudent = await person('female');
    const { id: otherHold } = await database.slotHold.create({
      data: {
        slotId: on.slotId,
        packageId: on.packageId,
        sessionCount: 4,
        studentUserId: otherStudent,
        expiresAt: LATER,
      },
      select: { id: true },
    });
    await confirm(await order(on.enrollmentId));
    expect(await enrollmentOf(on.enrollmentId)).toEqual({
      status: 'cancelled',
      cancellationReason: 'slot_unavailable',
      confirmedAt: null,
    });
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: EARLIER }]);
    expect(await sessionsOf(on.enrollmentId)).toEqual([]);
    expect(await eventsOf(on.enrollmentId)).toEqual([
      {
        kind: 'cancelled',
        cancellationReason: 'slot_unavailable',
        paymentId: null,
        occurredAt: NOW,
      },
    ]);
    expect(await casesOf(on.enrollmentId)).toEqual([
      expect.objectContaining({
        kind: 'compensation_case',
        reason: 'slot_unavailable',
        status: 'open',
      }),
    ]);
    const other = await database.slotHold.findUniqueOrThrow({ where: { id: otherHold } });
    expect(other.releasedAt).toBeNull();
  });

  it('refuses when the student holds another slot, that checkout undisturbed', async () => {
    const on = await world({ enrollment: { status: 'cancelled', reason: 'payment_expired' } });
    const { id: elsewhere } = await database.availabilitySlot.create({
      data: {
        teacherUserId: on.teacherId,
        dayOfWeek: 6,
        startTimeLocal: THURSDAY_0900,
        durationMinutes: 60,
        timezone: CAIRO,
        isActive: true,
      },
      select: { id: true },
    });
    const { id: ownHold } = await database.slotHold.create({
      data: {
        slotId: elsewhere,
        packageId: on.packageId,
        sessionCount: 4,
        studentUserId: on.studentId,
        expiresAt: LATER,
      },
      select: { id: true },
    });
    await confirm(await order(on.enrollmentId));
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'slot_unavailable',
    });
    expect((await casesOf(on.enrollmentId)).map(({ reason }) => reason)).toEqual([
      'slot_unavailable',
    ]);
    const own = await database.slotHold.findUniqueOrThrow({ where: { id: ownHold } });
    expect(own.releasedAt).toBeNull();
  });

  it('refuses when a session would overlap the student’s own, releasing the active hold', async () => {
    const on = await world();
    // The student's confirmed session with another teacher at the enrollment's second Thursday.
    const other = await world();
    const { id: otherEnrollment } = await database.enrollment.create({
      data: {
        studentUserId: on.studentId,
        teacherUserId: other.teacherId,
        packageId: other.packageId,
        slotId: other.slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: other.subjectId,
        snapshotSlotTimezone: CAIRO,
        status: 'confirmed',
        confirmedAt: EARLIER,
        purchasedAt: EARLIER,
        quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
      },
      select: { id: true },
    });
    await database.session.create({
      data: {
        enrollmentId: otherEnrollment,
        teacherUserId: other.teacherId,
        studentUserId: on.studentId,
        sequenceNumber: 1,
        scheduledDateLocal: new Date('2026-11-12T00:00:00Z'),
        scheduledStartTimeLocal: THURSDAY_0900,
        timezone: CAIRO,
        scheduledStartAt: new Date('2026-11-12T07:00:00Z'),
        scheduledEndAt: new Date('2026-11-12T08:00:00Z'),
        status: 'scheduled',
      },
    });
    await confirm(await order(on.enrollmentId));
    expect(await enrollmentOf(on.enrollmentId)).toEqual({
      status: 'cancelled',
      cancellationReason: 'slot_unavailable',
      confirmedAt: null,
    });
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: NOW }]);
    expect(await sessionsOf(on.enrollmentId)).toEqual([]);
    expect(await eventsOf(on.enrollmentId)).toEqual([
      {
        kind: 'cancelled',
        cancellationReason: 'slot_unavailable',
        paymentId: null,
        occurredAt: NOW,
      },
    ]);
    expect((await casesOf(on.enrollmentId)).map(({ reason }) => reason)).toEqual([
      'slot_unavailable',
    ]);
  });
});

describe('confirm-enrollment checks the parties before a late branch (FR-362)', () => {
  const late = { status: 'cancelled', reason: 'payment_expired' } as const;

  it.each<[string, WorldOptions]>([
    ['the teacher suspended', { teacher: 'suspended', enrollment: late }],
    [
      'the teacher failing the predicate (payout unverified)',
      { payoutVerified: false, enrollment: late },
    ],
    ['the student not active', { student: 'suspended', enrollment: late }],
  ])('with %s ends cancelled with one party_restricted case', async (_name, options) => {
    const on = await world(options);
    const paid = await order(on.enrollmentId);
    await confirm(paid);
    expect(await enrollmentOf(on.enrollmentId)).toEqual({
      status: 'cancelled',
      cancellationReason: 'payment_expired',
      confirmedAt: null,
    });
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: EARLIER }]);
    expect(await sessionsOf(on.enrollmentId)).toEqual([]);
    expect(await casesOf(on.enrollmentId)).toEqual([
      expect.objectContaining({
        kind: 'compensation_case',
        reason: 'party_restricted',
        status: 'open',
      }),
    ]);
    // A replay changes nothing more.
    await confirm(paid);
    expect(await casesOf(on.enrollmentId)).toHaveLength(1);
    expect(await eventsOf(on.enrollmentId)).toHaveLength(1);
  });

  it('cancels with slot_unavailable an enrollment kept awaiting payment whose teacher may not book', async () => {
    const on = await world({
      teacher: 'suspended',
      enrollment: { status: 'pending_payment', hold: 'released' },
    });
    await confirm(await order(on.enrollmentId));
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'slot_unavailable',
    });
    expect((await casesOf(on.enrollmentId)).map(({ reason }) => reason)).toEqual([
      'party_restricted',
    ]);
  });

  it('keeps an enrollment R-219 cancelled with its reason and opens one party_restricted case', async () => {
    const on = await world({ enrollment: { status: 'cancelled', reason: 'teacher_suspended' } });
    await confirm(await order(on.enrollmentId));
    expect(await enrollmentOf(on.enrollmentId)).toEqual({
      status: 'cancelled',
      cancellationReason: 'teacher_suspended',
      confirmedAt: null,
    });
    expect(await holdsOf(on.enrollmentId)).toHaveLength(1);
    expect(await sessionsOf(on.enrollmentId)).toEqual([]);
    expect(await eventsOf(on.enrollmentId)).toEqual([
      {
        kind: 'cancelled',
        cancellationReason: 'teacher_suspended',
        paymentId: null,
        occurredAt: NOW,
      },
    ]);
    expect((await casesOf(on.enrollmentId)).map(({ reason }) => reason)).toEqual([
      'party_restricted',
    ]);
  });
});

describe('confirm-enrollment on a confirmed enrollment (FR-375)', () => {
  it('opens one duplicate_payment case for a second and a third paid order, changing nothing else', async () => {
    const on = await world();
    const first = await order(on.enrollmentId);
    await confirm(first);
    const second = await order(on.enrollmentId);
    const third = await order(on.enrollmentId);
    await confirm(second);
    await confirm(third);
    expect(await enrollmentOf(on.enrollmentId)).toEqual({
      status: 'confirmed',
      cancellationReason: null,
      confirmedAt: NOW,
    });
    expect(await sessionsOf(on.enrollmentId)).toEqual(FOUR_THURSDAYS);
    expect(await eventsOf(on.enrollmentId)).toEqual([
      { kind: 'confirmed', cancellationReason: null, paymentId: first, occurredAt: NOW },
    ]);
    expect(await casesOf(on.enrollmentId)).toEqual([
      expect.objectContaining({
        kind: 'compensation_case',
        reason: 'duplicate_payment',
        status: 'open',
      }),
    ]);
  });

  it('with a teacher_ended case open, a second paid order opens its duplicate_payment case (T004)', async () => {
    const on = await world();
    await confirm(await order(on.enrollmentId));
    await database.$transaction((tx) => openCompensationCase(tx, on.enrollmentId, 'teacher_ended'));
    await confirm(await order(on.enrollmentId));
    expect((await casesOf(on.enrollmentId)).map(({ reason, status }) => [reason, status])).toEqual([
      ['teacher_ended', 'open'],
      ['duplicate_payment', 'open'],
    ]);
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({ status: 'confirmed' });
  });

  it('opens no case on a replay of the confirming order', async () => {
    const on = await world();
    const first = await order(on.enrollmentId);
    await confirm(first);
    await confirm(first);
    expect(await casesOf(on.enrollmentId)).toEqual([]);
    expect(await eventsOf(on.enrollmentId)).toHaveLength(1);
    expect(await sessionsOf(on.enrollmentId)).toEqual(FOUR_THURSDAYS);
  });

  it('after the case is resolved: a replay of the covered order opens none, a new paid order opens one', async () => {
    const on = await world();
    await confirm(await order(on.enrollmentId));
    const second = await order(on.enrollmentId);
    await confirm(second);
    const [opened] = await casesOf(on.enrollmentId);
    if (opened === undefined) throw new Error('no case was opened');
    await resolve(opened.id);
    await confirm(second);
    expect((await casesOf(on.enrollmentId)).map(({ status }) => status)).toEqual(['resolved']);
    await confirm(await order(on.enrollmentId));
    expect((await casesOf(on.enrollmentId)).map(({ reason, status }) => [reason, status])).toEqual([
      ['duplicate_payment', 'resolved'],
      ['duplicate_payment', 'open'],
    ]);
  });
});

describe('confirm-enrollment ignores (the note under T035)', () => {
  it('a refunded order', async () => {
    const on = await world();
    await confirm(await order(on.enrollmentId, 'refunded'));
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({ status: 'pending_payment' });
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: null }]);
    expect(await eventsOf(on.enrollmentId)).toEqual([]);
  });

  it('an order not paid', async () => {
    const on = await world();
    await confirm(await order(on.enrollmentId, 'created'));
    expect(await enrollmentOf(on.enrollmentId)).toMatchObject({ status: 'pending_payment' });
    expect(await sessionsOf(on.enrollmentId)).toEqual([]);
  });
});

describe('confirm-enrollment and the cases that cover an order (T082, FR-362, FR-PAYG-19)', () => {
  const cancelled = { enrollment: { status: 'cancelled', reason: 'payment_expired' } } as const;
  const asItWas = { status: 'cancelled', cancellationReason: 'payment_expired', confirmedAt: null };
  const casesNow = async (enrollmentId: string) =>
    (await casesOf(enrollmentId)).map(({ reason, status }) => [reason, status]);

  it('an order paid while a case is open: covered, no new case, nothing changed', async () => {
    const on = await world(cancelled);
    await openCase(on.enrollmentId, 'slot_unavailable');
    await confirm(await order(on.enrollmentId));
    expect(await enrollmentOf(on.enrollmentId)).toEqual(asItWas);
    expect(await casesNow(on.enrollmentId)).toEqual([['slot_unavailable', 'open']]);
    expect(await eventsOf(on.enrollmentId)).toEqual([]);
    expect(await sessionsOf(on.enrollmentId)).toEqual([]);
  });

  it.each(['resolved', 'dismissed'] as const)(
    'an order paid before a case was %s stays covered after it',
    async (status) => {
      const on = await world(cancelled);
      const caseId = await openCase(on.enrollmentId, 'slot_unavailable');
      const paid = await order(on.enrollmentId);
      await close(caseId, status);
      await confirm(paid);
      expect(await enrollmentOf(on.enrollmentId)).toEqual(asItWas);
      expect(await casesNow(on.enrollmentId)).toEqual([['slot_unavailable', status]]);
      expect(await eventsOf(on.enrollmentId)).toEqual([]);
    },
  );

  it('an order paid after every case was closed opens one duplicate_payment case; a second run opens none', async () => {
    const on = await world(cancelled);
    await close(await openCase(on.enrollmentId, 'party_restricted'), 'resolved', true);
    const paid = await order(on.enrollmentId);
    await confirm(paid);
    await confirm(paid);
    expect(await enrollmentOf(on.enrollmentId)).toEqual(asItWas);
    expect(await casesNow(on.enrollmentId)).toEqual([
      ['party_restricted', 'resolved'],
      ['duplicate_payment', 'open'],
    ]);
    expect(await eventsOf(on.enrollmentId)).toEqual([]);
    expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: EARLIER }]);
  });

  it('an enrollment with two cases, one open and one closed: an order paid after the closing is covered', async () => {
    const on = await world(cancelled);
    await close(await openCase(on.enrollmentId, 'slot_unavailable'), 'dismissed', true);
    await openCase(on.enrollmentId, 'party_restricted');
    await confirm(await order(on.enrollmentId));
    expect(await enrollmentOf(on.enrollmentId)).toEqual(asItWas);
    expect(await casesNow(on.enrollmentId)).toEqual([
      ['slot_unavailable', 'dismissed'],
      ['party_restricted', 'open'],
    ]);
  });

  it('a covered order still does nothing: paid before its case was opened', async () => {
    const on = await world(cancelled);
    const paid = await order(on.enrollmentId);
    await openCase(on.enrollmentId, 'slot_unavailable');
    await confirm(paid);
    expect(await enrollmentOf(on.enrollmentId)).toEqual(asItWas);
    expect(await casesNow(on.enrollmentId)).toEqual([['slot_unavailable', 'open']]);
    expect(await eventsOf(on.enrollmentId)).toEqual([]);
  });
});

describe('confirm-enrollment is idempotent (R-API-14, R-215)', () => {
  it(`runs ${CONFIRM_ENROLLMENT} twice as once: one confirmation, one set of sessions, one event row`, async () => {
    const { once, twice } = await runOnceAndTwice({
      world: async () => {
        const on = await world();
        return { on, paid: await order(on.enrollmentId) };
      },
      run: ({ paid }) => confirm(paid),
      observe: async ({ on }) => ({
        enrollment: await enrollmentOf(on.enrollmentId),
        holds: (await holdsOf(on.enrollmentId)).map(({ releasedAt }) => releasedAt),
        sessions: await sessionsOf(on.enrollmentId),
        events: (await eventsOf(on.enrollmentId)).map(({ kind }) => kind),
        cases: (await casesOf(on.enrollmentId)).length,
      }),
    });
    expect(once).toMatchObject({ enrollment: { status: 'confirmed' }, events: ['confirmed'] });
    expect(twice).toEqual(once);
  });

  it('runs the refusal twice as once: one case, one cancelled row', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: async () => {
        const on = await world({ enrollment: { status: 'cancelled', reason: 'payment_expired' } });
        await database.slotHold.create({
          data: {
            slotId: on.slotId,
            packageId: on.packageId,
            sessionCount: 4,
            studentUserId: await person('female'),
            expiresAt: LATER,
          },
        });
        return { on, paid: await order(on.enrollmentId) };
      },
      run: ({ paid }) => confirm(paid),
      observe: async ({ on }) => ({
        enrollment: await enrollmentOf(on.enrollmentId),
        events: (await eventsOf(on.enrollmentId)).map(({ kind, cancellationReason }) => [
          kind,
          cancellationReason,
        ]),
        cases: (await casesOf(on.enrollmentId)).map(({ reason }) => reason),
      }),
    });
    expect(once).toMatchObject({ cases: ['slot_unavailable'] });
    expect(twice).toEqual(once);
  });
});

// T064 of specs/004-sessions (FR-493; research R-326; the note under T064 on the covering rule's
// tests, after the note under T004, PR #127's review, round 1, Minor 1): a manual case on an
// enrollment awaiting payment, open or closed, does not change the late-payment rule, since Phase
// 2's covering rule reads none of the manual reasons.
describe('a manual case does not change the late-payment rule (T064, R-326)', () => {
  const MANUAL = ['admin_opened_for_student', 'admin_opened_for_teacher'] as const;
  const cases = MANUAL.flatMap((reason) =>
    (['open', 'closed'] as const).map((state) => [reason, state] as const),
  );

  /** The manual case opened by moderation, committed, and closed a few minutes back when asked. */
  async function manualCase(
    enrollmentId: string,
    reason: (typeof MANUAL)[number],
    state: 'open' | 'closed',
  ): Promise<void> {
    const { caseId } = await database.$transaction((tx) =>
      openCompensationCase(tx, enrollmentId, reason),
    );
    if (state === 'closed') await close(caseId, 'dismissed', true);
  }

  it.each(cases)(
    'with a %s case %s, the paid order is confirmed with its hold active, no duplicate_payment case',
    async (reason, state) => {
      const on = await world();
      await manualCase(on.enrollmentId, reason, state);
      const paid = await order(on.enrollmentId);
      await confirm(paid);
      expect(await enrollmentOf(on.enrollmentId)).toEqual({
        status: 'confirmed',
        cancellationReason: null,
        confirmedAt: NOW,
      });
      expect(await holdsOf(on.enrollmentId)).toEqual([{ id: on.holdId, releasedAt: NOW }]);
      expect(await sessionsOf(on.enrollmentId)).toEqual(FOUR_THURSDAYS);
      expect((await casesOf(on.enrollmentId)).map(({ reason: of }) => of)).toEqual([reason]);
    },
  );

  it.each(cases)(
    'with a %s case %s, a late paid order takes the late branch and is confirmed, no duplicate_payment case',
    async (reason, state) => {
      const on = await world({ enrollment: { status: 'cancelled', reason: 'payment_expired' } });
      await manualCase(on.enrollmentId, reason, state);
      const paid = await order(on.enrollmentId);
      await confirm(paid);
      expect(await enrollmentOf(on.enrollmentId)).toEqual({
        status: 'confirmed',
        cancellationReason: null,
        confirmedAt: NOW,
      });
      expect(await holdsOf(on.enrollmentId)).toHaveLength(2);
      expect(await eventsOf(on.enrollmentId)).toEqual([
        { kind: 'confirmed', cancellationReason: null, paymentId: paid, occurredAt: NOW },
      ]);
      expect((await casesOf(on.enrollmentId)).map(({ reason: of }) => of)).toEqual([reason]);
    },
  );
});
