// T024 of specs/004-sessions/tasks.md (spec FR-439; research R-323 GAP-3; contracts/admin-surface.md,
// `sessions.monitor.get`'s `correctable`): whether an administrator's correction of an outcome nobody
// disputed would be admitted now, read when shown and never stored (R-DB-4). The one function T059's
// `sessions.review.revise` answers, so the panel's button and the procedure cannot disagree.
//
// FR-439's conditions: the session settled `done`, `student_no_show`, `teacher_no_show` or
// `both_no_show` (a `disputed` one has a dispute, an `under_threshold` or `provider_outage` one is
// under review, a `scheduled` or cancelled one is not settled); its dispute window open, the
// scheduled end plus `dispute_window_hours`, open until that instant and closed from it, as
// completion reads it (`completion.service.ts`); no remedy offered for it; and never disputed, a
// resolved dispute included (its ruling is revised by `disputes.revise` instead).
import { addHours } from '@ijazah/time';

/** The outcomes a correction may replace. */
const CORRECTABLE_OUTCOMES: ReadonlySet<string> = new Set([
  'done',
  'student_no_show',
  'teacher_no_show',
  'both_no_show',
]);

/** A session as the correction decides on it. */
export interface CorrectableSession {
  readonly status: string;
  readonly scheduledEndAt: Date;
  readonly hasRemedy: boolean;
  readonly everDisputed: boolean;
}

/**
 * Why a correction is refused (T059): `CONFLICT` `not_settled` (`scheduled` or cancelled),
 * `SESSION_UNDER_REVIEW`, `DISPUTE_OPEN`, `RULING_FINAL` (`window_closed` or `remedy_offered`),
 * or `CONFLICT` `ruled` (a dispute of the session was resolved: `disputes.revise` revises it).
 */
export type CorrectionRefusal =
  | { readonly code: 'CONFLICT'; readonly cause: 'not_settled' | 'ruled' }
  | { readonly code: 'SESSION_UNDER_REVIEW' }
  | { readonly code: 'DISPUTE_OPEN' }
  | { readonly code: 'RULING_FINAL'; readonly cause: 'window_closed' | 'remedy_offered' };

const UNDER_REVIEW: ReadonlySet<string> = new Set(['under_threshold', 'provider_outage']);

/**
 * T059 (B39's conflict check, F2): the correction's refusal at `now`, or null when it is admitted,
 * in the note's order: what the session is (not settled, under review, disputed) before when (the
 * window, then a remedy), and a ruling last, so a ruling past its window reads final.
 */
export function correctionRefusal(
  session: CorrectableSession,
  { now, disputeWindowHours }: { readonly now: Date; readonly disputeWindowHours: number },
): CorrectionRefusal | null {
  if (UNDER_REVIEW.has(session.status)) return { code: 'SESSION_UNDER_REVIEW' };
  if (session.status === 'disputed') return { code: 'DISPUTE_OPEN' };
  if (!CORRECTABLE_OUTCOMES.has(session.status)) return { code: 'CONFLICT', cause: 'not_settled' };
  const closesAt = new Date(addHours(session.scheduledEndAt, disputeWindowHours));
  if (now.getTime() >= closesAt.getTime()) return { code: 'RULING_FINAL', cause: 'window_closed' };
  if (session.hasRemedy) return { code: 'RULING_FINAL', cause: 'remedy_offered' };
  if (session.everDisputed) return { code: 'CONFLICT', cause: 'ruled' };
  return null;
}

/** Whether the session's outcome may be corrected at `now`: no refusal (`correctionRefusal`). */
export function isCorrectable(
  session: CorrectableSession,
  window: { readonly now: Date; readonly disputeWindowHours: number },
): boolean {
  return correctionRefusal(session, window) === null;
}
