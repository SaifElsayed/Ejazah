// T039: the worlds the `confirm-enrollment` specs build over the real tables, committed: the job
// runs its own transactions, the refusal a second one, so nothing can be rolled back around it.
// Each world has accounts, a slot and orders of its own (as `compensation-case.spec.ts`' rows are),
// written through the application role's client; a gateway order is written by SQL, its amount
// column being named only in payments (R-MONEY-6).
import { randomUUID } from 'node:crypto';

import type { Database } from '../../apps/api/src/platform/db/prisma.repository';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';

export const CAIRO = 'Africa/Cairo';
/** Tuesday 2026-11-03 10:00 in Cairo (+02:00). */
export const NOW = new Date('2026-11-03T08:00:00Z');
/** A hold that expired then is past its time at NOW. */
export const EARLIER = new Date('2026-11-03T07:00:00Z');
/** A hold expiring then is still running at NOW. */
export const LATER = new Date('2026-11-03T08:10:00Z');

export const SETTINGS: Record<string, number> = {
  slot_hold_ttl_minutes: 10,
  slot_hold_grace_minutes: 5,
  first_session_lead_hours: 24,
  slot_release_buffer_weeks: 0,
};
export const settings: SettingsReader = {
  read: async (key, schema) => schema.parse(SETTINGS[key]),
};

export type Gender = 'male' | 'female';
export type Standing = 'active' | 'suspended' | 'verification_required';

export const THURSDAY_0900 = new Date('1970-01-01T09:00:00Z');

/** Thursdays from 2026-11-05 at 09:00 Cairo (07:00Z): the first at least 24 hours after NOW. */
export const FOUR_THURSDAYS = [
  { sequence: 1, localDate: '2026-11-05', startsAt: '2026-11-05T07:00:00.000Z' },
  { sequence: 2, localDate: '2026-11-12', startsAt: '2026-11-12T07:00:00.000Z' },
  { sequence: 3, localDate: '2026-11-19', startsAt: '2026-11-19T07:00:00.000Z' },
  { sequence: 4, localDate: '2026-11-26', startsAt: '2026-11-26T07:00:00.000Z' },
];

export interface World {
  readonly teacherId: string;
  readonly studentId: string;
  readonly packageId: string;
  readonly subjectId: string;
  /** Thursday 09:00 Cairo, 60 minutes. */
  readonly slotId: string;
  readonly enrollmentId: string;
  /** The enrollment's hold, active and running unless the world says otherwise. */
  readonly holdId: string;
}

export interface WorldOptions {
  readonly gender?: Gender;
  readonly teacher?: Standing;
  readonly student?: Standing;
  readonly payoutVerified?: boolean;
  /** The enrollment's state, and its hold released (a late payment) unless `pending_payment`. */
  readonly enrollment?:
    | { readonly status: 'pending_payment'; readonly hold: 'running' | 'expired' | 'released' }
    | { readonly status: 'cancelled'; readonly reason: 'payment_expired' | 'teacher_suspended' };
}

