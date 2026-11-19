// T011 of specs/004-sessions: the `sessions` namespace of the user surface, `sessions.get` and
// `sessions.join` (specs/004-sessions/contracts/app-surface.md, "`sessions`"; FR-431, FR-432,
// FR-434, FR-435, FR-494, FR-499).
//
// The caller names the session, never who asks or of what gender (R-GENDER-4): a session the caller
// is not a party of, one whose counterparty is of the other gender by the server's records, and one
// that does not exist answer one `NOT_FOUND` (R-GENDER-2). A session carries its local date, local
// start and zone beside its instants, so the phone shows it in the session's zone and the viewer's
// (FR-494, ADR 0009 D5); the join's period is answered as two instants. The counterparty is named as
// every new output of this phase names a party, `{ displayName: string | null, deleted: boolean }`
// (contracts/README.md, "A deleted party"; the note under T007), with its user id for the report
// and flag sheet (005:T021, Q-T4 (a)), and by nothing else: no date of
// birth, minor flag, document or dispute history reaches the other party (R-HONEST-4, FR-499).
//
// `cancellation`, `remedy`, `dispute`, `canRaiseDispute` and `disputeClosesAt` are optional: T021,
// T028 and T026 fill them, so an answer without them parses today and after (R-API-9).
// `RemedyView` is declared here, as the contract defines it, for `remedy` and for T028's procedures.
//
// `sessions.join` answers the provider's address (`serverUrl`, from the video adapter: the note
// under T011, K1), the token the phone presents there, and the instant the token stops opening a
// connection: the session's scheduled end (R-302). The token is never logged (R-SEC-2).
import { z } from 'zod';

import { idempotencyKey } from './idempotency-key.js';
import { calendarDate, timeZone } from './onboarding.js';
import { sessionPostponement, sessionStatus } from './enrollments.js';
import { sessionLengthMinutes } from './packages.js';
import { slotStartTimeLocal } from './slots.js';

/** A session, as the caller names it. */
export const sessionsGetInput = z.object({ sessionId: z.uuid() });

/** The session to join, as the caller names it. */
export const sessionsJoinInput = z.object({ sessionId: z.uuid() });

/**
 * A party of a session as this phase names it (contracts/README.md, "A deleted party"; FR-426): a
 * deleted account has no name, and the phone draws its stand-in.
 */
export const sessionParty = z.object({
  /**
   * 005:T021 (FR-611, FR-614; Q-T4 (a)): the party's user id, which the report and flag sheet names;
   * the server still checks the pairing. A deleted party's too: an id is no name, as a student's
   * `teacher.teacherId` stays (`enrollments.ts:123`). Additive (R-API-9).
   */
  userId: z.uuid(),
  /** The party's display name; null for a deleted party. */
  displayName: z.string().nullable(),
  /** The party's account was deleted (FR-426). */
  deleted: z.boolean(),
});

/** A time a remedy offers, in the session's terms (FR-494). */
const remedyTime = z.object({
  localDate: calendarDate,
  startTimeLocal: slotStartTimeLocal,
  timezone: timeZone,
  startsAt: z.iso.datetime(),
});

/** A remedy as the parties see it (app-surface.md, `RemedyView`); never a `lapsed` one. */
export const remedyView = z.object({
  status: z.enum([
    'awaiting_choice',
    'proposed',
    'counter_proposed',
    'frozen',
    'booked',
    'refund_case',
  ]),
  kind: z.enum(['makeup', 'refund']),
  offeredAt: z.iso.datetime(),
  choiceClosesAt: z.iso.datetime(),
  proposal: remedyTime.optional(),
  /** The pending counter-proposal only; `answerClosesAt` computed when read (D1). */
  counter: remedyTime.extend({ answerClosesAt: z.iso.datetime() }).optional(),
  canChooseRefund: z.boolean(),
  makeupSessionId: z.uuid().optional(),
});

