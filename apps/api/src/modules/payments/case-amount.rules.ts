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
//
// 006:T012 (FR-729, FR-730; R-512; analyze G-3, G-4; DEC-85, DEC-94). A PROGRAMME (its orders hold an
// `assessment`) values each session by its own order (`programmePlaces`): the assessment the fee, in
// full (total − fee) ÷ N, by months the month ÷ its sessions; an offer of 10,000 EGP with a 500 fee
// gives 500, 237.50 and 250 EGP. Its refunds and releases sum the orders' own; the refunds already
// recorded are every order's. Its dropout set is `teacher_ended`, `absence_termination` and an
// `admin_ended` that covered its open `teacher_suspended` case (`coversSuspension`), each the whole of
// every order (DEC-85); a direct end of an unsuspended programme is T125's (R1b), and an open
// suspension case is a pause and shows none. A package keeps the rules above on its first order.
import { dropoutParts, type Piasters, shareOfSessions, sumOf, untakenValue } from '@ijazah/money';

import {
  closingCauseOf,
  complaintCloseAmount,
  CONSUMED,
  programmePlaces,
  type ReleaseSession,
  type SessionPlace,
  valuedSequence,
} from './share-release.rules.js';

/** One paid order of the enrollment with a teacher's share, in id order (ERD §7). */
export interface CaseOrder {
  readonly paymentId: string;
  /** 006:T012 (R-502): what the order pays for; `package` on every order before the programme. */
  readonly kind: 'package' | 'assessment' | 'rest_in_full' | 'instalment';
  /** 006:T012: an `instalment` order's month; null on any other. */
  readonly instalmentMonth: number | null;
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
  /**
   * 006:T012: an `admin_ended` case covered the enrollment's open `teacher_suspended` case (an
   * administrator's end of a suspended programme, `closePausedCaseOnEnd`).
   */
  readonly coversSuspension: boolean;
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

/** 006:T012: the end that is in a programme's dropout set only where it covered a suspension. */
const SUSPENSION_COVERING_END = 'admin_ended';

/** How a case values sessions named by their valued sequence numbers. */
interface SessionValues {
  /** What was paid for the sessions not named: the refund of what was not taken. */
  untaken(named: readonly number[]): Piasters;
  /** What was paid for the named sessions (FR-337's split). */
  paid(named: readonly number[]): Piasters;
  /** The teacher's share of the named sessions. */
  share(named: readonly number[]): Piasters;
  /** The refunds already recorded on the orders valued (Q-C1 (a)). */
  readonly refunded_piasters: Piasters;
}

/** A package: every session valued by its first order ÷ the count (T110). */
function packageValues(order: CaseOrder, sessionCount: number): SessionValues {
  return {
    untaken: (named) => untakenValue(order.paid_piasters, sessionCount, named),
    paid: (named) => shareOfSessions(order.paid_piasters, sessionCount, named),
    share: (named) => shareOfSessions(order.share_piasters, sessionCount, named),
    refunded_piasters: refundedOf([order]),
  };
}

/** 006:T012 (R-512, G-3): a programme: each session valued by its own order (`programmePlaces`). */
function programmeValues(
  orders: readonly CaseOrder[],
  places: ReadonlyMap<number, SessionPlace<CaseOrder>>,
): SessionValues {
  const counts = new Map([...places.values()].map(({ order, count }) => [order, count] as const));
  const positionsIn = (order: CaseOrder, named: readonly number[]): number[] =>
    named.flatMap((sequence) => {
      const place = places.get(sequence);
      return place?.order === order ? [place.position] : [];
    });
  const summed =
    (each: (order: CaseOrder, count: number, positions: readonly number[]) => Piasters) =>
    (named: readonly number[]): Piasters =>
      sumOf([...counts].map(([order, count]) => each(order, count, positionsIn(order, named))));
  return {
    untaken: summed((order, count, positions) =>
      untakenValue(order.paid_piasters, count, positions),
    ),
    paid: summed((order, count, positions) =>
      shareOfSessions(order.paid_piasters, count, positions),
    ),
    share: summed((order, count, positions) =>
      shareOfSessions(order.share_piasters, count, positions),
    ),
    refunded_piasters: refundedOf(orders),
  };
}

/** The amount the case's cause gives, or none. */
export function caseAmountOf(facts: CaseAmountFacts): CaseAmount | undefined {
  if (facts.kind !== 'compensation_case') return undefined;
  const cause = closingCauseOf(facts.reason);
  const [order] = facts.orders;
  if (order === undefined) return undefined;
  const { sessionCount, sessions, releases } = facts;
  const programme = facts.orders.some(({ kind }) => kind === 'assessment');
  // 006:T012 (FR-729): an administrator's end of a suspended programme is a dropout (DEC-85).
  const coveredSuspension =
    programme && facts.reason === SUSPENSION_COVERING_END && facts.coversSuspension;

  if ((cause === 'teacher_dropout' || coveredSuspension) && facts.track === 'ijazah_track') {
    const parts = dropoutParts(
      facts.orders,
      releases.filter(({ marked }) => marked).map(({ amount_piasters }) => amount_piasters),
    );
    return { cause: 'ijazah_dropout', ...parts, refunded_piasters: refundedOf(facts.orders) };
  }
  if (cause === undefined) return undefined;

  const values = programme
    ? programmeValues(facts.orders, programmePlaces(facts.orders, sessions))
    : packageValues(order, sessionCount);
  const consumed = sequencesIn(sessions, CONSUMED);
  if (cause === 'teacher_dropout') {
    return {
      cause: 'recitation_dropout',
      refund_piasters: values.untaken(consumed),
      release_piasters: values.share(consumed),
      refunded_piasters: values.refunded_piasters,
    };
  }

  const release_piasters = complaintCloseAmount(
    values.share(consumed),
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
      // The value of the named sessions, as a share of sessions is valued (FR-337's split).
      owed_piasters: values.paid(owed),
      decision_piasters: values.untaken([...consumed, ...owed]),
      release_piasters,
      refunded_piasters: values.refunded_piasters,
    };
  }

  return {
    cause: 'student_complaint_close',
    refund_piasters: values.untaken(consumed),
    release_piasters,
    refunded_piasters: values.refunded_piasters,
  };
}
