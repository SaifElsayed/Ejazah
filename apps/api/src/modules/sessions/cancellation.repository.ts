// T021 of specs/004-sessions (FR-456 to FR-458; research R-310; data-model.md §2.6): the queries of
// `cancellation_requests`, each on the caller's transaction. The rules (who may ask or answer, the
// locks, the order, the refusals) are `cancellation.service.ts`'. A request's session is read by its
// party together, so another person's request answers as a nonexistent one (R-GENDER-2).
//
// One pending request per session is the database's (ERD §15 rule 45,
// `cancellation_requests_one_pending_key`); an answer is a conditional update on the request still
// `pending`, and an acceptance's cancellation a conditional update on the session still
// `scheduled`, so a row another path moved meanwhile is left as it is. A soft-deleted session is
// left out by the client's extension (T148).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockKey, lockRows } from '../../platform/db/row-lock.js';

type Client = Pick<Transaction, 'cancellationRequest' | 'session' | 'sessionRemedy'>;

/** `cancellation_request_status` (ERD §5). */
export type CancellationRequestStatus = 'pending' | 'accepted' | 'declined' | 'expired';

/** A request as the service decides on it and as `sessions.get` shows it. */
export interface CancellationRequestRow {
  readonly id: string;
  readonly sessionId: string;
  readonly requestedByUserId: string;
  readonly reason: string;
  readonly status: CancellationRequestStatus;
}

/**
 * The request `requestId` when `userId` is a party of its session, else null: by the primary key,
 * the session's two parties in the same statement. No lock.
 */
export async function requestOfParty(
  tx: Pick<Client, 'cancellationRequest'>,
  requestId: string,
  userId: string,
): Promise<CancellationRequestRow | null> {
  return tx.cancellationRequest.findFirst({
    where: {
      id: requestId,
      session: { deletedAt: null, OR: [{ studentUserId: userId }, { teacherUserId: userId }] },
    },
    select: {
      id: true,
      sessionId: true,
      requestedByUserId: true,
      reason: true,
      status: true,
    },
  });
}

/** The request `id`, read again under the caller's locks. */
export async function requestById(
  tx: Pick<Client, 'cancellationRequest'>,
  id: string,
): Promise<CancellationRequestRow | null> {
  return tx.cancellationRequest.findUnique({
    where: { id },
    select: {
      id: true,
      sessionId: true,
      requestedByUserId: true,
      reason: true,
      status: true,
    },
  });
}

/** The session's pending request's id, else null; over rule 45's partial unique index. */
export async function pendingRequestOf(
  tx: Pick<Client, 'cancellationRequest'>,
  sessionId: string,
): Promise<string | null> {
  const found = await tx.cancellationRequest.findFirst({
    where: { sessionId, status: 'pending' },
    select: { id: true },
  });
  return found?.id ?? null;
}

/**
 * The session's latest request, by id (uuidv7, so the newest), whatever its status, for
 * `sessions.get`; null when it has none. Over the `session_id` index, bounded by the session's
 * requests (one pending at a time).
 */
export async function latestRequestOf(
  tx: Pick<Client, 'cancellationRequest'>,
  sessionId: string,
): Promise<CancellationRequestRow | null> {
  return tx.cancellationRequest.findFirst({
    where: { sessionId },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      sessionId: true,
      requestedByUserId: true,
      reason: true,
      status: true,
    },
  });
}

/**
 * Of `sessionIds`, those with a request pending at `at`: stored `pending`, its session still
 * `scheduled` and not started (FR-458: a request is expired from the start whatever its row says,
 * and over once its session is cancelled by another path), for the lists' `pendingCancellation`.
 * One statement over rule 45's partial unique index; bounded by the ids the caller holds.
 */
export async function pendingCancellationsAmong(
  tx: Pick<Client, 'cancellationRequest'>,
  sessionIds: readonly string[],
  at: Date,
): Promise<ReadonlySet<string>> {
  if (sessionIds.length === 0) return new Set();
  const rows = await tx.cancellationRequest.findMany({
    where: {
      sessionId: { in: [...sessionIds] },
      status: 'pending',
      session: { status: 'scheduled', scheduledStartAt: { gt: at } },
    },
    select: { sessionId: true },
  });
  return new Set(rows.map(({ sessionId }) => sessionId));
}

/** A new request, `pending`; its id. The database refuses a second pending one (rule 45). */
export async function insertRequest(
  tx: Pick<Client, 'cancellationRequest'>,
  row: { readonly sessionId: string; readonly requestedByUserId: string; readonly reason: string },
): Promise<string> {
  const { id } = await tx.cancellationRequest.create({
    data: { ...row, status: 'pending' },
    select: { id: true },
  });
  return id;
}

