// 003:T110 (ADR 0025 D4, SRS DEC-85, DEC-86, FR-DISPUTE-6; the note under T110, Q-5 (a)): what a
// compensation case that closes an enrollment shows. Pure: the caller hands in the facts; the
// amounts are `packages/money`'s (R-MONEY-5). An administrator decides the case and executes the
// amount by hand in the gateway's dashboard (DEC-82); nothing here moves money.
//
// THE CAUSES are the releases' own closed set (`closingCauseOf`, Q-5 (a)), so a reason outside it,
// B47's `gender_correction` and any reason added later included, shows no amount. A complaint or a
// session dispute shows none whatever its text.
// - A teacher's dropout on the ijazah track: the whole of every order, in three parts (`dropoutParts`):
//   the share the gateway still holds, the platform's own part, and the share already released, the
//   releases marked done.
// - A teacher's dropout on recitation: the refund of the sessions not taken, and the teacher's release
//   of the share of those taken: delivered, or missed by the student (`student_no_show`, consumed;
//   the owner's answer of 2026-11-18 to Q-C3, (b), «متتردش للطالب لو غابها»; T105's `teacher_dropout`).
// - A close on a complaint against the student: the refund of the sessions not consumed, and the
//   teacher's release of the share of those delivered and of those the student missed, less what an
//   earlier release gave (T105's `student_complaint_close`, Q-B1-5 (a)). Since 003:T112 (Q-4 (a)) that
//   is the administrator's end on a teacher's complaint against the student, `student_complaint_ended`.
// - 003:T124 (SRS DEC-91, FR-ADMIN-5, FR-AUTH-11; ADR 0018 D5; Q-7 (a), Q-7a (a), Q-7b (a)): a close on
//   the student's ban or confirmed fault (`student_banned`, `student_fault_confirmed`), its own cause
//   `student_fault_close`. No refund is shown for the sessions the close took: the sessions owed before
//   it (an original `teacher_no_show`, `both_no_show`, `cancelled_by_agreement` or `postponed`, not
//   taken through a make-up) are a refund due, on both closes; the rest not taken is the
//   administrator's decision in the case; the teacher's release is the complaint close's, unchanged
//   (T105's map). What is not refunded stays where the gateway holds it (Q-7a (a)).
// A delivered make-up takes the value of the session it makes up (Q-B1-4 (a)). Beside each amount,
// the refunds already recorded on its orders (Q-C1 (a)), nothing taken off it.
import { dropoutParts, type Piasters, shareOfSessions, sumOf, untakenValue } from '@ijazah/money';

import {
  closingCauseOf,
  complaintCloseAmount,
  CONSUMED,
  type ReleaseSession,
  valuedSequence,
} from './share-release.rules.js';

/** One paid order of the enrollment with a teacher's share, in id order (ERD §7). */
export interface CaseOrder {
  readonly paymentId: string;
  readonly paid_piasters: Piasters;
  readonly share_piasters: Piasters;
  /** The order's refunded total (T102). */
  readonly refunded_piasters: Piasters;
}

/** A release of the enrollment's teacher's share as written, and whether it was marked done. */
export interface CaseRelease {
  readonly milestone: string;
  readonly amount_piasters: Piasters;
  readonly marked: boolean;
}

export interface CaseAmountFacts {
  readonly kind: 'session_dispute' | 'compensation_case' | 'absence_complaint';
  /** A compensation case's code (`COMPENSATION_REASONS`); a complaint's text. */
  readonly reason: string;
  readonly track: 'recitation' | 'ijazah_track';
  readonly sessionCount: number;
  /** The enrollment's paid orders with a share, oldest first; the first carries the share. */
  readonly orders: readonly CaseOrder[];
  readonly sessions: readonly ReleaseSession[];
  readonly releases: readonly CaseRelease[];
}

