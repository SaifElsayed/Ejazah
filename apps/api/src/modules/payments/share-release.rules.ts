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
// - `direct_end` (003:T125; SRS DEC-104, DEC-96; Q-1 (a) to Q-3 (a)): either track; closed with a
//   case `admin_ended` (the student's stop), `account_deleted` (a student's deletion by an
//   administrator) or `gender_correction`; the complaint close's arithmetic under its own name, held
//   while the case is open. A programme's `admin_ended` that covered its suspension
//   (`coversSuspension`, the fact its case reads) stays a dropout: nothing more (006:T012 as amended).
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
//   `assessment` on a close `offer_declined`, `offer_lapsed` or `assessment_refused`, where the
//   assessment was held (`assessmentHeld`: session 1's chain consumed, `done` or `student_no_show`;
//   PR #158 r1 Follow-up 1 (a), the owner: where it was not, nothing, the fee the administrator's
//   compensation case's): the assessment
//   order's share (350 of 500), due at the latest of the close, `pay_by` where an offer was sent,
//   and session 1's dispute window (`assessmentDueAt`); never due while a `pay_blocked` item is open.
// - Continued: `ijazah_half` = 25 % × the share of the price as paid (1,750 in full, 1,837.50 by
//   months), capped at the paid orders' shares less the releases written (`programmeHalf`), on the
//   N + 1 count; `ijazah_end` = the paid orders' shares − every release written and the half owed −
//   the refund's share (5,250 / 5,512.50); `programme_stopped` (an approved stop) the same after the
//   last consumed session's window (done or a student's no-show; FU-E2 (a)). A second stop writes
//   nothing (rule 62; not scheduled).
// 006:T012: a programme's close on a complaint against the student releases each session's share by
// its own order (`programmePlaces`, `sumByOrder`); a dropout releases nothing more (DEC-85).
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
  /** 006:T012 (R-507, R-512): an offer session's programme month; absent on every other. */
  readonly programmeMonth?: number;
}

/** A paid order and its share (ERD §7). */
export interface ReleaseOrder {
  readonly paymentId: string;
  /** 006:T011 (R-502): what the order pays for; `package` on every order before the programme. */
  readonly kind: 'package' | 'assessment' | 'rest_in_full' | 'instalment';
  /** 006:T012: an `instalment` order's month; null on any other. */
  readonly instalmentMonth: number | null;
  /** 006:T011: the order's gross as charged (an `assessment` order's is the fee). */
  readonly paid_piasters: Piasters;
  readonly share_piasters: Piasters;
  /** The teacher's share rate kept on the order (T104). */
  readonly sharePercent: number;
  /** The ijazah half's percent kept on an `ijazah_track` order; null on any other. */
  readonly halfPercent: number | null;
  /** The order's refunded total (T102). */
  readonly refunded_piasters: Piasters;
  /**
   * 006:T014 (Q-5 (a)): when the confirm step processed the order (`confirmed_at`); null or absent
   * while it has not.
   */
  readonly processedAt?: Date | null;
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
  /**
   * 003:T125 (006:T012 as amended): an `admin_ended` case covered the enrollment's open
   * `teacher_suspended` case, the fact the case's amount reads (`coversSuspension`).
   */
  readonly coversSuspension: boolean;
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
  /**
   * 003:T127 (ERD §15 rule 83): the teacher's share of the refunds an end release takes off, kept on
   * its row; nothing on every other release.
   */
  readonly refundTakenOff_piasters: Piasters;
}

/** The release a closing's case gives (Q-5 (a); 003:T125's `direct_end`). */
export type ClosingCause = 'teacher_dropout' | 'student_complaint_close' | 'direct_end';

/**
 * The closings that release (Q-5 (a)): a closed set of the reasons it covers, so a reason added
 * later compiles and releases nothing.
 */
const CLOSE_RELEASES: ReadonlyMap<string, ClosingCause> = new Map([
  ['teacher_ended', 'teacher_dropout'],
  ['absence_termination', 'teacher_dropout'],
  ['student_fault_confirmed', 'student_complaint_close'],
  ['student_banned', 'student_complaint_close'],
  // 003:T112 (SRS FR-POSTPONE-6, DEC-90; Q-4 (a)): the administrator's end on a teacher's complaint
  // against the student is a close on a complaint against the student.
  ['student_complaint_ended', 'student_complaint_close'],
  // 003:T125 (SRS DEC-104, DEC-96; Q-1 (a), Q-2 (a), Q-3 (a)): an end by the administration, the
  // student's stop, a student's deletion by an administrator and a gender correction.
  ['admin_ended', 'direct_end'],
  ['account_deleted', 'direct_end'],
  ['gender_correction', 'direct_end'],
]);

