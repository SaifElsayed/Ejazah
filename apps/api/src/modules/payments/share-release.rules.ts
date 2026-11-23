// 003:T105 (ADR 0025 D2, SRS DEC-81, DEC-85, DEC-86, DEC-89; the notes under T105, Q-4 (a), Q-5 (a)):
// which releases of a teacher's share an enrollment owes, and when each falls due. Pure: no clock is
// read and no table, the caller hands in the facts and `now`; the amounts are `packages/money`'s
// (R-MONEY-5). The sweep writes each one due and not yet written; the reads show the rest as held,
// with when it would fall due. One order of a package carries the share (Q-B1-10 (a): its first
// paid order with a share); a programme's share is every paid order's (006:T011, below).
//
// THE MILESTONES (brief-lane-b1.md §4, with the owner's answers of 2026-11-18 to Q-B1-1 to Q-B1-11,
// all (a), «موافق على كله»; each answer behind one function below):
// - `recitation_end`: recitation; the enrollment `completed`; its last session's dispute window
//   passed; no case open. The whole share less the teacher's share of any refund
//   (`takenOffAtEnd`, Q-B1-1 (a)), never below nothing.
// - `ijazah_half`: `ijazah_track`; delivered (`done`) sessions reaching half the package's count
//   (`halfReached`, Q-B1-2 (a)); no case open; after the dispute window of the session that reached
//   it (`halfWindowHours`, Q-B1-3 (a)). The order's kept percent
//   of the share (`teacherShare`, T104's rounding up). Not owed once the enrollment completed short
//   of the half: its end then owes the whole rest.
// - `ijazah_end`: `ijazah_track`; on the recitation condition. The share less what earlier releases
//   gave and less the teacher's share of any refund (`shareLeft`, Q-B1-1 (a)).
// - `teacher_dropout`: recitation only; closed with a case `teacher_ended` or `absence_termination`;
//   the last counted session's dispute window passed; no case open. The share of the sessions
//   delivered and of those the student missed (`student_no_show`, consumed: 003:T110, the owner's
//   answer of 2026-11-18 to Q-C3, (b), «متتردش للطالب لو غابها»). An ijazah dropout owes nothing
//   more (DEC-85).
// - `student_complaint_close`: either track; closed with a case `student_fault_confirmed` or
//   `student_banned`; the last counted session's dispute window passed; no case open. The share of
//   the sessions delivered and of those the student missed (`student_no_show`, consumed)
//   less what earlier releases gave, never below nothing (`complaintCloseAmount`, Q-B1-5 (a)).
// A delivered make-up (numbered past the package's count) takes the value of the session it makes
// up (`valuedSequence`, Q-B1-4 (a)); its original, never delivered, is not counted twice.
// A disputed session counts by its frozen outcome, as sessions' `progress.ts` counts it; one not yet
// written counts as nothing. «No case open» is moderation's open matter (a dispute, a case or a
// complaint). A release whose amount is nothing is not owed.
//
// THE PROGRAMME (006:T011; FR-703, FR-706b, FR-725, FR-728; R-512; DEC-94; the owner's Q-5 (a) of
// 2026-11-23). An enrollment whose paid orders hold an `assessment` is a programme
// (`programmeSharesOf`); every other keeps the rules above, on its first order. The worked example:
// an offer of 10,000 EGP, the fee 500 EGP, 70 %, 25 %.
// - Not continued (no `rest_in_full` or month paid): nothing is listed while the student decides.
//   `assessment` on a close `offer_declined`, `offer_lapsed` or `assessment_refused`: the assessment
//   order's share (350 of 500), due at the latest of the close, `pay_by` where an offer was sent,
//   and session 1's dispute window (`assessmentDueAt`); never due while a `pay_blocked` item is open.
// - Continued: `ijazah_half` = 25 % × the share of the price as paid (1,750 in full, 1,837.50 by
//   months), capped at the paid orders' shares less the releases written (`programmeHalf`), on the
//   N + 1 count; `ijazah_end` = the paid orders' shares − every release written and the half owed −
//   the refund's share (5,250 / 5,512.50); `programme_stopped` (an approved stop) the same after the
//   last delivered session's window. A second stop writes nothing (rule 62; not scheduled).
// The closes above (a dropout, a complaint) are unchanged here: T012 values them per order.
import type { ShareReleaseMilestone } from '@ijazah/contracts';
import {
  lowest,
  type Piasters,
  piasters,
  shareLeft,
  shareOfSessions,
  sumOf,
  teacherShare,
} from '@ijazah/money';
import { addHours } from '@ijazah/time';

