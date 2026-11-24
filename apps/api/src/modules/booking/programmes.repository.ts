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

/** 006:T009 (Q-C1 (a)): a programme's payment as the confirm step records it. */
export interface ProgrammePayment {
  readonly plan: 'in_full' | 'monthly';
  /** The highest month paid: `month_count` in full, else the month (data-model.md). */
  readonly monthsPaid: number;
}

/**
 * 006:T009 (the owner's Q-C1 (a), 2026-11-23): the programme's payment, on the confirm step's
 * transaction holding the programme's lock: from `offered`, `active` with its plan; 006:T016 (FR-722,
 * B-P3's conflict check): from `paused`, `active` with `paused_at` cleared (rule 77: one update, so
 * the two move together), every paid month landing here, an automatic one after a pause included;
 * then the months paid. Whether the programme was resumed from `paused`.
 */
export async function writeProgrammePaid(
  tx: Client,
  enrollmentId: string,
  payment: ProgrammePayment,
): Promise<boolean> {
  await tx.programme.updateMany({
    where: { enrollmentId, state: 'offered' },
    data: { state: 'active', paymentPlan: payment.plan },
  });
  const { count: resumed } = await tx.programme.updateMany({
    where: { enrollmentId, state: 'paused' },
    data: { state: 'active', pausedAt: null },
  });
  await tx.programme.updateMany({
    where: { enrollmentId },
    data: { monthsPaid: payment.monthsPaid },
  });
  return resumed === 1;
}

/**
 * 006:T016 (FR-724, FR-BOOK-18): the enrollment's open `stop` request withdrawn by one conditional
 * update, as a paid month withdraws it; its id, or null when none was open. The caller holds the
 * programme's lock, which every writer of a stop request takes first (kernel.md, 006:T008's row).
 */
export async function withdrawOpenStop(
  tx: Pick<Transaction, 'programmeRequest'>,
  enrollmentId: string,
): Promise<string | null> {
  const open = await tx.programmeRequest.findFirst({
    where: { enrollmentId, kind: 'stop', status: 'open' },
    select: { id: true },
  });
  if (open === null) return null;
  const { count } = await tx.programmeRequest.updateMany({
    where: { id: open.id, status: 'open' },
    data: { status: 'withdrawn' },
  });
  return count === 1 ? open.id : null;
}

// ---------------------------------------------------------------------------------------------
// 006:T008 (FR-706, FR-706a, FR-706b, FR-709; R-505, R-510, R-513; Q-2 (a), Q-3 (a) amended): the
// windows' reads and writes and the close hook's, each on the caller's transaction, which holds the
// programme's row lock.

/** A programme as its windows, its cancellation and its decisions read it under its row lock. */
export interface ProgrammeFacts {
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly status: EnrollmentStatus;
  readonly state: ProgrammeState;
  readonly offerDueAt: Date | null;
  readonly payByAt: Date | null;
}

/** The enrollment's programme, or null for an enrollment that is no programme or is soft-deleted. */
export async function programmeFactsOf(
  tx: Client,
  enrollmentId: string,
): Promise<ProgrammeFacts | null> {
  const row = await tx.programme.findFirst({
    where: { enrollmentId, enrollment: { deletedAt: null } },
    select: {
      state: true,
      offerDueAt: true,
      payByAt: true,
      enrollment: { select: { studentUserId: true, teacherUserId: true, status: true } },
    },
  });
  return row === null
    ? null
    : {
        enrollmentId,
        studentUserId: row.enrollment.studentUserId,
        teacherUserId: row.enrollment.teacherUserId,
        status: row.enrollment.status,
        state: row.state,
        offerDueAt: row.offerDueAt,
        payByAt: row.payByAt,
      };
}

/**
 * The derived offer's deadline written while the programme awaits its offer (Q-3 (a) amended: the
 * column holds the last derived value); nothing once it has moved on.
 */
export async function writeOfferDue(
  tx: Client,
  enrollmentId: string,
  offerDueAt: Date | null,
): Promise<void> {
  await tx.programme.updateMany({
    where: { enrollmentId, state: 'awaiting_offer' },
    data: { offerDueAt },
  });
}