/**
 * 003:T110: the cause one case reason gives, or none, from the same closed set, so T110's case
 * amount and these releases never disagree (T112 added DEC-86's complaint against the student here).
 */
export function closingCauseOf(reason: string): ClosingCause | undefined {
  return CLOSE_RELEASES.get(reason);
}

/**
 * 006:T012 (003:T125): the end that is a programme's dropout only where it covered the programme's
 * `teacher_suspended` case; otherwise the student's stop.
 */
export const SUSPENSION_COVERING_END = 'admin_ended';

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

/** 006:T012 (R-502): an order as a programme's sessions are valued by it. */
export interface PlacedOrder {
  readonly kind: ReleaseOrder['kind'];
  /** An `instalment` order's month; null on any other. */
  readonly instalmentMonth: number | null;
}

/** 006:T012: the order a programme's session is valued by, that order's sessions, and its place. */
export interface SessionPlace<O extends PlacedOrder> {
  readonly order: O;
  readonly count: number;
  readonly position: number;
}

/**
 * 006:T012 (R-512 «the closes' amounts per session», analyze G-3): each of a programme's sessions, by
 * its sequence number, with the order that paid it and its place among that order's sessions. Session
 * 1 is the assessment's (1 of 1: the fee). In full, the k-th offer session is the rest's (k of N:
 * (total − fee) ÷ N). By months, the k-th session of month m is that month's order's (k of the month's
 * sessions). Offer sessions are those with a programme month, make-ups aside: a make-up is valued by
 * the session it makes up (`valuedSequence`). A session of a month not paid has none. A second paid
 * order of a month or of the rest goes to its own case (Q-B1-10 (a)): the first by id is the one.
 */
export function programmePlaces<O extends PlacedOrder>(
  orders: readonly O[],
  sessions: readonly ReleaseSession[],
): ReadonlyMap<number, SessionPlace<O>> {
  const places = new Map<number, SessionPlace<O>>();
  const assessment = orders.find(({ kind }) => kind === 'assessment');
  if (assessment !== undefined) places.set(1, { order: assessment, count: 1, position: 1 });
  const offer = sessions
    .filter((one) => one.madeUpSequence === undefined && one.programmeMonth !== undefined)
    .toSorted((a, b) => a.sequenceNumber - b.sequenceNumber);
  const place = (order: O, members: readonly ReleaseSession[]): void => {
    members.forEach((one, index) => {
      places.set(one.sequenceNumber, { order, count: members.length, position: index + 1 });
    });
  };
  const rest = orders.find(({ kind }) => kind === 'rest_in_full');
  if (rest !== undefined) {
    place(rest, offer);
    return places;
  }
  const months = new Map<number, ReleaseSession[]>();
  for (const one of offer) {
    if (one.programmeMonth === undefined) continue;
    months.set(one.programmeMonth, [...(months.get(one.programmeMonth) ?? []), one]);
  }
  for (const [month, members] of months) {
    const paid = orders.find(
      ({ kind, instalmentMonth }) => kind === 'instalment' && instalmentMonth === month,
    );
    if (paid !== undefined) place(paid, members);
  }
  return places;
}

/**
 * 006:T012: over each order a programme's sessions are placed in, `each` of the order, its sessions'
 * count and the places among them of the sessions `named` by valued sequence, summed (an order none
 * of them names still counts, as a refund of what was not taken needs).
 */
export function sumByOrder<O extends PlacedOrder>(
  places: ReadonlyMap<number, SessionPlace<O>>,
  named: readonly number[],
  each: (order: O, count: number, positions: readonly number[]) => Piasters,
): Piasters {
  const counts = new Map([...places.values()].map(({ order, count }) => [order, count] as const));
  return sumOf(
    [...counts].map(([order, count]) =>
      each(
        order,
        count,
        named.flatMap((sequence) => {
          const place = places.get(sequence);
          return place?.order === order ? [place.position] : [];
        }),
      ),
    ),
  );
}

/** The teacher's share of the order's refunded total, «عليه» (Q-6 as revised: T104's rounding up). */
export function refundShareOf(order: ReleaseOrder): Piasters {
  return teacherShare(order.refunded_piasters, order.sharePercent);
}

