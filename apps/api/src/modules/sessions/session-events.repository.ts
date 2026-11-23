// T004 of specs/004-sessions/tasks.md (FR-495; research R-315; data-model.md §2.4): sessions' one
// writer of `session_events` rows, the append-only record of each event a later notification reads.
// Every task that writes such a row writes it here, in the transaction that made the event. The
// table is append-only for the application role (ERD §15 rule 43), so nothing here updates or
// deletes a row; what each kind carries (a counter-proposal's four columns, a case, the outcomes, a
// previous start, no session on a complaint) is the database's check.
//
// No lock (contracts/kernel.md's general rule): a row references its enrollment, its session and,
// for some kinds, a case and a slot; the caller holds the enrollment's lock, and the session's where
// it changed it, taken in the one order before it decided on the event. A row references no account.
//
// 004:T084 (SRS DEC-105; ERD changelog row 78, §15 rule 84): an `encryption_failed` row names the
// side whose phone could not encrypt, `party`, set on that kind only (the database's check).
// `lockEventsEnrollment` is the enrollment's lock such a writer takes first (kernel.md's general
// rule: a path inserting a `session_events` row always takes the enrollment), for a path that
// changes no enrollment and no session and so holds no other lock on them.
import type { Prisma } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

/** `session_event_kind` (data-model.md §2.4's twenty-five kinds). */
export type SessionEventKind = Prisma.SessionEventCreateManyInput['kind'];

/** The outcome a revision or a correction replaced and the one it wrote. */
export type RecordedOutcome = 'done' | 'student_no_show' | 'teacher_no_show' | 'both_no_show';

/** One event as its row records it; `occurredAt` is the instant of the transaction that made it. */
export interface SessionEventRecord {
  readonly enrollmentId: string;
  /** NULL exactly on `complaint_raised` and `complaint_decided`. */
  readonly sessionId: string | null;
  readonly kind: SessionEventKind;
  readonly caseId?: string | null;
  readonly counterSlotId?: string;
  readonly counterDate?: Date;
  readonly counterStartTimeLocal?: Date;
  readonly counterTimezone?: string;
  readonly outcomeBefore?: RecordedOutcome;
  readonly outcomeAfter?: RecordedOutcome;
  readonly previousStartAt?: Date;
  /** T084: on `encryption_failed` only, the side whose phone could not encrypt (rule 84). */
  readonly party?: 'student' | 'teacher';
  readonly occurredAt: Date;
}

/** T084: the enrollment an event is recorded on, `FOR UPDATE`, before the event's insert. */
export async function lockEventsEnrollment(tx: Transaction, enrollmentId: string): Promise<void> {
  await lockRows(tx, 'enrollments', [enrollmentId]);
}

/** Writes one row per event, in one statement on the caller's transaction; none for none. */
export async function recordSessionEvents(
  tx: Pick<Transaction, 'sessionEvent'>,
  events: readonly SessionEventRecord[],
): Promise<void> {
  if (events.length === 0) return;
  await tx.sessionEvent.createMany({ data: events.map((event) => ({ ...event })) });
}

/** T084: one session's phone that could not encrypt, its side and when (rule 84 sets `party`). */
export interface EncryptionFailureRow {
  readonly party: 'student' | 'teacher';
  readonly occurredAt: Date;
}

/**
 * T084 (SRS DEC-105; Q-C1-2 (a)): the session's `encryption_failed` rows, oldest first, with no lock,
 * for a dispute's evidence. The session's index finds them; the report's limit (DEC-106) bounds them.
 */
export async function encryptionFailuresOf(
  tx: Pick<Transaction, 'sessionEvent'>,
  sessionId: string,
): Promise<readonly EncryptionFailureRow[]> {
  const rows = await tx.sessionEvent.findMany({
    where: { sessionId, kind: 'encryption_failed' },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { party: true, occurredAt: true },
  });
  return rows.flatMap(({ party, occurredAt }) => (party === null ? [] : [{ party, occurredAt }]));
}
