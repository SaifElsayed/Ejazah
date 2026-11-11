// T014 of specs/004-sessions/tasks.md (FR-441, FR-446, FR-447, FR-450, FR-482, FR-495; R-SESS-2,
// R-SESS-3, R-SESS-6; research R-306, R-308, R-313, R-323 GAP-7; contracts/kernel.md, "Jobs" and the
// evaluation's row): what the `evaluate-sessions` sweep runs every minute (`jobs/evaluate-sessions.ts`).
//
// THE SESSIONS DUE (R-306, R-SESS-2, R-SESS-3). Each run reads `session_evaluation_delay_minutes`
// and the four attendance settings, then the sessions with `evaluated_at` NULL, `status` `scheduled`
// or `disputed` and `scheduled_end_at` + the delay at or before the database's clock
// (`clockTimestamp`), a page at a time in id order. Never a webhook's reaction: a session whose
// final webhook never arrives is settled by the first run after its end plus the delay (SC-403).
//
// EACH IN ITS OWN TRANSACTION (contracts/kernel.md, "evaluation"; T005's one order). The enrollment
// (`EnrollmentSide.lockEnrollments`), then the session, then the session read again under them:
// left as it is when already evaluated, no longer `scheduled` or `disputed`, or no longer due, its
// end moved by a re-resolution that committed first (never before the end plus the delay, by the
// clock read under the locks). Then T013's outcome (`evaluateAttendance`) from the session's
// recorded `session_participant_events` and the `provider_outages` windows overlapping it; one
// conditional update writes `status`, or `outcome_under_dispute` when the session is disputed
// (R-308: a dispute raised before the evaluation), with `simultaneous_connected_seconds` once and
// `evaluated_at`; one `session_events` row `settled` through T004's writer; then T015's completion
// check, the only check (no count is checked: no settlement ends an enrollment, R-322). Nothing
// moves a session out of `under_threshold`, `provider_outage` or `disputed` (FR-446): none of them
// is selected but a disputed one never evaluated, and that one keeps its status.
//
// A ROOM ENDED (FR-482; research R-313; the notes under T014, K5 and K6). The same run ends, through
// `endRoom` alone, the room of every cancelled session (`cancelled_by_agreement`,
// `cancelled_by_admin`) still inside its join period (from its start less `early_join_lead_minutes`
// until its end, by the database's clock) that has no `room_ended` row in
// `session_participant_events`. Until that event arrives a later run calls `endRoom` again, which
// changes nothing (the LiveKit adapter takes the provider's `not_found` as success), and the calls
// stop when the join period ends. No `removeParticipant` (K5). The call is outside any transaction.
//
// THE LOG (the owner's rule; research R-323, GAP-7). Each settlement, an automatic action, writes
// one info line `{ sessionId, outcome }` after its commit; a session not settled because another
// path got there first writes none. A completion T015's check made on that transaction writes one
// more, «Enrollment completed» `{ enrollmentId }`, after the same commit, so a rolled-back session
// leaves neither and a completion postponed none (PR #129's review, round 1, Minor 3). Each `endRoom` call writes one info line `video room ended` with
// exactly `{ sessionId }`, never a token, a name or an address, and no row (the provider's
// `room_ended` event stays the record). A session whose evaluation fails writes one error line
// `{ sessionId }` and is reported to error tracking, and the run goes on to the next, which a later
// run retries; a failed `endRoom` one warn line `{ sessionId, reason }`, reported.
import { addMinutes, type Interval } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { VideoPort } from '../../platform/ports/video/video.port.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type AttendanceEvent,
  type AttendanceOutcome,
  type AttendanceSettings,
  evaluateAttendance,
} from './attendance.rules.js';
import type { Completion } from './completion.service.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import {
  attendanceEventsOf,
  cancelledInJoinPeriod,
  dueForEvaluation,
  type SessionToSettle,
  sessionToSettle,
  settle,
  type Settlement,
} from './evaluation.repository.js';
import { outagesOverlapping } from './outages.repository.js';
import { lockRows } from './remaining-sessions.repository.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';

export type { SessionToSettle, Settlement } from './evaluation.repository.js';

/** Minutes after the scheduled end before a session is evaluated (SRS §3.14, R-SESS-2). */
export const EVALUATION_DELAY_SETTING = 'session_evaluation_delay_minutes';

