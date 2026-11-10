// T028 of specs/004-sessions/tasks.md (FR-462 to FR-464; research R-311, "Offering" and "The
// proposal"; data-model.md §2.3, §3): the queries of a remedy's offer, the sweep's due reads, and the
// remedy as `sessions.get` and the lists read it, each on the caller's transaction. The rules and the
// locks' order are `remedy-offer.service.ts`'; a path that decides locks first and reads again here
// (`003:T005`'s rule 1). A soft-deleted session is left out.
//
// The sweep's due reads take no lock and are paged by id after a cursor (the follow-up under T028:
// no index covers them, R-DB-9; measured in Phase 6). `remedyStatusesAmong` and
// `enrollmentsSettledAmong` are bounded by the ids asked about.
import type { Prisma } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

type Client = Pick<Transaction, 'session' | 'sessionRemedy'>;

/** `remedy_status` (ERD §5). */
export type RemedyRowStatus = Prisma.SessionRemedyCreateInput['status'];

/** The outcomes a remedy is owed for (FR-462), and the one an acceptance writes. */
export const OWING_STATUSES = [
  'teacher_no_show',
  'both_no_show',
  'cancelled_by_agreement',
] as const;

/** The session an offer decides on. */
export interface OfferSession {
  readonly id: string;
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly status: string;
  readonly scheduledEndAt: Date;
}

/** The session's remedy as the offer reads it under its lock; null when it has none. */
export interface ExistingRemedy {
  readonly id: string;
  readonly status: RemedyRowStatus;
}

/** A session, by its id, with its parties and status; null for none or a soft-deleted one. */
export async function offerSessionOf(tx: Client, sessionId: string): Promise<OfferSession | null> {
  return tx.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: {
      id: true,
      enrollmentId: true,
      studentUserId: true,
      teacherUserId: true,
      status: true,
      scheduledEndAt: true,
    },
  });
}

/** The session's remedy, if any. */
export async function remedyOfSession(
  tx: Client,
  sessionId: string,
): Promise<ExistingRemedy | null> {
  return tx.sessionRemedy.findUnique({
    where: { sessionId },
    select: { id: true, status: true },
  });
}

/** Locks the session's remedy rows `FOR UPDATE` (kernel.md's offer row, after the session). */
export async function lockRemedyOfSession(tx: Transaction, sessionId: string): Promise<void> {
  const remedy = await tx.sessionRemedy.findUnique({ where: { sessionId }, select: { id: true } });
  await lockRows(tx, 'session_remedies', remedy === null ? [] : [remedy.id]);
}

/**
 * The latest local date the enrollment's time reaches: its sessions' (make-ups included) and the
 * proposals of its other open remedies that reserve time (R-311: "after its last session, make-ups
 * and reservations included"); null when it has none.
 */
export async function lastReachedDateOf(
  tx: Client,
  enrollmentId: string,
  exceptSessionId: string,
): Promise<Date | null> {
  const [session, proposal] = await Promise.all([
    tx.session.aggregate({
      where: { enrollmentId, deletedAt: null },
      _max: { scheduledDateLocal: true },
    }),
    tx.sessionRemedy.aggregate({
      where: {
        status: { in: ['awaiting_choice', 'proposed', 'counter_proposed'] },
        sessionId: { not: exceptSessionId },
        session: { enrollmentId, deletedAt: null },
      },
      _max: { proposedDate: true },
    }),
  ]);
  const dates = [session._max.scheduledDateLocal, proposal._max.proposedDate].filter(
    (date): date is Date => date !== null,
  );
  return dates.length === 0 ? null : new Date(Math.max(...dates.map((date) => date.getTime())));
}

/** A remedy to write at an offer (data-model.md §2.3). */
export interface OfferedRow {
  readonly status: 'awaiting_choice' | 'proposed';
  readonly proposedDate: Date;
  readonly offeredAt: Date;
  readonly choiceClosesAt: Date;
  readonly snapshotAnswerWindowHours: number;
  readonly snapshotFirstSessionLeadHours: number;
}

/** Inserts the session's remedy; `session_remedies_session_id_key` refuses a second. */
export async function insertRemedy(
  tx: Client,
  sessionId: string,
  row: OfferedRow,
): Promise<string> {
  const { id } = await tx.sessionRemedy.create({
    data: { sessionId, kind: 'makeup', ...row },
    select: { id: true },
  });
  return id;
}

/** Offers a `frozen` remedy again as a new offer (R-311, "Frozen"); whether it moved. */
export async function reofferFrozen(
  tx: Client,
  remedyId: string,
  row: OfferedRow,
): Promise<boolean> {
  const { count } = await tx.sessionRemedy.updateMany({
    where: { id: remedyId, status: 'frozen' },
    data: { kind: 'makeup', ...row },
  });
  return count === 1;
}

/** A session the sweep may owe an offer, as its due read finds it. */
export interface DueOffer {
  readonly sessionId: string;
}

