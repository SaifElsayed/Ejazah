// T019 (R-206, R-207, FR-313): the catalog module's `availability_slots` rows as a teacher's slots
// read and write them, each on the caller's transaction. Queries and locks only; the rules are
// `slots.service.ts`'s. A slot's local start is a `time` column, written and read through
// `packages/time` (R-TIME-1): wall-clock time beside its zone, never an instant (R-TIME-3).
//
// The two locks are the kernel's (`platform/db/row-lock.ts`), taken here because this module owns
// the table (R-API-6): the teacher's slots by the advisory key `teacher-slots`, and one slot's row.
// A caller takes them in T005's order: the account, then the key, then the row.
//
// T026: `offeredSlotsOf`, the slots booking's discovery read may offer, reached through the entry;
// read-only, no lock.
import { type LocalTime, localTimeOf, timeColumnOf } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockKey, lockRows } from '../../platform/db/row-lock.js';
import type { NewSlot, SlotChange, SlotRow } from './slots.service.js';

type Client = Pick<Transaction, 'availabilitySlot'>;

interface SlotColumns {
  readonly id: string;
  readonly dayOfWeek: number;
  readonly startTimeLocal: Date;
  readonly durationMinutes: number;
  readonly timezone: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

function rowOf({ startTimeLocal, ...row }: SlotColumns): SlotRow {
  return { ...row, startTimeLocal: localTimeOf(startTimeLocal) };
}

/** Takes the teacher's slots' advisory lock until the transaction ends (R-206). */
export function lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void> {
  return lockKey(tx, 'teacher-slots', teacherUserId);
}

/** Locks the slot's row, FOR UPDATE, until the transaction ends (R-207). */
export function lockSlot(tx: Transaction, slotId: string): Promise<void> {
  return lockRows(tx, 'availability_slots', [slotId]);
}

/** Whether the slot is the teacher's; a slot's teacher never changes. */
export async function ownsSlot(
  tx: Client,
  slotId: string,
  teacherUserId: string,
): Promise<boolean> {
  const slot = await tx.availabilitySlot.findFirst({
    where: { id: slotId, teacherUserId },
    select: { id: true },
  });
  return slot !== null;
}

export async function readSlot(tx: Client, slotId: string): Promise<SlotRow | null> {
  const slot = await tx.availabilitySlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      dayOfWeek: true,
      startTimeLocal: true,
      durationMinutes: true,
      timezone: true,
      isActive: true,
      createdAt: true,
    },
  });
  return slot === null ? null : rowOf(slot);
}

/**
 * Every slot of the teacher, by day, start and id. Bounded by the week: a teacher's active slots
 * never overlap, so they fit in it (R-206).
 */
export async function slotsOf(tx: Client, teacherUserId: string): Promise<SlotRow[]> {
  const slots = await tx.availabilitySlot.findMany({
    where: { teacherUserId },
    orderBy: [{ dayOfWeek: 'asc' }, { startTimeLocal: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      dayOfWeek: true,
      startTimeLocal: true,
      durationMinutes: true,
      timezone: true,
      isActive: true,
      createdAt: true,
    },
  });
  return slots.map(rowOf);
}

/** The teacher's active slots, what a save is checked against (R-206). */
export async function activeSlotsOf(tx: Client, teacherUserId: string): Promise<SlotRow[]> {
  const slots = await tx.availabilitySlot.findMany({
    where: { teacherUserId, isActive: true },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      dayOfWeek: true,
      startTimeLocal: true,
      durationMinutes: true,
      timezone: true,
      isActive: true,
      createdAt: true,
    },
  });
  return slots.map(rowOf);
}

/** A slot booking may offer, with its teacher (T026, R-205). */
export interface OfferedSlot {
  readonly id: string;
  readonly teacherUserId: string;
  readonly dayOfWeek: number;
  readonly startTimeLocal: LocalTime;
  readonly durationMinutes: number;
  readonly timezone: string;
}