/** The pre-session screen's data (FR-434), and what the session's later screens add to it. */
export const sessionsGetOutput = z.object({
  sessionId: z.uuid(),
  enrollmentId: z.uuid(),
  sequenceNumber: z.int().positive(),
  /** The session this one makes up for, when it is a make-up (ADR 0018 D3). */
  makeupFor: z.object({ sequenceNumber: z.int().positive() }).optional(),
  localDate: calendarDate,
  startTimeLocal: slotStartTimeLocal,
  timezone: timeZone,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  lengthMinutes: sessionLengthMinutes,
  /** `disputed` while disputed: the frozen outcome is not shown to the parties. */
  status: sessionStatus,
  counterparty: sessionParty,
  /** From `startsAt − early_join_lead_minutes` until `endsAt` (FR-431). */
  join: z.object({ opensAt: z.iso.datetime(), closesAt: z.iso.datetime() }),
  /** T021. */
  cancellation: z
    .object({
      requestId: z.uuid(),
      requestedByMe: z.boolean(),
      reason: z.string().min(1).max(500),
      status: z.enum(['pending', 'accepted', 'declined', 'expired']),
      expiresAt: z.iso.datetime(),
    })
    .optional(),
  /** T028. */
  remedy: remedyView.optional(),
  /** T026. */
  dispute: z
    .object({
      status: z.enum(['open', 'resolved', 'dismissed']),
      raisedByMe: z.boolean(),
      closesAt: z.iso.datetime(),
    })
    .optional(),
  /** T026. */
  canRaiseDispute: z.boolean().optional(),
  /** T026. */
  disputeClosesAt: z.iso.datetime().optional(),
  /**
   * T065: whether the counterparty is in the room by the recorded participant events (R-304's
   * per-connection rule; research R-324, item 6); a hint, never a decision, and no provider call.
   */
  counterpartyInRoom: z.boolean(),
  /**
   * 003:T112 (FR-POSTPONE-5, DEC-90): the postponement that moved this session, absent while none
   * did (`sessionPostponement`, the lists' shape). Additive (R-API-9).
   */
  postponement: sessionPostponement.optional(),
});

/** What the phone connects with (FR-431): bound to this session and this caller (R-GENDER-7). */
export const sessionsJoinOutput = z.object({
  sessionId: z.uuid(),
  /** The provider's address, from the server (R-302): never built into the app. */
  serverUrl: z.string().min(1),
  /** Opaque to the app; never logged (R-SEC-2). */
  token: z.string().min(1),
  /** The session's scheduled end: the token opens no connection after it (R-302). */
  validUntil: z.iso.datetime(),
});

export type SessionsGetInput = z.infer<typeof sessionsGetInput>;
export type SessionsJoinInput = z.infer<typeof sessionsJoinInput>;
export type SessionParty = z.infer<typeof sessionParty>;
export type RemedyView = z.infer<typeof remedyView>;
export type SessionsGetOutput = z.infer<typeof sessionsGetOutput>;
export type SessionsJoinOutput = z.infer<typeof sessionsJoinOutput>;

// ---------------------------------------------------------------------------------------------
// T021: `sessions.cancellation` (contracts/app-surface.md, "`sessions.cancellation`"; FR-456 to
// FR-458). Either party asks to cancel a scheduled session not yet started, with a reason, keyed by
// the kernel's idempotency (`idempotent-procedures.ts`); the counterparty accepts or declines.
// The request expires at the session's start (`expiresAt`), read so from that instant whatever its
// row says (FR-458). The caller names the session or the request and nothing else (R-GENDER-4).
// ---------------------------------------------------------------------------------------------

/**
 * A participant's reason, at most: a cancellation request's (FR-CANCEL-1) and a dispute's (T026),
 * one bound for both; never blank (ERD §15 rule 45).
 */
export const PARTICIPANT_REASON_MAX_LENGTH = 500;

export const sessionsCancellationRequestInput = z.object({
  sessionId: z.uuid(),
  reason: z.string().trim().min(1).max(PARTICIPANT_REASON_MAX_LENGTH),
  idempotencyKey,
});

/** The request, pending until it is answered or the session starts. */
export const sessionsCancellationRequestOutput = z.object({
  requestId: z.uuid(),
  status: z.literal('pending'),
  expiresAt: z.iso.datetime(),
});

export const sessionsCancellationAnswerInput = z.object({
  requestId: z.uuid(),
  accept: z.boolean(),
});

/** The answer: accepted cancels the session by agreement (FR-457); declined leaves it (FR-458). */
export const sessionsCancellationAnswerOutput = z.object({
  requestId: z.uuid(),
  status: z.enum(['accepted', 'declined']),
  sessionStatus: sessionStatus,
});

export type SessionsCancellationRequestInput = z.infer<typeof sessionsCancellationRequestInput>;
export type SessionsCancellationRequestOutput = z.infer<typeof sessionsCancellationRequestOutput>;
export type SessionsCancellationAnswerInput = z.infer<typeof sessionsCancellationAnswerInput>;
export type SessionsCancellationAnswerOutput = z.infer<typeof sessionsCancellationAnswerOutput>;