/**
 * The sessions owing a remedy that have none, in id order after `after`, at most `limit`: a
 * Teacher-No-Show or Both-No-Show whose scheduled end is at or before `endedBy` (the run's instant
 * less `dispute_window_hours`), and every Cancelled-By-Agreement session (F8). No lock.
 */
export async function dueForOffer(
  tx: Client,
  endedBy: Date,
  after: string | undefined,
  limit: number,
): Promise<readonly DueOffer[]> {
  const rows = await tx.session.findMany({
    where: {
      deletedAt: null,
      remedy: null,
      OR: [
        { status: { in: ['teacher_no_show', 'both_no_show'] }, scheduledEndAt: { lte: endedBy } },
        { status: 'cancelled_by_agreement' },
      ],
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true },
  });
  return rows.map(({ id }) => ({ sessionId: id }));
}

/** The `frozen` remedies' sessions and students, in remedy id order after `after`. No lock. */
export async function frozenRemedies(
  tx: Client,
  after: string | undefined,
  limit: number,
): Promise<readonly { remedyId: string; sessionId: string; studentUserId: string }[]> {
  const rows = await tx.sessionRemedy.findMany({
    where: {
      status: 'frozen',
      session: { deletedAt: null },
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, sessionId: true, session: { select: { studentUserId: true } } },
  });
  return rows.map(({ id, sessionId, session }) => ({
    remedyId: id,
    sessionId,
    studentUserId: session.studentUserId,
  }));
}

/**
 * Of `enrollmentIds`, those whose every session (at least one) has an outcome no longer waiting:
 * none `scheduled`, `disputed`, `under_threshold` or `provider_outage`. The sweep's completion
 * candidates (T015's check decides the rest). No lock.
 */
export async function enrollmentsSettledAmong(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<readonly string[]> {
  if (enrollmentIds.length === 0) return [];
  const [withSessions, waiting] = await Promise.all([
    tx.session.findMany({
      where: { enrollmentId: { in: [...enrollmentIds] }, deletedAt: null },
      distinct: ['enrollmentId'],
      select: { enrollmentId: true },
    }),
    tx.session.findMany({
      where: {
        enrollmentId: { in: [...enrollmentIds] },
        deletedAt: null,
        status: { in: ['scheduled', 'disputed', 'under_threshold', 'provider_outage'] },
      },
      distinct: ['enrollmentId'],
      select: { enrollmentId: true },
    }),
  ]);
  const blocked = new Set(waiting.map(({ enrollmentId }) => enrollmentId));
  return withSessions
    .map(({ enrollmentId }) => enrollmentId)
    .filter((id) => !blocked.has(id))
    .sort();
}

/** A remedy as `sessions.get` shows it (app-surface.md, `RemedyView`). */
export interface RemedyViewRow {
  readonly id: string;
  readonly status: RemedyRowStatus;
  readonly kind: 'makeup' | 'refund';
  readonly offeredAt: Date;
  readonly choiceClosesAt: Date;
  readonly proposedDate: Date | null;
  readonly counterDate: Date | null;
  readonly counterStartTimeLocal: Date | null;
  readonly counterTimezone: string | null;
  readonly counterProposedAt: Date | null;
  readonly snapshotAnswerWindowHours: number;
  /** The make-up booked for it, the latest by id; null while none is. */
  readonly makeupSessionId: string | null;
}

/** The session's remedy with its make-up, for `sessions.get`; null when it has none. */
export async function remedyViewRowOf(
  tx: Client,
  sessionId: string,
): Promise<RemedyViewRow | null> {
  const [remedy, makeup] = await Promise.all([
    tx.sessionRemedy.findUnique({
      where: { sessionId },
      select: {
        id: true,
        status: true,
        kind: true,
        offeredAt: true,
        choiceClosesAt: true,
        proposedDate: true,
        counterDate: true,
        counterStartTimeLocal: true,
        counterTimezone: true,
        counterProposedAt: true,
        snapshotAnswerWindowHours: true,
      },
    }),
    tx.session.findFirst({
      where: { makeupForSessionId: sessionId, deletedAt: null },
      orderBy: { id: 'desc' },
      select: { id: true },
    }),
  ]);
  return remedy === null ? null : { ...remedy, makeupSessionId: makeup?.id ?? null };
}

/** Of `sessionIds`, each one's remedy status, a `lapsed` one left out (never shown). */
export async function remedyStatusesAmong(
  tx: Client,
  sessionIds: readonly string[],
): Promise<ReadonlyMap<string, Exclude<RemedyRowStatus, 'lapsed'>>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await tx.sessionRemedy.findMany({
    where: { sessionId: { in: [...sessionIds] }, status: { not: 'lapsed' } },
    select: { sessionId: true, status: true },
  });
  return new Map(
    rows.map(({ sessionId, status }) => [sessionId, status as Exclude<RemedyRowStatus, 'lapsed'>]),
  );
}