/** A session as the rules read it: its number, its end, and its outcome (a disputed one's frozen). */
export interface ReleaseSession {
  readonly sequenceNumber: number;
  readonly endsAt: Date;
  /** The session's status, a disputed one's frozen outcome, or undefined while none is written. */
  readonly outcome: string | undefined;
  /** A make-up's: the sequence number of the original session it makes up, through any chain. */
  readonly madeUpSequence?: number;
}

/** A paid order and its share (ERD §7). */
export interface ReleaseOrder {
  readonly paymentId: string;
  /** 006:T011 (R-502): what the order pays for; `package` on every order before the programme. */
  readonly kind: 'package' | 'assessment' | 'rest_in_full' | 'instalment';
  /** 006:T011: the order's gross as charged (an `assessment` order's is the fee). */
  readonly paid_piasters: Piasters;
  readonly share_piasters: Piasters;
  /** The teacher's share rate kept on the order (T104). */
  readonly sharePercent: number;
  /** The ijazah half's percent kept on an `ijazah_track` order; null on any other. */
  readonly halfPercent: number | null;
  /** The order's refunded total (T102). */
  readonly refunded_piasters: Piasters;
}

/** The enrollment as booking answers it. */
export interface ReleaseEnrollment {
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly track: 'recitation' | 'ijazah_track';
  readonly status:
    'pending_payment' | 'confirmed' | 'completed' | 'terminated_no_show' | 'cancelled';
  readonly sessionCount: number;
  /** 006:T011: why a `cancelled` enrollment was cancelled; null otherwise (ADR 0010 D7). */
  readonly cancellationReason: string | null;
  /** 006:T011: the programme an assessment's enrollment carries; null on any other (R-512). */
  readonly programme: ReleaseProgramme | null;
}

/** 006:T011 (R-512; FR-703, FR-706b): the programme as booking answers it. */
export interface ReleaseProgramme {
  readonly state: 'awaiting_offer' | 'offered' | 'active' | 'paused' | 'closed';
  /** The snapshot's price: the offer's total (N × the session price, R-506) once offered. */
  readonly total_piasters: Piasters;
  /** `pay_by_at`: set exactly where an offer was sent (R-505). */
  readonly payByAt: Date | null;
  /** `closed_at`: the close hook's instant (R-510). */
  readonly closedAt: Date | null;
  /** Whether a `pay_blocked` item is open (FR-706b). */
  readonly payBlockedOpen: boolean;
}

/** A release already written for the enrollment. */
export interface WrittenRelease {
  readonly milestone: ShareReleaseMilestone;
  readonly amount_piasters: Piasters;
}

export interface ReleaseFacts {
  readonly enrollment: ReleaseEnrollment;
  /** The order that carries a package's share: its first paid order (Q-B1-10 (a)). */
  readonly order: ReleaseOrder;
  /** 006:T011: every paid order with a share, oldest first, `order` among them. */
  readonly orders: readonly ReleaseOrder[];
  readonly sessions: readonly ReleaseSession[];
  /** The reasons of the enrollment's compensation cases, newest first. */
  readonly caseReasons: readonly string[];
  /** Whether a dispute, a case or a complaint on the enrollment is open. */
  readonly caseOpen: boolean;
  readonly written: readonly WrittenRelease[];
}

/** A release the enrollment owes and has not written: due now, or held until `dueAt`. */
export interface PlannedRelease {
  readonly milestone: ShareReleaseMilestone;
  readonly amount_piasters: Piasters;
  /** When it falls due (held: when it would); absent while no session tells it. */
  readonly dueAt?: Date;
  readonly due: boolean;
  /** An open case keeps it from falling due now. */
  readonly waitsForCase: boolean;
}

/**
 * The closings that release (Q-5 (a)): a closed set of the reasons it covers, so a reason added
 * later (B47's `gender_correction` among those already left out) compiles and releases nothing.
 */
