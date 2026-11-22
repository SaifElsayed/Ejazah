// 006:T005 (FR-701, R-501, R-504, R-507; data-model.md «programmes»; U-1, N-12): booking's queries
// on `programmes`, each on the caller's transaction. Queries only; `programmes.service.ts` holds the
// rules. A soft-deleted enrollment is left out (`deleted_at` named, as the nested read needs it).
//
// Bounded: a student's active programmes are few (one per programme enrollment of theirs), read by
// the enrollments' `student_user_id` index and the programmes' primary key.
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