// T026 of specs/004-sessions: `sessions.dispute.raise` (contracts/app-surface.md, "`sessions.dispute`";
// FR-473, FR-474; research R-308). Either participant disputes a session of theirs with a reason,
// from its scheduled end, before the evaluation too, until `dispute_window_hours` after it; keyed by
// the client's idempotency key (`idempotent-procedures.ts`), so a retry answers the first result.
// The reason is the participant's own text, bounded as a cancellation request's is
// (`PARTICIPANT_REASON_MAX_LENGTH`, 1 to 500 characters), and trimmed before its bounds as a
// cancellation request's is, so a reason of spaces only is refused (the owner's decision of
// 2026-11-10).

/** The session disputed, the participant's reason and the client's idempotency key. */
export const sessionsDisputeRaiseInput = z.object({
  sessionId: z.uuid(),
  reason: z.string().trim().min(1).max(PARTICIPANT_REASON_MAX_LENGTH),
  idempotencyKey,
});

/** The dispute opened: `open` until an administrator resolves it (T034). */
export const sessionsDisputeRaiseOutput = z.object({
  disputeId: z.uuid(),
  status: z.literal('open'),
});

export type SessionsDisputeRaiseInput = z.infer<typeof sessionsDisputeRaiseInput>;
export type SessionsDisputeRaiseOutput = z.infer<typeof sessionsDisputeRaiseOutput>;

// T031 and T032 of specs/004-sessions: `sessions.remedy` (contracts/app-surface.md,
// "`sessions.remedy`"; FR-463 to FR-469; research R-311). The student chooses a make-up or, where a
// refund is owed, a refund (`choose`), accepts the system's proposal (`accept`), reads the times a
// counter-proposal may name (`counterOptions`) and names one (`counter`, keyed by the client's
// idempotency key, `idempotent-procedures.ts`); the teacher accepts or declines it
// (`answerCounter`). The caller names the session and what they chose, never who asks or of what
// gender (R-GENDER-4); a counter names a slot and a local date, never an instant or a zone, which
// are the slot's (R-TIME-6, `003:T077`). Each answers the remedy as `sessions.get` shows it
// (`RemedyView`); `accept` always with its make-up's id.

/** The remedy's session, and the choice the student makes (`refund` only where one is owed, A1). */
export const sessionsRemedyChooseInput = z.object({
  sessionId: z.uuid(),
  choice: z.enum(['makeup', 'refund']),
});
export const sessionsRemedyChooseOutput = remedyView;

/** The remedy's session; its proposal is booked. */
export const sessionsRemedyAcceptInput = z.object({ sessionId: z.uuid() });
/** The remedy booked, with its make-up's session. */
export const sessionsRemedyAcceptOutput = remedyView.extend({ makeupSessionId: z.uuid() });

/** The remedy's session. */
export const sessionsRemedyCounterOptionsInput = z.object({ sessionId: z.uuid() });

/** One time a counter-proposal may name: a teacher's slot on a local date, in the slot's zone. */
export const counterOption = z.object({
  slotId: z.uuid(),
  localDate: calendarDate,
  startTimeLocal: slotStartTimeLocal,
  timezone: timeZone,
  startsAt: z.iso.datetime(),
});
/** Per active slot of the session's length, its first free occurrence at or after the bound (Q5 (a)). */
export const sessionsRemedyCounterOptionsOutput = z.object({ options: z.array(counterOption) });

/** One of the options, by its slot and local date, with the client's idempotency key. */
export const sessionsRemedyCounterInput = z.object({
  sessionId: z.uuid(),
  slotId: z.uuid(),
  localDate: calendarDate,
  idempotencyKey,
});
export const sessionsRemedyCounterOutput = remedyView;

/** The teacher's answer to the pending counter-proposal. */
export const sessionsRemedyAnswerCounterInput = z.object({
  sessionId: z.uuid(),
  accept: z.boolean(),
});
export const sessionsRemedyAnswerCounterOutput = remedyView;

