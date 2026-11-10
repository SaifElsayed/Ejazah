// T024 of specs/004-sessions/tasks.md (FR-454; research R-322, R-323 P3-25): the end of an
// enrollment's restore window, derived and never stored (R-DB-4): the closing case's `created_at`,
// written in the closing's own transaction, plus `enrollment_restore_window_days`, each day 24 hours
// of an instant (the owner's decision of 2026-11-10 on B37 lane B's Q7). `sessions.monitor.get`
// shows it as `restorableUntil`; T061's `sessions.restore` refuses `window_closed` from it, through
// this one function, so the panel's button and the procedure cannot disagree.
import { addDays } from '@ijazah/time';

/** The restore window's setting (SRS §3.14 «Enrollment restore window (days)»). */
export const ENROLLMENT_RESTORE_WINDOW_SETTING = 'enrollment_restore_window_days';

/** The instant the restore window closes. */
export function restorableUntil(caseOpenedAt: Date, windowDays: number): Date {
  return new Date(addDays(caseOpenedAt, windowDays));
}