export type CaseAmount =
  | {
      readonly cause: 'ijazah_dropout';
      readonly total_piasters: Piasters;
      readonly held_piasters: Piasters;
      readonly platformPart_piasters: Piasters;
      readonly released_piasters: Piasters;
      readonly refunded_piasters: Piasters;
    }
  | {
      readonly cause: 'recitation_dropout' | 'student_complaint_close';
      readonly refund_piasters: Piasters;
      readonly release_piasters: Piasters;
      readonly refunded_piasters: Piasters;
    }
  | {
      // 003:T124: a close on the student's ban or confirmed fault.
      readonly cause: 'student_fault_close';
      /** A refund due: the sessions owed before the close, not taken through a make-up. */
      readonly owed_piasters: Piasters;
      /** The rest not taken: the administrator's decision, no refund shown for it. */
      readonly decision_piasters: Piasters;
      readonly release_piasters: Piasters;
      readonly refunded_piasters: Piasters;
    };

/** 003:T124: the closes on the student's ban or confirmed fault (DEC-91). */
const FAULT_CLOSES: ReadonlySet<string> = new Set(['student_banned', 'student_fault_confirmed']);

/** 003:T124 (Q-7b (a)): the outcomes owed a remedy before a close, a postponement among them. */
const OWED_BEFORE_CLOSE: ReadonlySet<string> = new Set([
  'teacher_no_show',
  'both_no_show',
  'cancelled_by_agreement',
  'postponed',
]);

/** The sequence numbers, each a make-up's original's, of the sessions whose outcome is in `kept`. */
function sequencesIn(
  sessions: readonly ReleaseSession[],
  kept: ReadonlySet<string>,
): readonly number[] {
  return sessions
    .filter(({ outcome }) => outcome !== undefined && kept.has(outcome))
    .map(valuedSequence);
}

function refundedOf(orders: readonly CaseOrder[]): Piasters {
  return sumOf(orders.map(({ refunded_piasters }) => refunded_piasters));
}

/** The amount the case's cause gives, or none. */
export function caseAmountOf(facts: CaseAmountFacts): CaseAmount | undefined {
  if (facts.kind !== 'compensation_case') return undefined;
  const cause = closingCauseOf(facts.reason);
  const [order] = facts.orders;
  if (cause === undefined || order === undefined) return undefined;
  const { sessionCount, sessions, releases } = facts;

  if (cause === 'teacher_dropout' && facts.track === 'ijazah_track') {
    const parts = dropoutParts(
      facts.orders,
      releases.filter(({ marked }) => marked).map(({ amount_piasters }) => amount_piasters),
    );
    return { cause: 'ijazah_dropout', ...parts, refunded_piasters: refundedOf(facts.orders) };
  }

  const consumed = sequencesIn(sessions, CONSUMED);
  if (cause === 'teacher_dropout') {
    return {
      cause: 'recitation_dropout',
      refund_piasters: untakenValue(order.paid_piasters, sessionCount, consumed),
      release_piasters: shareOfSessions(order.share_piasters, sessionCount, consumed),
      refunded_piasters: refundedOf([order]),
    };
  }

  const release_piasters = complaintCloseAmount(
    shareOfSessions(order.share_piasters, sessionCount, consumed),
    releases
      .filter(({ milestone }) => milestone !== 'student_complaint_close')
      .map(({ amount_piasters }) => amount_piasters),
  );

  if (FAULT_CLOSES.has(facts.reason)) {
    // 003:T124: a session is owed once by its valued sequence, unless that sequence was taken.
    const taken = new Set(consumed);
    const owed = sequencesIn(sessions, OWED_BEFORE_CLOSE).filter((one) => !taken.has(one));
    return {
      cause: 'student_fault_close',
      // The value of the named sessions of the order, as a share of sessions is valued (FR-337's split).
      owed_piasters: shareOfSessions(order.paid_piasters, sessionCount, owed),
      decision_piasters: untakenValue(order.paid_piasters, sessionCount, [...consumed, ...owed]),
      release_piasters,
      refunded_piasters: refundedOf([order]),
    };
  }

  return {
    cause: 'student_complaint_close',
    refund_piasters: untakenValue(order.paid_piasters, sessionCount, consumed),
    release_piasters,
    refunded_piasters: refundedOf([order]),
  };
}
