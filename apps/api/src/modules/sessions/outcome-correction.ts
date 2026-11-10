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

/** Whether the session's outcome may be corrected at `now`. */
export function isCorrectable(
  session: {
    readonly status: string;
    readonly scheduledEndAt: Date;
    readonly hasRemedy: boolean;
    readonly everDisputed: boolean;
  },
  { now, disputeWindowHours }: { readonly now: Date; readonly disputeWindowHours: number },
): boolean {
  if (!CORRECTABLE_OUTCOMES.has(session.status)) return false;
  if (session.hasRemedy || session.everDisputed) return false;
  const closesAt = new Date(addHours(session.scheduledEndAt, disputeWindowHours));
  return now.getTime() < closesAt.getTime();
}
