// T015 of specs/004-sessions/tasks.md (FR-423, FR-424, FR-447, FR-448, FR-449, FR-486; SC-404;
// research R-309, R-322; plan.md decision 4; ADR 0023): an enrollment's completion, the one check
// every path that settles a session calls on its own transaction (the evaluation T014, an outage's
// record T016, a review or dispute resolution T033, T034) and `advance-remedies` calls again for the
// enrollments whose last window has closed (T028).
//
// WHEN (FR-449). A `confirmed` enrollment becomes `completed`, through `EnrollmentSide.complete`
// (booking writes the status and its one `enrollment_events` row `completed`), when all of these
// hold, read under the caller's locks:
//   - every session of it, make-ups included, has a settled outcome that is not frozen: `done`,
//     `student_no_show`, `teacher_no_show`, `both_no_show`, `cancelled_by_agreement` or
//     `cancelled_by_admin`. Not `scheduled`; not `disputed` (the outcome frozen beside it, R-308);
//     not `under_threshold` or `provider_outage`, which wait in the review queue for an
//     administrator's outcome (R-SESS-6) and may still owe a remedy;
//   - the last session's dispute window has closed: `dispute_window_hours` after the latest
//     scheduled end among the sessions that can be disputed (every one but the two cancellations,
//     FR-473), so a dispute can no longer reopen what the enrollment owes (plan.md decision 4);
//   - no remedy is owed: every session owed one (`teacher_no_show`, `both_no_show`,
//     `cancelled_by_agreement`, FR-462) has its remedy, and none is open (`awaiting_choice`,
//     `proposed`, `counter_proposed`, `frozen`); a `booked` remedy's make-up is a session of the
//     enrollment, so it is settled first; a `refund_case` is the case's to decide, no longer owed by
//     the enrollment, and `lapsed` owes nothing;
//   - no `student_suspended` compensation case is open on it (FR-486, plan.md decision 1),
//     moderation's rows read through its entry (R-301).
// An enrollment in any other state, or with no session, is left as it is.
//
// NO COUNT (FR-448, R-322, the owner's decision of 2026-11-05). Nothing here reads the
// Teacher-No-Show count or the repeated-absence mark, and no count ends an enrollment: an
// enrollment's absences each owe their remedy and it continues.
//
// THE SNAPSHOT (FR-424). The enrollment is read through `EnrollmentSide.enrollmentFor`, its
// snapshot's terms, never the package; nothing assumes every session of it was generated at once:
// the sessions read are whatever rows it has, the make-ups and a restore's sessions included.
//
// THE LOCKS (contracts/kernel.md, "evaluation, a review or dispute resolution"; T005's rules). The
// caller holds the enrollment's `enrollments` row (`EnrollmentSide.lockEnrollments`) and, before it,
// every lock its path takes in the one order; the sessions it settles after it. This takes no lock:
// every writer of the enrollment's sessions, remedies and cases takes the enrollment first, so what
// it reads cannot change under it (rule 1), and its one write, the move, touches the row held.
//
// THE CLOCK (the owner's decision of 2026-11-08 on lane D's questions, Q3). The window's close is
// compared with the database's clock, `clockTimestamp(tx)` (T002), as `evaluate-sessions` and the
// restore read it, never the process's; a reader injected so a unit spec can stand one in.
//
// THE LOG (the owner's rule and decision of 2026-11-08, Q2; PR #129's review, round 1, Minor 3).
// The completion is an automatic final action with one info line, `{ enrollmentId }` only, which
// the caller writes once `completeIfDue` answers true: the sweep after its transaction has
// committed (`evaluation.service.ts`), so a rolled-back session leaves no line; the outage record on
// its transaction (`outages.service.ts`; after its commit waits in the Not-scheduled row's item
// (13), the note under T063). This writes none. A completion postponed writes none, since the
// check runs every minute. The enrollment's
// `enrollment_events` row `completed` is its durable evidence.
import { addHours } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { openCaseOf } from '../moderation/index.js';
import {
  type CompletionSession,
  completionSessionsOf,
  type RemedyStatus,
} from './completion.repository.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { OPEN_REMEDY_STATUSES } from './remaining-sessions.repository.js';