const CLOSE_RELEASES: ReadonlyMap<string, 'teacher_dropout' | 'student_complaint_close'> = new Map([
  ['teacher_ended', 'teacher_dropout'],
  ['absence_termination', 'teacher_dropout'],
  ['student_fault_confirmed', 'student_complaint_close'],
  ['student_banned', 'student_complaint_close'],
  // 003:T112 (SRS FR-POSTPONE-6, DEC-90; Q-4 (a)): the administrator's end on a teacher's complaint
  // against the student is a close on a complaint against the student.
  ['student_complaint_ended', 'student_complaint_close'],
]);

/**
 * 003:T110: the cause one case reason gives, or none, from the same closed set, so T110's case
 * amount and these releases never disagree (T112 added DEC-86's complaint against the student here).
 */
export function closingCauseOf(
  reason: string,
): 'teacher_dropout' | 'student_complaint_close' | undefined {
  return CLOSE_RELEASES.get(reason);
}

const DELIVERED: ReadonlySet<string> = new Set(['done']);
/** The sessions consumed, a Student-No-Show counted too; T110's refund is every other session. */
export const CONSUMED: ReadonlySet<string> = new Set(['done', 'student_no_show']);

/**
 * Q-B1-1 (a): an end takes off the teacher's share of the order's refunded total, the figure «عليه»
 * shows (Q-6 as revised), so no release pays back money already returned to the student.
 */
export function takenOffAtEnd(order: ReleaseOrder): Piasters {
  return refundShareOf(order);
}

/** Q-B1-2 (a), the literal «≥ half»: 5 of 9, 5 of 10. */
export function halfReached(delivered: number, sessionCount: number): boolean {
  return delivered >= sessionCount - delivered;
}

/** The fewest delivered sessions that reach the half, by `halfReached` (at most the count). */
function halfCount(sessionCount: number): number {
  let count = 0;
  while (!halfReached(count, sessionCount)) count += 1;
  return count;
}

/** Q-B1-3 (a): the half waits for the dispute window of the session that reached it. */
export function halfWindowHours(windowHours: number): number {
  return windowHours;
}

/**
 * Q-B1-5 (a): a close's amount is its sessions' share less what earlier releases gave (an ijazah
 * half), never below nothing, so the half is never paid twice.
 */
export function complaintCloseAmount(
  sessions_piasters: Piasters,
  released_piasters: readonly Piasters[],
): Piasters {
  return shareLeft(sessions_piasters, released_piasters, piasters(0));
}

/** Q-B1-4 (a): the sequence number a session is valued by, a make-up's original's. */
export function valuedSequence(session: ReleaseSession): number {
  return session.madeUpSequence ?? session.sequenceNumber;
}

/** The teacher's share of the order's refunded total, «عليه» (Q-6 as revised: T104's rounding up). */
export function refundShareOf(order: ReleaseOrder): Piasters {
  return teacherShare(order.refunded_piasters, order.sharePercent);
}

/** The newest case reason that releases, or none. */
function closingRelease(
  reasons: readonly string[],
): 'teacher_dropout' | 'student_complaint_close' | undefined {
  for (const reason of reasons) {
    const release = CLOSE_RELEASES.get(reason);
    if (release !== undefined) return release;
  }
  return undefined;
}

/**
 * The session that ends last, by its end, never by its sequence number: a make-up booked inside the
 * package takes the next number and can end before the last session (#149 r1, Minor 2).
 */
function lastToEnd(sessions: readonly ReleaseSession[]): ReleaseSession | undefined {
  return sessions.reduce<ReleaseSession | undefined>(
    (found, one) => (found === undefined || one.endsAt > found.endsAt ? one : found),
    undefined,
  );
}

/** 006:T011 (R-512, DEC-94): the closes where the student did not continue past the assessment. */
const NOT_CONTINUED: ReadonlySet<string> = new Set([
  'offer_declined',
  'offer_lapsed',
  'assessment_refused',
]);

/** 006:T011: the orders that show the student continued: the rest in full, or a month paid. */
const CONTINUED_KINDS: ReadonlySet<ReleaseOrder['kind']> = new Set(['rest_in_full', 'instalment']);