/**
 * The four attendance settings (SRS §3.14, FR-442 to FR-444), by the rules' names; T033's telemetry
 * reads the same four (the owner's decision of 2026-11-11 on lane A's questions, item 4).
 */
export const ATTENDANCE_SETTINGS = {
  joinWindowMinutes: 'join_window_minutes',
  minimumConnectionSeconds: 'minimum_connection_seconds',
  attendanceThresholdPct: 'attendance_threshold_pct',
  earlyJoinLeadMinutes: 'early_join_lead_minutes',
} as const satisfies Record<keyof AttendanceSettings, string>;

const wholeNonNegative = z.int().nonnegative();
const positive = z.number().positive();

/** A session the read of the due ones answers: its id and its enrollment's. */
export interface DueSession {
  readonly id: string;
  readonly enrollmentId: string;
}

/** What the evaluation reads and writes, each on the caller's transaction. */
export interface EvaluationStore {
  /** The sessions due by `dueBy`, in id order after `after`, at most `limit`; no lock. */
  dueForEvaluation(
    tx: Transaction,
    dueBy: Date,
    after: string | undefined,
    limit: number,
  ): Promise<readonly DueSession[]>;
  /** Locks the sessions' rows, `FOR UPDATE`, in id order, in one statement. */
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** The session as the settlement decides on it, read under the caller's locks. */
  sessionToSettle(tx: Transaction, id: string): Promise<SessionToSettle | null>;
  /** The session's recorded `session_participant_events`, as T013 reads them. */
  attendanceEventsOf(tx: Transaction, sessionId: string): Promise<readonly AttendanceEvent[]>;
  /** The `provider_outages` windows overlapping `window`. */
  outagesOverlapping(tx: Transaction, window: Interval): Promise<readonly Interval[]>;
  /** The conditional update; whether it moved the row. */
  settle(tx: Transaction, settlement: Settlement): Promise<boolean>;
  /** T004's writer of `session_events` rows. */
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
  /**
   * The cancelled sessions whose join period holds `at` (a start at or before `joinOpensBy`, `at`
   * plus the early-join lead, and an end after `at`) and that have no `room_ended` row, by id.
   */
  cancelledInJoinPeriod(tx: Transaction, at: Date, joinOpensBy: Date): Promise<readonly string[]>;
}

/** The evaluation's store over sessions' tables. */
export const evaluationStore: EvaluationStore = {
  dueForEvaluation,
  lockSessions: (tx, ids) => lockRows(tx, 'sessions', ids),
  sessionToSettle,
  attendanceEventsOf,
  outagesOverlapping,
  settle,
  recordEvents: recordSessionEvents,
  cancelledInJoinPeriod,
};

/** What a run settled and what failed, by session id. */
export interface EvaluationRun {
  readonly settled: readonly string[];
  readonly failed: readonly string[];
}

export interface Evaluation {
  /** Settles every session due, each in its own transaction (this file's head). */
  settleDue(): Promise<EvaluationRun>;
  /** Ends the room of every cancelled session in its join period with no `room_ended` row. */
  endCancelledRooms(): Promise<readonly string[]>;
}

/** What one settlement wrote, for its line after the commit. */
interface Settled {
  readonly outcome: AttendanceOutcome;
  readonly disputed: boolean;
  /** T015's check completed the enrollment on the same transaction. */
  readonly completed: boolean;
}