/**
 * Of `teacherIds` (a page of discovery, already visible), each teacher's active slots whose length
 * is the length of one of that teacher's active packages, by id (T026, R-205: booking decides which
 * are free). Bounded by the page and the week: a teacher's active slots never overlap (R-206).
 *
 * 006:T004 (R-504, FR-701, FR-PROFILE-8 as amended by DEC-94; Q-5 (a)): a programme package has no
 * length of its own; it offers each of its teacher's active slots at least `programmeMinMinutes`
 * long, the assessment's length (`assessment_duration_minutes`), which the caller names only while
 * the programme is open (`programmeAvailabilityOf`). With none named, a programme package offers
 * nothing, so a closed programme is never offered by default.
 */
export async function offeredSlotsOf(
  tx: Pick<Transaction, 'availabilitySlot' | 'package'>,
  teacherIds: readonly string[],
  programmeMinMinutes?: number,
): Promise<OfferedSlot[]> {
  if (teacherIds.length === 0) return [];
  const packages = await tx.package.findMany({
    where: {
      teacherUserId: { in: [...teacherIds] },
      isActive: true,
      ...(programmeMinMinutes === undefined ? { isProgramme: false } : {}),
    },
    distinct: ['teacherUserId', 'isProgramme', 'sessionDurationMinutes'],
    select: { teacherUserId: true, isProgramme: true, sessionDurationMinutes: true },
  });
  const lengths = new Set<number>();
  const offered = new Set<string>();
  const programmeTeachers = new Set<string>();
  for (const { teacherUserId, isProgramme, sessionDurationMinutes } of packages) {
    if (isProgramme) programmeTeachers.add(teacherUserId);
    else if (sessionDurationMinutes !== null) {
      lengths.add(sessionDurationMinutes);
      offered.add(lengthKey(teacherUserId, sessionDurationMinutes));
    }
  }
  const floor = programmeTeachers.size === 0 ? undefined : programmeMinMinutes;
  if (lengths.size === 0 && floor === undefined) return [];
  const slots = await tx.availabilitySlot.findMany({
    where: {
      teacherUserId: { in: [...teacherIds] },
      isActive: true,
      OR: [
        { durationMinutes: { in: [...lengths] } },
        ...(floor === undefined ? [] : [{ durationMinutes: { gte: floor } }]),
      ],
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      teacherUserId: true,
      dayOfWeek: true,
      startTimeLocal: true,
      durationMinutes: true,
      timezone: true,
    },
  });
  return slots
    .filter(
      (row) =>
        offered.has(lengthKey(row.teacherUserId, row.durationMinutes)) ||
        (floor !== undefined &&
          programmeTeachers.has(row.teacherUserId) &&
          row.durationMinutes >= floor),
    )
    .map(({ startTimeLocal, ...row }) => ({ ...row, startTimeLocal: localTimeOf(startTimeLocal) }));
}

/** A teacher's package length, as one key. */
function lengthKey(teacherUserId: string, minutes: number): string {
  return `${teacherUserId}:${String(minutes)}`;
}

export async function insertSlot(tx: Client, slot: NewSlot): Promise<SlotRow> {
  const { startTimeLocal, ...columns } = slot;
  return rowOf(
    await tx.availabilitySlot.create({
      data: { ...columns, startTimeLocal: timeColumnOf(startTimeLocal) },
      select: {
        id: true,
        dayOfWeek: true,
        startTimeLocal: true,
        durationMinutes: true,
        timezone: true,
        isActive: true,
        createdAt: true,
      },
    }),
  );
}

export async function updateSlot(tx: Client, slotId: string, change: SlotChange): Promise<SlotRow> {
  const { startTimeLocal, ...columns } = change;
  return rowOf(
    await tx.availabilitySlot.update({
      where: { id: slotId },
      data: {
        ...columns,
        ...(startTimeLocal === undefined ? {} : { startTimeLocal: timeColumnOf(startTimeLocal) }),
      },
      select: {
        id: true,
        dayOfWeek: true,
        startTimeLocal: true,
        durationMinutes: true,
        timezone: true,
        isActive: true,
        createdAt: true,
      },
    }),
  );
}