/** 006:T011 (R-512): a programme's shares as its releases read them. */
export interface ProgrammeShares {
  readonly assessment: ReleaseOrder;
  /**
   * The student continued: the rest in full or a month paid. Months are paid in order (T009), so
   * any paid month means month 1 was.
   */
  readonly continued: boolean;
  /** 25 % × the share of the price as paid (FR-728), before the cap. */
  readonly halfBase_piasters: Piasters;
  /** The shares of every paid order, the assessment's included. */
  readonly paidShares_piasters: Piasters;
  /** The teacher's share of every order's refunded total (U-4). */
  readonly refund_piasters: Piasters;
}

/**
 * 006:T011 (R-512, DEC-94, FR-728): the shares of an enrollment whose orders hold an `assessment`;
 * undefined for a package, whose rules stay today's. The price as paid is the offer's total in full
 * (the fee inside it) or the total and the fee by months: 10,000 or 10,500 EGP, so at 70 % and
 * 25 % the half's base is 1,750 or 1,837.50 EGP.
 */
export function programmeSharesOf(facts: ReleaseFacts): ProgrammeShares | undefined {
  const assessment = facts.orders.find(({ kind }) => kind === 'assessment');
  if (assessment === undefined) return undefined;
  // Booking writes the programme with its assessment's enrollment (T005); with none read, no half
  // is made up from another figure.
  const total_piasters = facts.enrollment.programme?.total_piasters ?? piasters(0);
  const inFull = facts.orders.some(({ kind }) => kind === 'rest_in_full');
  const price_piasters = inFull
    ? total_piasters
    : sumOf([total_piasters, assessment.paid_piasters]);
  return {
    assessment,
    continued: facts.orders.some(({ kind }) => CONTINUED_KINDS.has(kind)),
    halfBase_piasters: teacherShare(
      teacherShare(price_piasters, assessment.sharePercent),
      assessment.halfPercent ?? 0,
    ),
    paidShares_piasters: sumOf(facts.orders.map(({ share_piasters }) => share_piasters)),
    refund_piasters: sumOf(facts.orders.map(refundShareOf)),
  };
}

/**
 * 006:T011 (FR-728): the half, capped at the paid orders' shares less the releases written
 * (`released_piasters`): months 1 and 2 paid hold 35,000 + 2 × 70,000 piasters, below 183,750.
 */
export function programmeHalf(
  shares: ProgrammeShares,
  released_piasters: readonly Piasters[],
): Piasters {
  return lowest([
    shares.halfBase_piasters,
    shareLeft(shares.paidShares_piasters, released_piasters, piasters(0)),
  ]);
}

/**
 * 006:T011 (DEC-94, FR-703): when the assessment's share falls due where the student did not
 * continue: the latest of the close, `pay_by` where an offer was sent, and session 1's dispute
 * window (a made-up assessment's by its make-up). Undefined while the close is not recorded.
 */
export function assessmentDueAt(facts: ReleaseFacts, windowHours: number): Date | undefined {
  const closedAt = facts.enrollment.programme?.closedAt ?? null;
  const assessed = lastToEnd(facts.sessions.filter((one) => valuedSequence(one) === 1));
  if (closedAt === null || assessed === undefined) return undefined;
  const instants = [
    closedAt.getTime(),
    facts.enrollment.programme?.payByAt?.getTime() ?? 0,
    new Date(addHours(assessed.endsAt, windowHours)).getTime(),
  ];
  return new Date(Math.max(...instants));
}