/** The hours a participant may dispute a session after its scheduled end (SRS §3.14, FR-473). */
export const DISPUTE_WINDOW_SETTING = 'dispute_window_hours';

/** The window's schema: whole hours, at least one. */
export const disputeWindowHours = z.int().positive();

/** The outcomes completion takes as settled and not frozen (this file's head). */
const SETTLED: ReadonlySet<CompletionSession['status']> = new Set([
  'done',
  'student_no_show',
  'teacher_no_show',
  'both_no_show',
  'cancelled_by_agreement',
  'cancelled_by_admin',
]);

/** The two cancellations, never disputed (FR-473), so without a dispute window. */
const UNDISPUTABLE: ReadonlySet<CompletionSession['status']> = new Set([
  'cancelled_by_agreement',
  'cancelled_by_admin',
]);

/** The outcomes that owe a remedy (FR-462). */
const OWES_REMEDY: ReadonlySet<CompletionSession['status']> = new Set([
  'teacher_no_show',
  'both_no_show',
  'cancelled_by_agreement',
]);

/** A remedy not yet final (data-model.md §3, "An open remedy"), `frozen` included. */
const OPEN_REMEDY: ReadonlySet<RemedyStatus> = new Set(OPEN_REMEDY_STATUSES);

/** What completion reads, each on the caller's transaction with no lock. */
export interface CompletionStore {
  sessionsOf(tx: Transaction, enrollmentId: string): Promise<readonly CompletionSession[]>;
  /** Whether a `student_suspended` compensation case is open on the enrollment (moderation's). */
  studentSuspendedCaseOpen(tx: Transaction, enrollmentId: string): Promise<boolean>;
}

const completionStore: CompletionStore = {
  sessionsOf: completionSessionsOf,
  studentSuspendedCaseOpen: async (tx, enrollmentId) =>
    (await openCaseOf(tx, enrollmentId, 'student_suspended')) !== null,
};

export interface Completion {
  /**
   * Completes the enrollment when FR-449's conditions hold (this file's head), on the caller's
   * transaction after the enrollment's lock; whether it was completed now, for the caller's one
   * line «Enrollment completed» (this file's head, THE LOG).
   */
  completeIfDue(tx: Transaction, enrollmentId: string): Promise<boolean>;
}

/** Whether every session is settled and not frozen, and none awaits or holds an open remedy. */
function settledAndOwesNothing(sessions: readonly CompletionSession[]): boolean {
  return sessions.every(
    ({ status, remedyStatus }) =>
      SETTLED.has(status) &&
      (remedyStatus === undefined ? !OWES_REMEDY.has(status) : !OPEN_REMEDY.has(remedyStatus)),
  );
}

/** The latest scheduled end among the sessions that can be disputed; null when there is none. */
function lastDisputableEnd(sessions: readonly CompletionSession[]): Date | null {
  let last: Date | null = null;
  for (const { status, scheduledEndAt } of sessions) {
    if (UNDISPUTABLE.has(status)) continue;
    if (last === null || scheduledEndAt > last) last = scheduledEndAt;
  }
  return last;
}

/** Completion over the enrollment side, the dispute window read when the rest already holds. */
export function createCompletion({
  enrollments,
  settings,
  clock = clockTimestamp,
  store = completionStore,
}: {
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentFor' | 'complete'>;
  readonly settings: SettingsReader;
  /** The database's clock on the call's transaction (Q3); `clockTimestamp` in production. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: CompletionStore;
}): Completion {
  return {
    completeIfDue: async (tx, enrollmentId) => {
      const terms = await enrollments.enrollmentFor(tx, enrollmentId);
      if (terms?.status !== 'confirmed') return false;
      const sessions = await store.sessionsOf(tx, enrollmentId);
      if (sessions.length === 0 || !settledAndOwesNothing(sessions)) return false;
      const lastEnd = lastDisputableEnd(sessions);
      if (lastEnd !== null) {
        const hours = await settings.read(DISPUTE_WINDOW_SETTING, disputeWindowHours);
        const at = await clock(tx);
        if (at.getTime() < new Date(addHours(lastEnd, hours)).getTime()) return false;
      }
      if (await store.studentSuspendedCaseOpen(tx, enrollmentId)) return false;
      return enrollments.complete(tx, enrollmentId);
    },
  };
}
