// T024 of specs/004-sessions/tasks.md (research R-311, R-323 GAP-4; data-model.md §2.3; the owner's
// decision of 2026-11-05 on the second analysis, D1): a remedy's two derived deadlines, computed when
// read and never stored (R-DB-4), each from the remedy's own snapshots, never the live settings (I1).
//
// `answerClosesAt` is D1's one function: a pending counter-proposal's answer window closes at
// `counter_proposed_at` plus `snapshot_answer_window_hours`. Written here first (T024's monitor);
// T031's `RemedyView`, `sessions.remedy.answerCounter`'s refusal and T032's `advance-remedies` read
// it, so no stored value can disagree with its inputs.
//
// `bookingRetriedUntil` (GAP-4; FR-468, A3): a remedy still `proposed` or `awaiting_choice` once its
// choice window has closed is one whose booking of the proposal the database refused, retried each
// run while it starts at least the lead ahead: until the proposal's start less
// `snapshot_first_session_lead_hours`, after which `advance-remedies` hands it to a `makeup_refused`
// case. The window has closed from `choice_closes_at` itself. Instant arithmetic is `packages/time`'s
// (R-TIME-1).
import { addHours } from '@ijazah/time';

/** A pending counter-proposal's answer deadline (D1). */
export function answerClosesAt(remedy: {
  readonly counterProposedAt: Date;
  readonly snapshotAnswerWindowHours: number;
}): Date {
  return new Date(addHours(remedy.counterProposedAt, remedy.snapshotAnswerWindowHours));
}

/** Until when a refused booking of the proposal is retried at `now`; absent when none is. */
export function bookingRetriedUntil(
  remedy: {
    readonly status: string;
    readonly choiceClosesAt: Date;
    readonly proposalStartsAt: Date | undefined;
    readonly snapshotFirstSessionLeadHours: number;
  },
  now: Date,
): Date | undefined {
  if (remedy.status !== 'proposed' && remedy.status !== 'awaiting_choice') return undefined;
  if (now.getTime() < remedy.choiceClosesAt.getTime()) return undefined;
  if (remedy.proposalStartsAt === undefined) return undefined;
  return new Date(addHours(remedy.proposalStartsAt, -remedy.snapshotFirstSessionLeadHours));
}