/** The releases `facts` owe and have not written, at `now`, with a dispute window of `windowHours`. */
export function plannedReleases(
  facts: ReleaseFacts,
  { windowHours, now }: { readonly windowHours: number; readonly now: Date },
): readonly PlannedRelease[] {
  const { enrollment, order, sessions, caseReasons, caseOpen } = facts;
  const written = new Map(facts.written.map((one) => [one.milestone, one.amount_piasters]));
  const after = (session: ReleaseSession | undefined, hours: number): Date | undefined =>
    session === undefined ? undefined : new Date(addHours(session.endsAt, hours));
  const plan: PlannedRelease[] = [];
  const owe = (
    milestone: ShareReleaseMilestone,
    amount_piasters: Piasters,
    dueAt: Date | undefined,
    ready: boolean,
  ): void => {
    if (written.has(milestone) || amount_piasters === 0) return;
    const due = ready && !caseOpen && dueAt !== undefined && dueAt.getTime() <= now.getTime();
    plan.push({
      milestone,
      amount_piasters,
      ...(dueAt === undefined ? {} : { dueAt }),
      due,
      waitsForCase: caseOpen,
    });
  };
  const sequencesOf = (kept: ReadonlySet<string>): ReleaseSession[] =>
    sessions.filter(({ outcome }) => outcome !== undefined && kept.has(outcome));
  const live = enrollment.status === 'confirmed' || enrollment.status === 'completed';
  const completed = enrollment.status === 'completed';
  const closed = enrollment.status === 'cancelled' || enrollment.status === 'terminated_no_show';
  const last = lastToEnd(sessions);

  if (live && enrollment.track === 'recitation') {
    owe(
      'recitation_end',
      shareLeft(order.share_piasters, [], takenOffAtEnd(order)),
      after(last, windowHours),
      completed,
    );
  }

  // 006:T011: a programme's half and end only once the student continued (R-512).
  const programme = programmeSharesOf(facts);
  if (live && enrollment.track === 'ijazah_track' && (programme?.continued ?? true)) {
    const delivered = sequencesOf(DELIVERED).toSorted(
      (a, b) => a.endsAt.getTime() - b.endsAt.getTime(),
    );
    const reached = halfReached(delivered.length, enrollment.sessionCount);
    const needed = halfCount(enrollment.sessionCount);
    const halfSession = reached
      ? delivered[needed - 1]
      : sessions.find(({ sequenceNumber }) => sequenceNumber === needed);
    const half_piasters =
      programme === undefined
        ? teacherShare(order.share_piasters, order.halfPercent ?? 0)
        : programmeHalf(programme, [...written.values()]);
    // Completed short of the half: no half is owed, and the end owes the whole rest.
    if (!(completed && !reached)) {
      owe('ijazah_half', half_piasters, after(halfSession, halfWindowHours(windowHours)), reached);
    }
    // The end takes off what was released, and the half still owed, which falls due first.
    const halfOwed = plan.find(({ milestone }) => milestone === 'ijazah_half');
    const before = [
      ...written.values(),
      ...(halfOwed === undefined ? [] : [halfOwed.amount_piasters]),
    ];
    owe(
      'ijazah_end',
      programme === undefined
        ? shareLeft(order.share_piasters, before, takenOffAtEnd(order))
        : shareLeft(programme.paidShares_piasters, before, programme.refund_piasters),
      after(last, windowHours),
      completed,
    );
  }

  if (closed && programme !== undefined) {
    const reason = enrollment.cancellationReason;
    if (!programme.continued && reason !== null && NOT_CONTINUED.has(reason)) {
      // DEC-94, FR-706b: the assessment's share, never due while a `pay_blocked` item is open.
      owe(
        'assessment',
        programme.assessment.share_piasters,
        assessmentDueAt(facts, windowHours),
        enrollment.programme?.payBlockedOpen !== true,
      );
    }
    if (programme.continued && reason === 'programme_stopped') {
      // FR-725, Q-5 (a): the shares paid less every release written and the refund's share.
      owe(
        'programme_stopped',
        shareLeft(programme.paidShares_piasters, [...written.values()], programme.refund_piasters),
        after(lastToEnd(sequencesOf(DELIVERED)), windowHours),
        true,
      );
    }
  }

  if (closed) {
    const release = closingRelease(caseReasons);
    if (release === 'teacher_dropout' && enrollment.track === 'recitation') {
      // 003:T110, Q-C3 (b): a session the student missed is consumed, its share released.
      const taken = sequencesOf(CONSUMED);
      owe(
        'teacher_dropout',
        shareOfSessions(order.share_piasters, enrollment.sessionCount, taken.map(valuedSequence)),
        after(lastToEnd(taken), windowHours),
        true,
      );
    }
    if (release === 'student_complaint_close') {
      const counted = sequencesOf(CONSUMED);
      owe(
        'student_complaint_close',
        complaintCloseAmount(
          shareOfSessions(
            order.share_piasters,
            enrollment.sessionCount,
            counted.map(valuedSequence),
          ),
          [...written.values()],
        ),
        after(lastToEnd(counted), windowHours),
        true,
      );
    }
  }
  return plan;
}