export function createEvaluation({
  transactions,
  enrollments,
  completion,
  video,
  settings,
  log,
  pageSize,
  report = reportError,
  clock = clockTimestamp,
  store = evaluationStore,
}: {
  readonly transactions: Transactions;
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments'>;
  readonly completion: Completion;
  readonly video: Pick<VideoPort, 'endRoom'>;
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** How many due sessions are read at a time (the job's). */
  readonly pageSize: number;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
  /** The database's clock on a transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: EvaluationStore;
}): Evaluation {
  const dueByOf = (at: Date, delayMinutes: number): Date => new Date(addMinutes(at, -delayMinutes));

  const attendanceSettings = async (): Promise<AttendanceSettings> => ({
    joinWindowMinutes: await settings.read(ATTENDANCE_SETTINGS.joinWindowMinutes, wholeNonNegative),
    minimumConnectionSeconds: await settings.read(
      ATTENDANCE_SETTINGS.minimumConnectionSeconds,
      wholeNonNegative,
    ),
    attendanceThresholdPct: await settings.read(
      ATTENDANCE_SETTINGS.attendanceThresholdPct,
      positive,
    ),
    earlyJoinLeadMinutes: await settings.read(
      ATTENDANCE_SETTINGS.earlyJoinLeadMinutes,
      wholeNonNegative,
    ),
  });

  /** One session on its own transaction; what it wrote, or undefined when it wrote nothing. */
  const settleOne = (
    due: DueSession,
    delayMinutes: number,
    rules: AttendanceSettings,
  ): Promise<Settled | undefined> =>
    transactions.run(async (tx) => {
      await enrollments.lockEnrollments(tx, [due.enrollmentId]);
      await store.lockSessions(tx, [due.id]);
      const session = await store.sessionToSettle(tx, due.id);
      if (session === null || session.evaluatedAt !== null) return undefined;
      if (session.status !== 'scheduled' && session.status !== 'disputed') return undefined;
      const at = await clock(tx);
      if (session.scheduledEndAt.getTime() > dueByOf(at, delayMinutes).getTime()) return undefined;

      const window = { startsAt: session.scheduledStartAt, endsAt: session.scheduledEndAt };
      const events = await store.attendanceEventsOf(tx, session.id);
      const outages = await store.outagesOverlapping(tx, window);
      const attendance = evaluateAttendance(
        events,
        {
          ...window,
          teacherUserId: session.teacherUserId,
          studentUserId: session.studentUserId,
          outages,
        },
        rules,
      );
      const moved = await store.settle(tx, {
        id: session.id,
        from: session.status,
        outcome: attendance.outcome,
        simultaneousSeconds: attendance.simultaneousSeconds,
        evaluatedAt: at,
      });
      if (!moved) return undefined;
      await store.recordEvents(tx, [
        {
          enrollmentId: session.enrollmentId,
          sessionId: session.id,
          kind: 'settled',
          occurredAt: at,
        },
      ]);
      const completed = await completion.completeIfDue(tx, session.enrollmentId);
      return { outcome: attendance.outcome, disputed: session.status === 'disputed', completed };
    });

  return {
    settleDue: async () => {
      const delayMinutes = await settings.read(EVALUATION_DELAY_SETTING, wholeNonNegative);
      const rules = await attendanceSettings();
      const dueBy = dueByOf(await transactions.run((tx) => clock(tx)), delayMinutes);
      const settled: string[] = [];
      const failed: string[] = [];
      let after: string | undefined;
      for (;;) {
        const page = await transactions.run((tx) =>
          store.dueForEvaluation(tx, dueBy, after, pageSize),
        );
        for (const due of page) {
          try {
            const written = await settleOne(due, delayMinutes, rules);
            if (written === undefined) continue;
            settled.push(due.id);
            log.info(
              { sessionId: due.id, outcome: written.outcome },
              written.disputed ? 'Session evaluated under dispute' : 'Session settled',
            );
            if (written.completed) {
              log.info({ enrollmentId: due.enrollmentId }, 'Enrollment completed');
            }
          } catch (error: unknown) {
            failed.push(due.id);
            log.error({ sessionId: due.id }, 'Session evaluation failed');
            report(error instanceof Error ? error : new Error(String(error)));
          }
        }
        if (page.length < pageSize) break;
        after = page.at(-1)?.id;
      }
      return { settled, failed };
    },

    endCancelledRooms: async () => {
      const leadMinutes = await settings.read(
        ATTENDANCE_SETTINGS.earlyJoinLeadMinutes,
        wholeNonNegative,
      );
      const sessionIds = await transactions.run(async (tx) => {
        const at = await clock(tx);
        return store.cancelledInJoinPeriod(tx, at, new Date(addMinutes(at, leadMinutes)));
      });
      const ended: string[] = [];
      for (const sessionId of sessionIds) {
        try {
          await video.endRoom(sessionId);
        } catch (error: unknown) {
          log.warn({ sessionId, reason: 'end_room_failed' }, 'video room not ended');
          report(error instanceof Error ? error : new Error(String(error)));
          continue;
        }
        ended.push(sessionId);
        log.info({ sessionId }, 'video room ended');
      }
      return ended;
    },
  };
}