/** The builders and reads over the spec's client, opened in its `beforeAll`. */
export function confirmationWorld(databaseOf: () => Database) {
  async function person(gender: Gender, accountStatus: Standing = 'active'): Promise<string> {
    const { id } = await databaseOf().user.create({
      data: {
        email: `probe-${randomUUID()}@example.invalid`,
        gender,
        dateOfBirth: new Date('1990-01-01T00:00:00Z'),
        displayName: 'Probe person',
        preferredLanguage: 'ar',
        timezone: CAIRO,
        accountStatus,
      },
      select: { id: true },
    });
    return id;
  }

  /** A teacher's four-session offer on Thursday 09:00, a student of the same gender, and their enrollment. */
  async function world(options: WorldOptions = {}): Promise<World> {
    const gender = options.gender ?? 'female';
    const teacherId = await person(gender, options.teacher);
    await databaseOf().teacherProfile.create({
      data: {
        userId: teacherId,
        bio: 'Probe',
        qualificationSummary: 'Probe',
        verificationStatus: 'approved',
        payoutVerifiedAt:
          options.payoutVerified === false ? null : new Date('2026-10-01T00:00:00Z'),
      },
    });
    const { id: subjectId } = await databaseOf().subject.create({
      data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
      select: { id: true },
    });
    const { id: packageId } = await databaseOf().package.create({
      data: {
        teacherUserId: teacherId,
        subjectId,
        sessionCount: 4,
        sessionDurationMinutes: 60,
        pricePiasters: 100_000n,
        isActive: true,
      },
      select: { id: true },
    });
    const { id: slotId } = await databaseOf().availabilitySlot.create({
      data: {
        teacherUserId: teacherId,
        dayOfWeek: 4,
        startTimeLocal: THURSDAY_0900,
        durationMinutes: 60,
        timezone: CAIRO,
        isActive: true,
      },
      select: { id: true },
    });
    const studentId = await person(gender, options.student);
    const state = options.enrollment ?? { status: 'pending_payment', hold: 'running' };
    const { id: enrollmentId } = await databaseOf().enrollment.create({
      data: {
        studentUserId: studentId,
        teacherUserId: teacherId,
        packageId,
        slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: subjectId,
        snapshotSlotTimezone: CAIRO,
        status: state.status,
        cancellationReason: state.status === 'cancelled' ? state.reason : null,
        purchasedAt: EARLIER,
        quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
      },
      select: { id: true },
    });
    const running = state.status === 'pending_payment' && state.hold === 'running';
    const { id: holdId } = await databaseOf().slotHold.create({
      data: {
        slotId,
        packageId,
        sessionCount: 4,
        studentUserId: studentId,
        enrollmentId,
        expiresAt: running ? LATER : EARLIER,
        releasedAt:
          state.status === 'cancelled' ||
          (state.status === 'pending_payment' && state.hold === 'released')
            ? EARLIER
            : null,
      },
      select: { id: true },
    });
    return { teacherId, studentId, packageId, subjectId, slotId, enrollmentId, holdId };
  }

  /**
   * A gateway order of the enrollment in `status`, with its `paid` event recorded when it is paid
   * (as the webhook records it), written by SQL: the amount column is named only in payments
   * (R-MONEY-6). Its id. `gatewayOrderId` names an order the stand-in created.
   */
  async function order(
    enrollmentId: string,
    status: 'created' | 'paid' | 'refunded' = 'paid',
    gatewayOrderId = `probe-order-${randomUUID()}`,
  ): Promise<string> {
    const [row] = await databaseOf().$queryRaw<{ id: string }[]>`
      INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                            status, expires_at, updated_at)
      VALUES (${enrollmentId}::uuid, 'fake', ${gatewayOrderId}, 100000, 'EGP',
              ${status}::payment_status, ${LATER}, now())
      RETURNING id::text AS id`;
    if (row === undefined) throw new Error('no order written');
    if (status !== 'created') await paidEvent(row.id);
    return row.id;
  }

  /** The order's `paid` event, as the webhook records it (append-only; body hashed, never kept). */
  async function paidEvent(paymentId: string): Promise<void> {
    await databaseOf().$executeRaw`
      INSERT INTO payment_events (payment_id, provider_event_id, event_type, signature_verified_at,
                                  payload_hash, received_at)
      VALUES (${paymentId}::uuid, ${`fake_evt_${randomUUID()}`}, 'paid', now(), 'probe-hash', now())`;
  }

  async function enrollmentOf(id: string) {
    return databaseOf().enrollment.findUniqueOrThrow({
      where: { id },
      select: { status: true, cancellationReason: true, confirmedAt: true },
    });
  }

  async function holdsOf(enrollmentId: string) {
    return databaseOf().slotHold.findMany({
      where: { enrollmentId },
      orderBy: { id: 'asc' },
      select: { id: true, releasedAt: true },
    });
  }

  async function sessionsOf(enrollmentId: string) {
    const rows = await databaseOf().session.findMany({
      where: { enrollmentId },
      orderBy: { sequenceNumber: 'asc' },
      select: { sequenceNumber: true, scheduledDateLocal: true, scheduledStartAt: true },
    });
    return rows.map((row) => ({
      sequence: row.sequenceNumber,
      localDate: row.scheduledDateLocal.toISOString().slice(0, 10),
      startsAt: row.scheduledStartAt.toISOString(),
    }));
  }

  async function eventsOf(enrollmentId: string) {
    return databaseOf().enrollmentEvent.findMany({
      where: { enrollmentId },
      orderBy: { id: 'asc' },
      select: { kind: true, cancellationReason: true, paymentId: true, occurredAt: true },
    });
  }

  async function casesOf(enrollmentId: string) {
    return databaseOf().dispute.findMany({
      where: { enrollmentId },
      orderBy: { id: 'asc' },
      select: { id: true, kind: true, reason: true, status: true },
    });
  }
  return { person, world, order, paidEvent, enrollmentOf, holdsOf, sessionsOf, eventsOf, casesOf };
}
