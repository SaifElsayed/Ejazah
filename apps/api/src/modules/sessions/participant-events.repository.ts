// T012 (FR-440; R-SESS-1; research R-304; contracts/video.md, "The webhook"): the video webhook's
// queries over `session_participant_events`, on the caller's transaction. The webhook only records:
// it reads a session's two participants, takes the participant's account `FOR KEY SHARE` through the
// kernel's `keyShareRows` (contracts/kernel.md's two `POST /webhooks/video` rows), and inserts one
// row under the provider's unique event id. A replay is the database's refusal by
// `session_participant_events_provider_event_id_key`, which the caller names (`db-errors.ts`). The
// table is append-only (UPDATE, DELETE and TRUNCATE revoked from the application role), so nothing
// here changes a row once written.
import type { Transaction } from '../../platform/db/prisma.repository.js';

export { keyShareRows } from '../../platform/db/row-lock.js';

/** A session's two participants, the only identities its events may carry. */
export interface SessionParties {
  readonly teacherUserId: string;
  readonly studentUserId: string;
}

/**
 * The two participants of the session `sessionId`, or null when there is none (a soft-deleted one
 * left out by the client's extension, T148). No lock: a session's participants never change, and
 * the insert's foreign key takes the session's key-share itself.
 */
export async function sessionPartiesOf(
  tx: Pick<Transaction, 'session'>,
  sessionId: string,
): Promise<SessionParties | null> {
  return tx.session.findUnique({
    where: { id: sessionId },
    select: { teacherUserId: true, studentUserId: true },
  });
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
