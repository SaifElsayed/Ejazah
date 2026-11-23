// 006:T005 (FR-701, R-501, R-504, R-507; data-model.md «programmes»; U-1, N-12): booking's queries
// on `programmes`, each on the caller's transaction. Queries only; `programmes.service.ts` holds the
// rules. A soft-deleted enrollment is left out (`deleted_at` named, as the nested read needs it).
//
// Bounded: a student's active programmes are few (one per programme enrollment of theirs), read by
// the enrollments' `student_user_id` index and the programmes' primary key.
import type { EnrollmentStatus } from '@ijazah/contracts';
import { type Piasters, piasters, toPlainNumber } from '@ijazah/money';

import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'programme'>;

/** `programme_state` while a programme holds its weekly time (DEC-94, FR-701). */
export const ACTIVE_PROGRAMME_STATES = ['awaiting_offer', 'offered', 'active', 'paused'] as const;

/** An active programme's weekly time: its enrollment, its slot and the zone its sessions are in. */
export interface ActiveProgrammeSlot {
  readonly enrollmentId: string;
  readonly slotId: string;
  /** `snapshot_slot_timezone`, the zone every session of the enrollment is resolved in. */
  readonly timezone: string;
}

/**
 * The active programmes of `studentUserIds`, `exceptEnrollmentId`'s left out, by enrollment id; none
 * for an empty list.
 */
export async function activeProgrammeSlotsOf(
  tx: Client,
  studentUserIds: readonly string[],
  exceptEnrollmentId?: string,
): Promise<ActiveProgrammeSlot[]> {
  if (studentUserIds.length === 0) return [];
  const rows = await tx.programme.findMany({
    where: {
      state: { in: [...ACTIVE_PROGRAMME_STATES] },
      enrollment: {
        studentUserId: { in: [...studentUserIds] },
        deletedAt: null,
        ...(exceptEnrollmentId === undefined ? {} : { id: { not: exceptEnrollmentId } }),
      },
    },
    orderBy: { enrollmentId: 'asc' },
    select: {
      enrollmentId: true,
      enrollment: { select: { slotId: true, snapshotSlotTimezone: true } },
    },
  });
  return rows.map(({ enrollmentId, enrollment }) => ({
    enrollmentId,
    slotId: enrollment.slotId,
    timezone: enrollment.snapshotSlotTimezone,
  }));
}

/**
 * Writes the programme of a just-confirmed assessment, `awaiting_offer` (R-504); nothing when it is
 * there already, so a second run of the confirm step writes no second row (R-API-14). The caller
 * holds the enrollment's lock.
 */
export async function insertAwaitingOffer(tx: Client, enrollmentId: string): Promise<void> {
  await tx.programme.createMany({
    data: [{ enrollmentId, state: 'awaiting_offer' }],
    skipDuplicates: true,
  });
}

/** `programme_state`, or null for an enrollment that is no programme. */
export type ProgrammeState = 'awaiting_offer' | 'offered' | 'active' | 'paused' | 'closed';

/**
 * 006:T006 (R-502): the enrollment's programme's state, or null when it has none; the caller holds
 * the programme's lock (`lockForConfirmation`).
 */
export async function programmeStateOf(
  tx: Client,
  enrollmentId: string,
): Promise<ProgrammeState | null> {
  const row = await tx.programme.findUnique({ where: { enrollmentId }, select: { state: true } });
  return row?.state ?? null;
}

/**
 * 006:T007 (FR-705, R-506): the programme and its enrollment as the offer decides on them: the two
 * parties, the package and the weekly time, the enrollment's status and the programme's state.
 * Null for an enrollment that is no programme or is soft-deleted. The offer reads it once to find
 * the teacher, then again under the programme's and the enrollment's locks.
 */
export interface OfferEnrollment {
  readonly id: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly packageId: string;
  readonly slotId: string;
  readonly status: EnrollmentStatus;
  readonly state: ProgrammeState;
}

export async function offerEnrollmentOf(
  tx: Client,
  enrollmentId: string,
): Promise<OfferEnrollment | null> {
  const row = await tx.programme.findFirst({
    where: { enrollmentId, enrollment: { deletedAt: null } },
    select: {
      state: true,
      enrollment: {
        select: {
          id: true,
          studentUserId: true,
          teacherUserId: true,
          packageId: true,
          slotId: true,
          status: true,
        },
      },
    },
  });
  return row === null ? null : { ...row.enrollment, state: row.state };
}

