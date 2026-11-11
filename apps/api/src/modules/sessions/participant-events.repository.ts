// T012 (FR-440; R-SESS-1; research R-304; contracts/video.md, "The webhook"): the video webhook's
// queries over `session_participant_events`, on the caller's transaction. The webhook only records:
// it reads a session's two participants, takes the participant's account `FOR KEY SHARE` through the
// kernel's `keyShareRows` (contracts/kernel.md's two `POST /webhooks/video` rows), and inserts one
// row under the provider's unique event id. A replay is the database's refusal by
// `session_participant_events_provider_event_id_key`, which the caller names (`db-errors.ts`). The
// table is append-only (UPDATE, DELETE and TRUNCATE revoked from the application role), so nothing
// here changes a row once written.
//
// T065 (app-surface.md, `sessions.get`'s `counterpartyInRoom`; research R-304, R-324 item 6): the
// presence read, `inRoomOf`, over the same rows with no lock: whether a person has a `joined`
// connection with no `left` for its `connection_ref` at or after it and no `room_ended` at or after
// it. A tie to the second ends the connection, as the attendance rules read one
// (`attendance.rules.ts`, `connectionSpans`), the provider's instants being whole seconds (R-304).
import type { Transaction } from '../../platform/db/prisma.repository.js';

export { keyShareRows } from '../../platform/db/row-lock.js';

/** A session's two participants, the only identities its events may carry, and its enrollment. */
export interface SessionParties {
  readonly teacherUserId: string;
  readonly studentUserId: string;
  /** T065: what the `session` signal names beside the session. */
  readonly enrollmentId: string;
}

/**
 * The two participants of the session `sessionId` and its enrollment, or null when there is none (a
 * soft-deleted one left out by the client's extension, T148). No lock: a session's participants and
 * enrollment never change, and the insert's foreign key takes the session's key-share itself.
 */
export async function participantIdsOfSession(
  tx: Pick<Transaction, 'session'>,
  sessionId: string,
): Promise<SessionParties | null> {
  return tx.session.findUnique({
    where: { id: sessionId },
    select: { teacherUserId: true, studentUserId: true, enrollmentId: true },
  });
}

/**
 * T065: whether `userId` is in the room of the session `sessionId` by R-304's per-connection rule,
 * from the recorded events alone (no provider call). No lock; over the `session_id` index, bounded
 * by what the webhook recorded for the session, as the evaluation's read is.
 */
export async function inRoomOf(
  tx: Pick<Transaction, 'sessionParticipantEvent'>,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx.sessionParticipantEvent.findMany({
    where: { sessionId, OR: [{ userId }, { eventType: 'room_ended' }] },
    select: { eventType: true, userId: true, connectionRef: true, occurredAt: true },
  });
  const ended = rows.filter((row) => row.eventType === 'room_ended');
  const left = rows.filter((row) => row.eventType === 'left' && row.userId === userId);
  const endedFrom = (joinedAt: Date, among: readonly { readonly occurredAt: Date }[]) =>
    among.some(({ occurredAt }) => occurredAt.getTime() >= joinedAt.getTime());
  return rows.some(
    (joined) =>
      joined.eventType === 'joined' &&
      joined.userId === userId &&
      !endedFrom(joined.occurredAt, ended) &&
      !endedFrom(
        joined.occurredAt,
        left.filter(({ connectionRef }) => connectionRef === joined.connectionRef),
      ),
  );
}

/** One attendance event as it is stored (data-model §2.2; R-304's table). */
export interface ParticipantEventRow {
  readonly providerEventId: string;
  readonly sessionId: string;
  readonly eventType: 'joined' | 'left' | 'room_ended';
  /** NULL exactly for `room_ended` (ERD §15 rule 41). */
  readonly userId: string | null;
  /** NULL exactly for `room_ended` (ERD §15 rule 41). */
  readonly connectionRef: string | null;
  /** The provider's instant (R-TIME-6). */
  readonly occurredAt: Date;
}

/**
 * Inserts the event. A provider event id already recorded is refused by the unique index
 * `session_participant_events_provider_event_id_key`, which the caller reads as a replay.
 */
export async function insertParticipantEvent(
  tx: Pick<Transaction, 'sessionParticipantEvent'>,
  row: ParticipantEventRow,
): Promise<void> {
  await tx.sessionParticipantEvent.create({ data: row, select: { id: true } });
}