export type SessionsRemedyChooseInput = z.infer<typeof sessionsRemedyChooseInput>;
export type SessionsRemedyChooseOutput = z.infer<typeof sessionsRemedyChooseOutput>;
export type SessionsRemedyAcceptInput = z.infer<typeof sessionsRemedyAcceptInput>;
export type SessionsRemedyAcceptOutput = z.infer<typeof sessionsRemedyAcceptOutput>;
export type CounterOption = z.infer<typeof counterOption>;
export type SessionsRemedyCounterOptionsInput = z.infer<typeof sessionsRemedyCounterOptionsInput>;
export type SessionsRemedyCounterOptionsOutput = z.infer<typeof sessionsRemedyCounterOptionsOutput>;
export type SessionsRemedyCounterInput = z.infer<typeof sessionsRemedyCounterInput>;
export type SessionsRemedyCounterOutput = z.infer<typeof sessionsRemedyCounterOutput>;
export type SessionsRemedyAnswerCounterInput = z.infer<typeof sessionsRemedyAnswerCounterInput>;
export type SessionsRemedyAnswerCounterOutput = z.infer<typeof sessionsRemedyAnswerCounterOutput>;

// T060 of specs/004-sessions: `sessions.complaint.raise` (contracts/app-surface.md,
// "`sessions.complaint`"; FR-452; research R-322, «The complaint»). The student of a `confirmed`
// enrollment complains of the teacher's absence with a mandatory reason, the participant's own
// text bounded as a dispute's is (1 to 500 characters, trimmed first). One open per enrollment, the
// database holding it: a second is refused `COMPLAINT_OPEN`, the open one's id in `details`. Not
// keyed: the one-open rule answers a retry. The procedure declares its own limit,
// `rate_limit_absence_complaint`, the student as subject.

/** The enrollment complained of and the student's reason. */
export const sessionsComplaintRaiseInput = z.object({
  enrollmentId: z.uuid(),
  reason: z.string().trim().min(1).max(PARTICIPANT_REASON_MAX_LENGTH),
});

/** The complaint opened: `open` until an administrator decides it (`cases.decideComplaint`). */
export const sessionsComplaintRaiseOutput = z.object({
  complaintId: z.uuid(),
  status: z.literal('open'),
});

export type SessionsComplaintRaiseInput = z.infer<typeof sessionsComplaintRaiseInput>;
export type SessionsComplaintRaiseOutput = z.infer<typeof sessionsComplaintRaiseOutput>;

// 003:T112 (SRS §3.8.6, FR-POSTPONE-1 to FR-POSTPONE-5, DEC-86, DEC-90; the owner's Q-1 (a), Q-2 (a)
// and Q-3 (a) of 2026-11-19): `sessions.postpone`. Either party of a `confirmed` enrollment
// postpones its sessions of that enrollment in the coming week, with a reason and without the other
// party's consent, keyed by the kernel's idempotency (`idempotent-procedures.ts`), as a cancellation
// request is. Q-1 (a): the week is the caller's `scheduled` sessions of the enrollment, make-ups
// included, starting from now + the postponement notice to now + 7 days; one nearer than the notice
// stands. Q-2 (a): each is moved to `postponed`, never evaluated, freeing both parties' time, and is
// owed a make-up at once. Q-3 (a): once per postponement interval per party per enrollment, from that
// party's last request on it. The caller names the enrollment and nothing of who asks (R-GENDER-4);
// the reason is bounded and trimmed as a cancellation request's. Refused `CONFLICT` with
// `details.cause` one of `sessionsPostponeRefusalCause`, and `ACCOUNT_RESTRICTED` while either
// party's account is not active (as `sessions.join`), each writing nothing.

/** The enrollment, the party's reason and the client's idempotency key. */
export const sessionsPostponeInput = z.object({
  enrollmentId: z.uuid(),
  reason: z.string().trim().min(1).max(PARTICIPANT_REASON_MAX_LENGTH),
  idempotencyKey,
});

/** The postponement written, and the sessions it moved to `postponed`: at least one. */
export const sessionsPostponeOutput = z.object({
  postponementId: z.uuid(),
  sessionIds: z.array(z.uuid()).min(1),
});

/**
 * Why a postponement was refused, as `CONFLICT`'s `details.cause`: the enrollment not `confirmed`
 * (the cause `sessions.complaint.raise` and the administrator's end name), no session of the
 * caller's left to postpone in the week (FR-POSTPONE-1, FR-POSTPONE-3), or the caller's last
 * postponement on the enrollment inside the interval (FR-POSTPONE-4).
 */
export const sessionsPostponeRefusalCause = z.enum([
  'enrollment_not_confirmed',
  'no_session_in_week',
  'interval_not_passed',
]);

export type SessionsPostponeInput = z.infer<typeof sessionsPostponeInput>;
export type SessionsPostponeOutput = z.infer<typeof sessionsPostponeOutput>;
export type SessionsPostponeRefusalCause = z.infer<typeof sessionsPostponeRefusalCause>;