/** An administrator's extension of a `pay_blocked` item: `pay_by_at` moved, only while `offered`. */
export async function writePayBy(
  tx: Client,
  enrollmentId: string,
  payByAt: Date,
): Promise<boolean> {
  const { count } = await tx.programme.updateMany({
    where: { enrollmentId, state: 'offered' },
    data: { payByAt },
  });
  return count === 1;
}

/**
 * The close hook's write (R-510): those of `enrollmentIds` whose programme is not yet closed, set
 * `closed` at `closedAt` (`paused_at` cleared with it, rule 77), in one conditional update; the ids
 * closed, in id order. An enrollment that is no programme has no row and is not among them.
 */
export async function closeProgrammeRows(
  tx: Client,
  enrollmentIds: readonly string[],
  closedAt: Date,
): Promise<string[]> {
  if (enrollmentIds.length === 0) return [];
  const open = await tx.programme.findMany({
    where: { enrollmentId: { in: [...enrollmentIds] }, state: { not: 'closed' } },
    orderBy: { enrollmentId: 'asc' },
    select: { enrollmentId: true },
  });
  const ids = open.map(({ enrollmentId }) => enrollmentId);
  if (ids.length === 0) return [];
  await tx.programme.updateMany({
    where: { enrollmentId: { in: ids }, state: { not: 'closed' } },
    data: { state: 'closed', closedAt, pausedAt: null },
  });
  return ids;
}

// ---------------------------------------------------------------------------------------------
// 006:T015 (FR-714, FR-717, FR-721; R-507, R-508; Q-1 (a), Q-3 (a)): the sweep's reads and writes,
// each on the caller's transaction. The steps' writes are made holding the programme's row lock;
// the page and the survey read with none.

/** The `advance-programmes` sweep's page row: a programme the sweep may act on, and its state. */
export interface SweptProgramme {
  readonly enrollmentId: string;
  readonly state: ProgrammeState;
}

/**
 * The sweep's page (R-508), by enrollment id after `after`, at most `take`: of the confirmed,
 * undeleted enrollments' programmes, every one `awaiting_offer` (its deadline derived on every
 * read), every one `offered` past `pay_by_at`, and every monthly one `active` or `paused` with a
 * month still to pay whose due point is unset or reached at `now` (the database's). Over the
 * primary key's order and `programmes_state_next_due_at_idx`; bounded by `take`.
 */
export async function programmesToSweep(
  tx: Client,
  now: Date,
  after: string | undefined,
  take: number,
): Promise<SweptProgramme[]> {
  return tx.programme.findMany({
    where: {
      ...(after === undefined ? {} : { enrollmentId: { gt: after } }),
      enrollment: { status: 'confirmed', deletedAt: null },
      OR: [
        { state: 'awaiting_offer' },
        { state: 'offered', payByAt: { lte: now } },
        {
          state: { in: ['active', 'paused'] },
          paymentPlan: 'monthly',
          monthsPaid: { lt: tx.programme.fields.monthCount },
          OR: [{ nextDueAt: null }, { nextDueAt: { lte: now } }],
        },
      ],
    },
    orderBy: { enrollmentId: 'asc' },
    take,
    select: { enrollmentId: true, state: true },
  });
}

/** A paid programme as the sweep's month steps read it (R-508 steps 2 to 4). */
export interface ProgrammeMonthRow {
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly status: EnrollmentStatus;
  readonly state: ProgrammeState;
  readonly plan: 'in_full' | 'monthly' | null;
  readonly monthsPaid: number;
  readonly monthCount: number | null;
  /** The column: the last derived due point (Q-3 (a)). */
  readonly nextDueAt: Date | null;
  readonly firstFailureAt: Date | null;
  readonly retriesDone: number;
  readonly slotId: string;
  /** `snapshot_slot_timezone`, the zone the weekly time is resolved in. */
  readonly timezone: string;
  /** The offer's count N, the assessment left out (R-501). */
  readonly offerSessionCount: number;
  /** The offer's frozen total (R-506). */
  readonly offerTotal_piasters: Piasters;
}

