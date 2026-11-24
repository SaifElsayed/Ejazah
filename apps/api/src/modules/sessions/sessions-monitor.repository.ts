// T024 of specs/004-sessions/tasks.md (FR-479; research R-323 GAP-1 and GAP-4; contracts/
// admin-surface.md, `sessions.monitor.list/get`): the monitor's reads of sessions' own tables, each on
// the caller's transaction, with no lock and no write: nothing is decided on what they answer. A
// soft-deleted session is left out by the client's extension (T148), as from every ordinary read.
//
// Bounded: an enrollment's sessions, events and requests by one enrollment (its package's count,
// make-ups included), over the plain indexes on `sessions.enrollment_id`'s unique pair,
// `session_events.enrollment_id` and `cancellation_requests.session_id`. The date filter's read is the
// one exception: no index covers `scheduled_date_local` and its answer grows with the range (R-DB-9:
// no index without a measured slow query; the follow-up under T024, measured in Phase 6).
import type { SessionStatus } from '@ijazah/contracts';
import { calendarDateOf, dateColumnOf, type LocalDate, localTimeOf } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SessionEventKind } from './session-events.repository.js';
import type { EnrollmentSessionRow } from './sessions.repository.js';

/** The enrollment ids of the sessions whose local date falls within `[from, to]`, each end optional. */
export async function enrollmentIdsWithSessionsBetween(
  tx: Pick<Transaction, 'session'>,
  { from, to }: { readonly from?: LocalDate; readonly to?: LocalDate },
): Promise<string[]> {
  const rows = await tx.session.findMany({
    where: {
      scheduledDateLocal: {
        ...(from === undefined ? {} : { gte: dateColumnOf(from) }),
        ...(to === undefined ? {} : { lte: dateColumnOf(to) }),
      },
    },
    distinct: ['enrollmentId'],
    select: { enrollmentId: true },
  });
  return rows.map(({ enrollmentId }) => enrollmentId);
}

/** A session's remedy as the monitor reads it (data-model.md §2.3). */
export interface MonitoredRemedyRow {
  readonly id: string;
  readonly kind: 'makeup' | 'refund';
  readonly status:
    | 'awaiting_choice'
    | 'proposed'
    | 'counter_proposed'
    | 'booked'
    | 'refund_case'
    | 'frozen'
    | 'lapsed';
  readonly offeredAt: Date;
  readonly choiceClosesAt: Date;
  readonly proposedDate: LocalDate | null;
  readonly snapshotAnswerWindowHours: number;
  readonly snapshotFirstSessionLeadHours: number;
  /** The pending counter-proposal: all four set, or none (ERD §15 rule 42). */
  readonly counter: {
    readonly date: LocalDate;
    readonly startTimeLocal: string;
    readonly timezone: string;
    readonly proposedAt: Date;
  } | null;
  readonly caseId: string | null;
  readonly decidedAt: Date | null;
}

/** One session of the enrollment with its remedy and the session it makes up for. */
export interface MonitoredSessionRow extends EnrollmentSessionRow {
  readonly makeupFor: { readonly sessionId: string; readonly sequenceNumber: number } | null;
  readonly remedy: MonitoredRemedyRow | null;
}

/** The enrollment's sessions by sequence number, each with its remedy, in one statement. */
export async function monitoredSessionsOf(
  tx: Pick<Transaction, 'session'>,
  enrollmentId: string,
): Promise<MonitoredSessionRow[]> {
  const rows = await tx.session.findMany({
    where: { enrollmentId },
    orderBy: { sequenceNumber: 'asc' },
    select: {
      id: true,
      sequenceNumber: true,
      scheduledDateLocal: true,
      scheduledStartTimeLocal: true,
      timezone: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      status: true,
      outcomeUnderDispute: true,
      makeupForSessionId: true,
      remedy: {
        select: {
          id: true,
          kind: true,
          status: true,
          offeredAt: true,
          choiceClosesAt: true,
          proposedDate: true,
          snapshotAnswerWindowHours: true,
          snapshotFirstSessionLeadHours: true,
          counterDate: true,
          counterStartTimeLocal: true,
          counterTimezone: true,
          counterProposedAt: true,
          caseId: true,
          decidedAt: true,
        },
      },
    },
  });
  // A make-up's original is a session of the same enrollment (ADR 0018 D3), so it is among the rows
  // read; one soft-deleted since is not, and the make-up then names none.
  const sequenceOf = new Map(rows.map(({ id, sequenceNumber }) => [id, sequenceNumber] as const));
  return rows.map((row) => {
    const original =
      row.makeupForSessionId === null ? undefined : sequenceOf.get(row.makeupForSessionId);
    return {
      id: row.id,
      sequenceNumber: row.sequenceNumber,
      localDate: calendarDateOf(row.scheduledDateLocal),
      startTimeLocal: localTimeOf(row.scheduledStartTimeLocal),
      timezone: row.timezone,
      startsAt: row.scheduledStartAt,
      endsAt: row.scheduledEndAt,
      status: row.status,
      ...(row.outcomeUnderDispute === null ? {} : { outcomeUnderDispute: row.outcomeUnderDispute }),
      makeupFor:
        row.makeupForSessionId === null || original === undefined
          ? null
          : { sessionId: row.makeupForSessionId, sequenceNumber: original },
      remedy: row.remedy === null ? null : remedyRowOf(row.remedy),
    };
  });
}

