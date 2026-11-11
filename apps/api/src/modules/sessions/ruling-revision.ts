// T059 of specs/004-sessions/tasks.md (SRS FR-DISPUTE-7; FR-472; research R-308, «A ruling's
// revision»; contracts/admin-surface.md, `disputes.revise` and `disputes.get`'s `revisable`): whether
// a session dispute's ruling may be revised now, read when shown and never stored (R-DB-4), the one
// function `disputes.revise` answers under its locks and `disputes.get` reads with none, so the
// panel's button and the procedure cannot disagree.
//
// R-308's conditions: the dispute is resolved and no dispute of the session is open; the session
// still holds a ruling's outcome (`done` or a no-show), not reclassified to the review queue since;
// its dispute window open (the scheduled end plus `dispute_window_hours`, open until that instant and
// closed from it, as `outcome-correction.ts` and completion read it); no remedy exists for it; and the
// dispute is the session's last resolved one. The order, as T059's note (F2) orders the correction:
// what the session is (under review, disputed), then when (the window, then a remedy), and a later
// ruling last, so a ruling past its window reads final.
import { addHours } from '@ijazah/time';

/** A dispute of the session as the rule reads it. */
export interface RevisedDispute {
  readonly id: string;
  readonly status: 'open' | 'resolved' | 'dismissed';
}

/** What the rule reads of the session and its disputes. */
export interface RevisableRuling {
  /** The dispute to revise. */
  readonly dispute: RevisedDispute;
  /** Every session dispute of the session, the revised one included. */
  readonly disputes: readonly RevisedDispute[];
  readonly status: string;
  readonly scheduledEndAt: Date;
  readonly hasRemedy: boolean;
}

/** Why a revision is refused. */
export type RevisionRefusal =
  | { readonly code: 'SESSION_UNDER_REVIEW' }
  | { readonly code: 'DISPUTE_OPEN' }
  | { readonly code: 'RULING_FINAL'; readonly cause: 'window_closed' | 'remedy_offered' }
  | { readonly code: 'RULING_SUPERSEDED' };

const UNDER_REVIEW: ReadonlySet<string> = new Set(['under_threshold', 'provider_outage']);

/** The revision's refusal at `now`, or null when it is admitted (this file's head). */
export function revisionRefusal(
  ruling: RevisableRuling,
  { now, disputeWindowHours }: { readonly now: Date; readonly disputeWindowHours: number },
): RevisionRefusal | null {
  if (UNDER_REVIEW.has(ruling.status)) return { code: 'SESSION_UNDER_REVIEW' };
  if (
    ruling.dispute.status === 'open' ||
    ruling.status === 'disputed' ||
    ruling.disputes.some(({ status }) => status === 'open')
  ) {
    return { code: 'DISPUTE_OPEN' };
  }
  const closesAt = new Date(addHours(ruling.scheduledEndAt, disputeWindowHours));
  if (now.getTime() >= closesAt.getTime()) return { code: 'RULING_FINAL', cause: 'window_closed' };
  if (ruling.hasRemedy) return { code: 'RULING_FINAL', cause: 'remedy_offered' };
  const later = ruling.disputes.some(
    ({ id, status }) => id > ruling.dispute.id && status === 'resolved',
  );
  if (later) return { code: 'RULING_SUPERSEDED' };
  return null;
}