/** The enrollment's programme for the month steps, or null for none or a soft-deleted enrollment. */
export async function programmeMonthOf(
  tx: Client,
  enrollmentId: string,
): Promise<ProgrammeMonthRow | null> {
  const row = await tx.programme.findFirst({
    where: { enrollmentId, enrollment: { deletedAt: null } },
    select: {
      state: true,
      paymentPlan: true,
      monthsPaid: true,
      monthCount: true,
      nextDueAt: true,
      firstFailureAt: true,
      retriesDone: true,
      enrollment: {
        select: {
          studentUserId: true,
          teacherUserId: true,
          status: true,
          slotId: true,
          snapshotSlotTimezone: true,
          snapshotSessionCount: true,
          snapshotPricePiasters: true,
        },
      },
    },
  });
  if (row === null) return null;
  const { enrollment } = row;
  return {
    enrollmentId,
    studentUserId: enrollment.studentUserId,
    teacherUserId: enrollment.teacherUserId,
    status: enrollment.status,
    state: row.state,
    plan: row.paymentPlan,
    monthsPaid: row.monthsPaid,
    monthCount: row.monthCount,
    nextDueAt: row.nextDueAt,
    firstFailureAt: row.firstFailureAt,
    retriesDone: row.retriesDone,
    slotId: enrollment.slotId,
    timezone: enrollment.snapshotSlotTimezone,
    offerSessionCount: enrollment.snapshotSessionCount - 1,
    offerTotal_piasters: piasters(Number(enrollment.snapshotPricePiasters)),
  };
}

/** Q-3 (a): the derived due point written (the column holds the last derived value). */
export async function writeNextDue(
  tx: Client,
  enrollmentId: string,
  nextDueAt: Date | null,
): Promise<void> {
  await tx.programme.updateMany({
    where: { enrollmentId, state: { in: ['active', 'paused'] } },
    data: { nextDueAt },
  });
}

/** The month's first failure (R-508 step 3), written once; whether it was. */
export async function writeFirstFailure(
  tx: Client,
  enrollmentId: string,
  at: Date,
): Promise<boolean> {
  const { count } = await tx.programme.updateMany({
    where: { enrollmentId, state: { in: ['active', 'paused'] }, firstFailureAt: null },
    data: { firstFailureAt: at },
  });
  return count === 1;
}

/**
 * The automatic order's attempt recorded on the programme, by one conditional update: attempt 0
 * (the month's first charge) clears the earlier month's failure and retries; a retry n moves
 * `retries_done` from n − 1 to n. Whether it moved.
 */
export async function writeAttempt(
  tx: Client,
  enrollmentId: string,
  attempt: number,
): Promise<boolean> {
  const { count } = await tx.programme.updateMany({
    where: {
      enrollmentId,
      state: { in: ['active', 'paused'] },
      ...(attempt === 0 ? {} : { retriesDone: attempt - 1 }),
    },
    data: attempt === 0 ? { firstFailureAt: null, retriesDone: 0 } : { retriesDone: attempt },
  });
  return count === 1;
}

/** The pause (R-507, FR-BOOK-17): an `active` programme `paused` since `pausedAt`; whether it moved. */
export async function writePaused(
  tx: Client,
  enrollmentId: string,
  pausedAt: Date,
): Promise<boolean> {
  const { count } = await tx.programme.updateMany({
    where: { enrollmentId, state: 'active' },
    data: { state: 'paused', pausedAt },
  });
  return count === 1;
}

/**
 * Q-1 (a): the enrollment's open item of `kind` withdrawn by one conditional update (an answer came
 * to the charge it was opened for); whether one was. `programme_requests` is booking's table.
 */
export async function withdrawOpenItem(
  tx: Pick<Transaction, 'programmeRequest'>,
  enrollmentId: string,
  kind: 'charge_unknown',
): Promise<boolean> {
  const { count } = await tx.programmeRequest.updateMany({
    where: { enrollmentId, kind, status: 'open' },
    data: { status: 'withdrawn' },
  });
  return count === 1;
}