function remedyRowOf(remedy: {
  readonly id: string;
  readonly kind: MonitoredRemedyRow['kind'];
  readonly status: MonitoredRemedyRow['status'];
  readonly offeredAt: Date;
  readonly choiceClosesAt: Date;
  readonly proposedDate: Date | null;
  readonly snapshotAnswerWindowHours: number;
  readonly snapshotFirstSessionLeadHours: number;
  readonly counterDate: Date | null;
  readonly counterStartTimeLocal: Date | null;
  readonly counterTimezone: string | null;
  readonly counterProposedAt: Date | null;
  readonly caseId: string | null;
  readonly decidedAt: Date | null;
}): MonitoredRemedyRow {
  const { counterDate, counterStartTimeLocal, counterTimezone, counterProposedAt } = remedy;
  return {
    id: remedy.id,
    kind: remedy.kind,
    status: remedy.status,
    offeredAt: remedy.offeredAt,
    choiceClosesAt: remedy.choiceClosesAt,
    proposedDate: remedy.proposedDate === null ? null : calendarDateOf(remedy.proposedDate),
    snapshotAnswerWindowHours: remedy.snapshotAnswerWindowHours,
    snapshotFirstSessionLeadHours: remedy.snapshotFirstSessionLeadHours,
    counter:
      counterDate === null ||
      counterStartTimeLocal === null ||
      counterTimezone === null ||
      counterProposedAt === null
        ? null
        : {
            date: calendarDateOf(counterDate),
            startTimeLocal: localTimeOf(counterStartTimeLocal),
            timezone: counterTimezone,
            proposedAt: counterProposedAt,
          },
    caseId: remedy.caseId,
    decidedAt: remedy.decidedAt,
  };
}

/** One `session_events` row of the enrollment, with the columns its kind sets. */
export interface SessionEventRow {
  readonly sessionId: string | null;
  readonly kind: SessionEventKind;
  readonly caseId: string | null;
  readonly outcomeBefore: SessionStatus | null;
  readonly outcomeAfter: SessionStatus | null;
  readonly previousStartAt: Date | null;
  /** 004:T084: on `encryption_failed` only, the side whose phone could not encrypt (rule 84). */
  readonly party: 'student' | 'teacher' | null;
  readonly occurredAt: Date;
}

/** The enrollment's `session_events`, newest first, the id breaking a tie of one instant. */
export function sessionEventsOf(
  tx: Pick<Transaction, 'sessionEvent'>,
  enrollmentId: string,
): Promise<SessionEventRow[]> {
  return tx.sessionEvent.findMany({
    where: { enrollmentId },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    select: {
      sessionId: true,
      kind: true,
      caseId: true,
      outcomeBefore: true,
      outcomeAfter: true,
      previousStartAt: true,
      party: true,
      occurredAt: true,
    },
  });
}

/** One cancellation request of the enrollment's sessions, as its row records it. */
export interface CancellationRequestRow {
  readonly id: string;
  readonly sessionId: string;
  readonly requestedBy: 'student' | 'teacher';
  readonly reason: string;
  readonly status: 'pending' | 'accepted' | 'declined' | 'expired';
  readonly createdAt: Date;
  readonly respondedAt: Date | null;
}

/**
 * The cancellation requests of the enrollment's sessions, newest first by their time-ordered id;
 * the requester named by the side of the session they are on. Read only: T021 owns their writes.
 */
export async function cancellationRequestsOf(
  tx: Pick<Transaction, 'cancellationRequest'>,
  enrollmentId: string,
): Promise<CancellationRequestRow[]> {
  const rows = await tx.cancellationRequest.findMany({
    where: { session: { enrollmentId, deletedAt: null } },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      sessionId: true,
      requestedByUserId: true,
      reason: true,
      status: true,
      createdAt: true,
      respondedAt: true,
      session: { select: { studentUserId: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    requestedBy: row.requestedByUserId === row.session.studentUserId ? 'student' : 'teacher',
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
    respondedAt: row.respondedAt,
  }));
}