/** The newest case reason that releases, with its release, or none. */
function closingRelease(
  reasons: readonly string[],
): { readonly reason: string; readonly release: ClosingCause } | undefined {
  for (const reason of reasons) {
    const release = CLOSE_RELEASES.get(reason);
    if (release !== undefined) return { reason, release };
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
 * 006:T011 FU-E3 (the review session, 2026-11-23): a programme's enrollment read with no programme
 * row. It should not happen (T005 writes both on one transaction); its half is nothing, and the
 * sweep logs one warn line.
 */
export function programmeRowMissing(facts: ReleaseFacts): boolean {
  return facts.enrollment.programme === null && programmeSharesOf(facts) !== undefined;
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
  const { programme } = facts.enrollment;
  const inFull = facts.orders.some(({ kind }) => kind === 'rest_in_full');
  const awaited = awaitedOrdersOf(facts.orders);
  return {
    assessment,
    continued: facts.orders.some(({ kind }) => CONTINUED_KINDS.has(kind)),
    // FU-E3: with no programme row read (should not happen, T005), no half from another figure.
    halfBase_piasters:
      programme === null
        ? piasters(0)
        : teacherShare(
            teacherShare(
              inFull
                ? programme.total_piasters
                : sumOf([programme.total_piasters, assessment.paid_piasters]),
              assessment.sharePercent,
            ),
            assessment.halfPercent ?? 0,
          ),
    // 006:T014 (Q-5 (a)): a duplicate's share and its refunds are the `duplicate_payment` case's.
    paidShares_piasters: sumOf(awaited.map(({ share_piasters }) => share_piasters)),
    refund_piasters: sumOf(awaited.map(refundShareOf)),
  };
}

/**
 * 006:T014 (#158 r1 FU4; B-P3's Q-5 (a)): the orders a programme's shares read: every order but
 * the programme's (`rest_in_full`, `instalment`), and of those only the ones the confirm step awaited,
 * walked as it walks them (`confirm-enrollment.ts`, `awaitedAfter`): the processed ones by
 * `confirmed_at`, then id, then the unprocessed in id order, as it will process them; the rest in
 * full counts only before any month, a month only when it is the next one, and nothing after the
 * rest. Month 1 paid twice, 1,000 EGP each: the second and its refunds are left out.
 */
function awaitedOrdersOf(orders: readonly ReleaseOrder[]): ReleaseOrder[] {
  const programmeOrders = orders.filter(({ kind }) => CONTINUED_KINDS.has(kind)).sort(walkOrder);
  const awaited = new Set<ReleaseOrder>();
  let next = 1;
  let inFull = false;
  for (const order of programmeOrders) {
    if (inFull) break;
    if (order.kind === 'rest_in_full') {
      if (next === 1) {
        inFull = true;
        awaited.add(order);
      }
    } else if (order.instalmentMonth === next) {
      next += 1;
      awaited.add(order);
    }
  }
  return orders.filter((order) => !CONTINUED_KINDS.has(order.kind) || awaited.has(order));
}

/** The confirm step's order: processed first, by `confirmed_at` then id; the unprocessed by id. */
function walkOrder(a: ReleaseOrder, b: ReleaseOrder): number {
  const at = (order: ReleaseOrder) => order.processedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (at(a) !== at(b)) return at(a) < at(b) ? -1 : 1;
  return a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0;
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

/**
 * PR #158 r1 Follow-up 1 (a), the owner, «صلح ومتابعة أ»: whether the assessment was held, i.e.
 * session 1, or a make-up of it, consumed (`done` or `student_no_show`, a disputed one by its frozen
 * outcome). Where it was not, no `assessment` share is owed; the fee is the administrator's.
 */
export function assessmentHeld(sessions: readonly ReleaseSession[]): boolean {
  return sessions.some(
    (one) => valuedSequence(one) === 1 && one.outcome !== undefined && CONSUMED.has(one.outcome),
  );
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
    refundTakenOff_piasters: Piasters = piasters(0),
  ): void => {
    if (written.has(milestone) || amount_piasters === 0) return;
    const due = ready && !caseOpen && dueAt !== undefined && dueAt.getTime() <= now.getTime();
    plan.push({
      milestone,
      amount_piasters,
      ...(dueAt === undefined ? {} : { dueAt }),
      due,
      waitsForCase: caseOpen,
      refundTakenOff_piasters,
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
      takenOffAtEnd(order),
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
    const endTakenOff_piasters =
      programme === undefined ? takenOffAtEnd(order) : programme.refund_piasters;
    owe(
      'ijazah_end',
      programme === undefined
        ? shareLeft(order.share_piasters, before, endTakenOff_piasters)
        : shareLeft(programme.paidShares_piasters, before, endTakenOff_piasters),
      after(last, windowHours),
      completed,
      endTakenOff_piasters,
    );
  }

  if (closed && programme !== undefined) {
    const reason = enrollment.cancellationReason;
    // PR #158 r1 Follow-up 1 (a): owed only where the assessment was held.
    const owed = !programme.continued && reason !== null && NOT_CONTINUED.has(reason);
    if (owed && assessmentHeld(sessions)) {
      // DEC-94, FR-706b: the assessment's share, never due while a `pay_blocked` item is open.
      owe(
        'assessment',
        programme.assessment.share_piasters,
        assessmentDueAt(facts, windowHours),
        enrollment.programme?.payBlockedOpen !== true,
      );
    }
    if (programme.continued && reason === 'programme_stopped') {
      // FR-725, Q-5 (a): the shares paid less every release written and the refund's share, after
      // the last consumed session's window (done or a student's no-show; FU-E2 (a), the owner).
      owe(
        'programme_stopped',
        shareLeft(programme.paidShares_piasters, [...written.values()], programme.refund_piasters),
        after(lastToEnd(sequencesOf(CONSUMED)), windowHours),
        true,
        programme.refund_piasters,
      );
    }
  }

  if (closed) {
    const closing = closingRelease(caseReasons);
    // 003:T125 (006:T012 as amended): a programme's end that covered its suspension stays a
    // dropout, as its case reads it: nothing more (DEC-85).
    const coveredDropout =
      programme !== undefined &&
      closing?.reason === SUSPENSION_COVERING_END &&
      facts.coversSuspension;
    const release = coveredDropout ? 'teacher_dropout' : closing?.release;
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
    // 003:T125 (DEC-104): an end by the administration releases as a complaint close does, under
    // its own name, `direct_end`.
    if (release === 'student_complaint_close' || release === 'direct_end') {
      const counted = sequencesOf(CONSUMED);
      const taken = counted.map(valuedSequence);
      // 006:T012 (R-512, G-3): a programme's sessions each by their own order; a package's by its
      // first order ÷ the count.
      const share_piasters =
        programme === undefined
          ? shareOfSessions(order.share_piasters, enrollment.sessionCount, taken)
          : sumByOrder(programmePlaces(facts.orders, sessions), taken, (paid, count, positions) =>
              shareOfSessions(paid.share_piasters, count, positions),
            );
      owe(
        release,
        complaintCloseAmount(share_piasters, [...written.values()]),
        after(lastToEnd(counted), windowHours),
        true,
      );
    }
  }
  return plan;
}

/** 003:T127 (ERD §15 rule 83): the releases that take an enrollment's refunds off when written. */
export const END_RELEASES: ReadonlySet<ShareReleaseMilestone> = new Set([
  'recitation_end',
  'ijazah_end',
  'programme_stopped',
]);

/** 003:T127: one refunded order's teacher's share, split between the teacher and the platform. */
export interface RefundPart {
  /** What «عليك» shows: the share the end release took off, or all of it before one is written. */
  readonly teacher_piasters: Piasters;
  /** A refund recorded after the end release: the platform's alone (DEC-98). */
  readonly platform_piasters: Piasters;
}

/**
 * 003:T127 (SRS DEC-98; Q-4 (a)): the enrollment's refunded orders, in id order, each one's share of
 * its refund (`refundShareOf`) split. With no end release written (`takenOff` undefined), every share
 * is the teacher's, as today; once written, the share it took off is the teacher's, given to the
 * orders in id order, and the rest the platform's. «Due 7,000», then 1,000 EGP refunded: 0 and 700.
 */
export function refundPartsOf(
  orders: readonly Pick<ReleaseOrder, 'refunded_piasters' | 'sharePercent'>[],
  takenOff_piasters: Piasters | undefined,
): readonly RefundPart[] {
  let left_piasters = takenOff_piasters;
  return orders.map((order) => {
    const share_piasters = teacherShare(order.refunded_piasters, order.sharePercent);
    if (left_piasters === undefined) {
      return { teacher_piasters: share_piasters, platform_piasters: piasters(0) };
    }
    const teacher_piasters = lowest([share_piasters, left_piasters]);
    left_piasters = shareLeft(left_piasters, [teacher_piasters], piasters(0));
    return {
      teacher_piasters,
      platform_piasters: shareLeft(share_piasters, [teacher_piasters], piasters(0)),
    };
  });
}
