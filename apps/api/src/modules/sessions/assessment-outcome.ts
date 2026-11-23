// 006:T008 of specs/006-programme (FR-706a; R-505; B-P2's conflict check, Q-3 (a) amended and Q-8
// (a), the owner, 2026-11-23): where session 1 of a programme, the assessment, stands, read through
// this module's entry so booking never reads `sessions` (R-API-6). Booking derives the offer's
// deadline from it on every read while the programme awaits its offer; this module owns what a
// status means (as `progress.ts`). Read-only, no lock; no sessions writer changes.
//
// THE CHAIN. Session 1 (sequence 1, no make-up's origin), then the make-up booked for it
// (`makeup_for_session_id`), then that make-up's own, to the last:
// - `done` or `student_no_show` (consumed: the fee kept either way) → `delivered` at that session's
//   scheduled end (the room closes at the end, the owner's 2026-11-09 rule);
// - `scheduled` → `waiting`;
// - a make-up booked for it → the walk goes on with the make-up;
// - a remedy open (`awaiting_choice`, `proposed`, `counter_proposed`, `frozen`) or `booked` with no
//   make-up row yet, or an outcome owed a remedy that has none yet (`OWING_STATUSES`: offered once
//   its dispute window closes, `remedy-offer.sweep.ts`) → `waiting`: a make-up is pending;
// - anything else is an end with no make-up pending (analyze N-2): a remedy `lapsed` or handed to a
//   `refund_case`, an administrator's cancellation owed no remedy, and a session still unsettled (a
//   dispute, a review below the threshold, a provider's outage; R-505's «a dispute unresolved past
//   24 h after its scheduled end») → `ended` at that session's scheduled end.
// The walk reads session 1 and the make-ups only, so a later session never moves it. The read is
// `assessment-outcome.repository.ts`'.
import type { SessionStatus } from '@ijazah/contracts';

import { OWING_STATUSES, type RemedyRowStatus } from './remedy-offer.repository.js';

/** Where session 1's outcome chain stands (this file's head). */
export type AssessmentOutcome =
  | { readonly kind: 'delivered'; readonly endsAt: Date }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'ended'; readonly endsAt: Date };

/** A session of the chain as the walk reads it. */
export interface ChainSession {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly status: SessionStatus;
  readonly endsAt: Date;
  readonly makeupForSessionId: string | null;
  readonly remedyStatus: RemedyRowStatus | null;
}

/** The statuses that consume a session (SRS §3.8.3; `progress.ts`). */
const CONSUMED: ReadonlySet<SessionStatus> = new Set(['done', 'student_no_show']);
/** A remedy still to give its make-up. */
const PENDING_REMEDIES: ReadonlySet<RemedyRowStatus> = new Set([
  'awaiting_choice',
  'proposed',
  'counter_proposed',
  'frozen',
  'booked',
]);
const OWING: ReadonlySet<SessionStatus> = new Set(OWING_STATUSES);
const WAITING: AssessmentOutcome = { kind: 'waiting' };

/** Where one session of the chain leaves it, its make-up (if any) aside. */
function settledOf(session: ChainSession): AssessmentOutcome {
  if (CONSUMED.has(session.status)) return { kind: 'delivered', endsAt: session.endsAt };
  if (session.status === 'scheduled') return WAITING;
  if (session.remedyStatus !== null) {
    return PENDING_REMEDIES.has(session.remedyStatus)
      ? WAITING
      : { kind: 'ended', endsAt: session.endsAt };
  }
  return OWING.has(session.status) ? WAITING : { kind: 'ended', endsAt: session.endsAt };
}

/** Session 1's outcome chain (this file's head). Pure. */
export function assessmentOutcomeOf(sessions: readonly ChainSession[]): AssessmentOutcome {
  const makeupOf = new Map<string, ChainSession>();
  for (const session of sessions) {
    if (session.makeupForSessionId === null) continue;
    const known = makeupOf.get(session.makeupForSessionId);
    if (known === undefined || known.sequenceNumber < session.sequenceNumber) {
      makeupOf.set(session.makeupForSessionId, session);
    }
  }
  let current = sessions.find(
    ({ sequenceNumber, makeupForSessionId }) => sequenceNumber === 1 && makeupForSessionId === null,
  );
  // Bounded: each step moves to a later sequence number among the rows read.
  for (let step = 0; current !== undefined && step <= sessions.length; step += 1) {
    if (CONSUMED.has(current.status) || current.status === 'scheduled') return settledOf(current);
    const makeup = makeupOf.get(current.id);
    if (makeup === undefined) return settledOf(current);
    current = makeup;
  }
  return WAITING;
}