/** Writes the answer where the request is still `pending`; whether it moved the row. */
export async function answerRequest(
  tx: Pick<Client, 'cancellationRequest'>,
  id: string,
  answer: 'accepted' | 'declined',
  at: Date,
): Promise<boolean> {
  const { count } = await tx.cancellationRequest.updateMany({
    where: { id, status: 'pending' },
    data: { status: answer, respondedAt: at },
  });
  return count === 1;
}

/**
 * Sets the session `cancelled_by_agreement` where it is still `scheduled` (FR-457); whether it moved
 * the row. The status frees both parties' time (ERD §15 rule 19's exclusions leave it out).
 */
export async function cancelByAgreement(
  tx: Pick<Client, 'session'>,
  sessionId: string,
): Promise<boolean> {
  const { count } = await tx.session.updateMany({
    where: { id: sessionId, status: 'scheduled' },
    data: { status: 'cancelled_by_agreement' },
  });
  return count === 1;
}

/**
 * Locks the session's remedy rows, `FOR UPDATE`, in kernel.md's «cancellation accepted» place
 * (after the session, before the request). The remedy is keyed by its session
 * (`session_remedies_session_id_key`) and every path that writes one locks the session first, so
 * the ids read under the session's lock stand; a scheduled session has none until the make-up an
 * acceptance owes is offered in this place (T028).
 */
export async function lockRemediesOf(tx: Transaction, sessionId: string): Promise<void> {
  const remedies = await tx.sessionRemedy.findMany({
    where: { sessionId },
    select: { id: true },
  });
  await lockRows(
    tx,
    'session_remedies',
    remedies.map(({ id }) => id),
  );
}

/** Locks requests `FOR UPDATE`, in id order, in one statement. */
export async function lockRequests(tx: Transaction, ids: readonly string[]): Promise<void> {
  await lockRows(tx, 'cancellation_requests', ids);
}

/** Locks sessions `FOR UPDATE`, in id order, in one statement. */
export async function lockSessions(tx: Transaction, ids: readonly string[]): Promise<void> {
  await lockRows(tx, 'sessions', ids);
}

/** The teacher's slots' advisory key, in its place of the one order (R-206). */
export async function lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void> {
  await lockKey(tx, 'teacher-slots', teacherUserId);
}

// ---------------------------------------------------------------------------------------------
// T022: `expire-cancellation-requests`' queries (FR-458; contracts/kernel.md, its row).
// ---------------------------------------------------------------------------------------------

/** A pending request whose session has started, as the sweep reads it with no lock. */
export interface DueRequest {
  readonly id: string;
  readonly sessionId: string;
  readonly enrollmentId: string;
}

/**
 * The pending requests whose session started at or before `at`, in id order after `after`, at most
 * `limit`; no lock. Over rule 45's partial unique index (the pending requests, one per session) and
 * the sessions' primary key; a session's start whatever its status, since a request is expired from
 * the start (FR-458).
 */
export async function dueForExpiry(
  tx: Pick<Client, 'cancellationRequest'>,
  at: Date,
  after: string | undefined,
  limit: number,
): Promise<readonly DueRequest[]> {
  const rows = await tx.cancellationRequest.findMany({
    where: {
      status: 'pending',
      session: { deletedAt: null, scheduledStartAt: { lte: at } },
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, sessionId: true, session: { select: { enrollmentId: true } } },
  });
  return rows.map(({ id, sessionId, session }) => ({
    id,
    sessionId,
    enrollmentId: session.enrollmentId,
  }));
}

/** A request as the sweep decides on it under its locks: its status and its session's start. */
export interface RequestToExpire extends DueRequest {
  readonly status: CancellationRequestStatus;
  readonly startsAt: Date;
}

/** The request `id` with its session's start, read again under the caller's locks. */
export async function requestToExpire(
  tx: Pick<Client, 'cancellationRequest'>,
  id: string,
): Promise<RequestToExpire | null> {
  const found = await tx.cancellationRequest.findFirst({
    where: { id, session: { deletedAt: null } },
    select: {
      id: true,
      sessionId: true,
      status: true,
      session: { select: { enrollmentId: true, scheduledStartAt: true } },
    },
  });
  return found === null
    ? null
    : {
        id: found.id,
        sessionId: found.sessionId,
        enrollmentId: found.session.enrollmentId,
        status: found.status,
        startsAt: found.session.scheduledStartAt,
      };
}

/**
 * Writes `expired` where the request is still `pending`; whether it moved the row. No
 * `responded_at`: an expiry is no answer (ERD §15 rule 45).
 */
export async function expireRequest(
  tx: Pick<Client, 'cancellationRequest'>,
  id: string,
): Promise<boolean> {
  const { count } = await tx.cancellationRequest.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'expired' },
  });
  return count === 1;
}