/** The offer as it is frozen (R-506): the teacher's words, the programme's times, the snapshot. */
export interface FrozenOffer {
  readonly level: string;
  readonly readiness: string;
  readonly expectedLength: string;
  readonly offeredAt: Date;
  /** The offer + `programme_pay_rest_hours` (R-505; data-model.md: set at the offer). */
  readonly payByAt: Date;
  readonly monthCount: number;
  /** The enrollment's snapshot: the offer's count + the assessment, its length, its total. */
  readonly snapshot: {
    readonly sessionCount: number;
    readonly durationMinutes: number;
    readonly price_piasters: Piasters;
  };
}

/**
 * 006:T007 (R-506): the offer and the enrollment's snapshot, on the offer's transaction: the
 * programme `offered` with the offer's words and times, only from `awaiting_offer`, then the
 * enrollment's count, length and total. Whether the programme moved; nothing is written when it did
 * not. The caller holds the teacher's account, the programme and the enrollment, in that order.
 */
export async function writeOffer(
  tx: Pick<Transaction, 'programme' | 'enrollment'>,
  enrollmentId: string,
  offer: FrozenOffer,
): Promise<boolean> {
  const { count } = await tx.programme.updateMany({
    where: { enrollmentId, state: 'awaiting_offer' },
    data: {
      state: 'offered',
      level: offer.level,
      readiness: offer.readiness,
      expectedLength: offer.expectedLength,
      offeredAt: offer.offeredAt,
      payByAt: offer.payByAt,
      monthCount: offer.monthCount,
    },
  });
  if (count !== 1) return false;
  await tx.enrollment.updateMany({
    where: { id: enrollmentId },
    data: {
      snapshotSessionCount: offer.snapshot.sessionCount,
      snapshotDurationMinutes: offer.snapshot.durationMinutes,
      snapshotPricePiasters: BigInt(toPlainNumber(offer.snapshot.price_piasters)),
    },
  });
  return true;
}

// ---------------------------------------------------------------------------------------------
// 006:T009 (FR-710, R-507, R-509): what `programme.pay` and the confirm step read of the programme.

/**
 * The programme and its enrollment as `programme.pay` decides on them: the two parties, the
 * enrollment's status, the programme's state and `pay_by_at`, and the frozen offer (its sessions,
 * the snapshot's count less the assessment, and its total). Null for an enrollment that is no
 * programme or is soft-deleted. Read once with no lock to find the parties, then again under the
 * locks.
 */
export interface PayEnrollment {
  readonly id: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly status: EnrollmentStatus;
  readonly state: ProgrammeState;
  readonly payByAt: Date | null;
  /** The offer's count N: the snapshot's N + 1 less the assessment, session 1 (R-501). */
  readonly offerSessionCount: number;
  /** The offer's total, N × the session price, frozen on the snapshot (R-506). */
  readonly total_piasters: Piasters;
  readonly track: 'recitation' | 'ijazah_track';
}

export async function payEnrollmentOf(
  tx: Client,
  enrollmentId: string,
): Promise<PayEnrollment | null> {
  const row = await tx.programme.findFirst({
    where: { enrollmentId, enrollment: { deletedAt: null } },
    select: {
      state: true,
      payByAt: true,
      enrollment: {
        select: {
          id: true,
          studentUserId: true,
          teacherUserId: true,
          status: true,
          snapshotSessionCount: true,
          snapshotPricePiasters: true,
          snapshotTrack: true,
        },
      },
    },
  });
  if (row === null) return null;
  const { enrollment } = row;
  return {
    id: enrollment.id,
    studentUserId: enrollment.studentUserId,
    teacherUserId: enrollment.teacherUserId,
    status: enrollment.status,
    state: row.state,
    payByAt: row.payByAt,
    offerSessionCount: enrollment.snapshotSessionCount - 1,
    total_piasters: piasters(Number(enrollment.snapshotPricePiasters)),
    track: enrollment.snapshotTrack,
  };
}

/** The programme's state and `pay_by_at`, read under its lock by the confirm step (R-507). */
export interface ProgrammeTerms {
  readonly state: ProgrammeState;
  readonly payByAt: Date | null;
}

export async function programmeTermsOf(
  tx: Client,
  enrollmentId: string,
): Promise<ProgrammeTerms | null> {
  return tx.programme.findUnique({
    where: { enrollmentId },
    select: { state: true, payByAt: true },
  });
}
