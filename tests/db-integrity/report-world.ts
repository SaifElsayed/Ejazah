// T011 of specs/005-certification: the rows a report's database specs stand on, written on one
// Prisma transaction the spec rolls back (`certificates-repository.spec.ts`'s pattern): people, a
// teacher's offer, enrollments in a status and their sessions. Not a spec; read by
// `pairings.spec.ts` and `user-reports.spec.ts`.
import { randomUUID } from 'node:crypto';

import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';

export const CAIRO = 'Africa/Cairo';

/** The spec file's one client, opened in `beforeAll` and closed in `afterAll`. */
export function openSpecDatabase(): Database {
  return openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
}

export { closeDatabase };

const ROLLED_BACK = Symbol('rolled back');

/** Runs `probe` on one transaction and rolls back whatever it wrote. */
export async function rolledBack(
  database: Database,
  probe: (tx: Transaction) => Promise<void>,
): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLED_BACK;
      },
      { timeout: 30_000 },
    );
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
}

export type Gender = 'male' | 'female';
export type WorldStatus = 'pending_payment' | 'confirmed';

/** The builders of one world, each on the probe's transaction. */
export function worldOn(tx: Transaction) {
  async function person(gender: Gender = 'male'): Promise<string> {
    const { id } = await tx.user.create({
      data: {
        email: `report-${randomUUID()}@example.invalid`,
        gender,
        dateOfBirth: new Date('2000-01-01T00:00:00Z'),
        displayName: 'Probe',
        preferredLanguage: 'ar',
        timezone: CAIRO,
        accountStatus: 'active',
      },
      select: { id: true },
    });
    return id;
  }

  async function admin(): Promise<string> {
    const { id } = await tx.adminUser.create({
      data: {
        email: `report-admin-${randomUUID()}@example.invalid`,
        mfaSecretEncrypted: Buffer.from('spec'),
        displayName: 'Spec administrator',
        isActive: true,
      },
      select: { id: true },
    });
    return id;
  }

  /** A teacher visible to students of `gender` (approved, payout verified) and their offer. */
  async function teacher(gender: Gender = 'male') {
    const teacherId = await person(gender);
    await tx.teacherProfile.create({
      data: {
        userId: teacherId,
        bio: 'Probe',
        qualificationSummary: 'Probe',
        verificationStatus: 'approved',
        payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
      },
    });
    const { id: subjectId } = await tx.subject.create({
      data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
      select: { id: true },
    });
    const { id: packageId } = await tx.package.create({
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
    const { id: slotId } = await tx.availabilitySlot.create({
      data: {
        teacherUserId: teacherId,
        dayOfWeek: 2,
        startTimeLocal: new Date('1970-01-01T14:00:00Z'),
        durationMinutes: 60,
        timezone: CAIRO,
        isActive: true,
      },
      select: { id: true },
    });
    return { teacherId, subjectId, packageId, slotId };
  }

  /** One enrollment of the student with the teacher's offer, in `status`. */
  async function enrollment(
    offer: Awaited<ReturnType<typeof teacher>>,
    studentId: string,
    status: WorldStatus = 'confirmed',
  ): Promise<string> {
    const { id } = await tx.enrollment.create({
      data: {
        studentUserId: studentId,
        teacherUserId: offer.teacherId,
        packageId: offer.packageId,
        slotId: offer.slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: offer.subjectId,
        snapshotSlotTimezone: CAIRO,
        status,
        ...(status === 'confirmed' ? { confirmedAt: new Date('2026-10-01T00:00:00Z') } : {}),
        purchasedAt: new Date('2026-10-01T00:00:00Z'),
        quotedFirstSessionLocalDate: new Date('2026-11-03T00:00:00Z'),
      },
      select: { id: true },
    });
    return id;
  }

  /** The enrollment's first session, scheduled. */
  async function session(
    enrollmentId: string,
    parties: { readonly teacherId: string; readonly studentId: string },
  ): Promise<string> {
    const { id } = await tx.session.create({
      data: {
        enrollmentId,
        teacherUserId: parties.teacherId,
        studentUserId: parties.studentId,
        sequenceNumber: 1,
        scheduledDateLocal: new Date('2026-11-03T00:00:00Z'),
        scheduledStartTimeLocal: new Date('1970-01-01T14:00:00Z'),
        timezone: CAIRO,
        scheduledStartAt: new Date('2026-11-03T12:00:00Z'),
        scheduledEndAt: new Date('2026-11-03T13:00:00Z'),
        status: 'scheduled',
      },
      select: { id: true },
    });
    return id;
  }

  /** A teacher, a student of the same gender and one enrollment between them with its session. */
  async function pair(gender: Gender = 'male', status: WorldStatus = 'confirmed') {
    const offer = await teacher(gender);
    const studentId = await person(gender);
    const enrollmentId = await enrollment(offer, studentId, status);
    const sessionId = await session(enrollmentId, { teacherId: offer.teacherId, studentId });
    return { ...offer, studentId, enrollmentId, sessionId };
  }

  return { person, admin, teacher, enrollment, session, pair };
}
