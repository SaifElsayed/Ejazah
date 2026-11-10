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
// (contracts/README.md, "A deleted party"; the note under T007), and by nothing else: no date of
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
import { sessionStatus } from './enrollments.js';
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

/** A cancellation request's reason, at most (FR-CANCEL-1); never blank (ERD §15 rule 45). */
export const CANCELLATION_REASON_MAX_LENGTH = 500;

export const sessionsCancellationRequestInput = z.object({
  sessionId: z.uuid(),
  reason: z.string().trim().min(1).max(CANCELLATION_REASON_MAX_LENGTH),
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
// The reason is the participant's own text, bounded as this file's other participant reason is
// (`cancellation.reason`, 1 to 500 characters).

/** The session disputed, the participant's reason and the client's idempotency key. */
export const sessionsDisputeRaiseInput = z.object({
  sessionId: z.uuid(),
  reason: z.string().min(1).max(500),
  idempotencyKey,
});

/** The dispute opened: `open` until an administrator resolves it (T034). */
export const sessionsDisputeRaiseOutput = z.object({
  disputeId: z.uuid(),
  status: z.literal('open'),
});

export type SessionsDisputeRaiseInput = z.infer<typeof sessionsDisputeRaiseInput>;
export type SessionsDisputeRaiseOutput = z.infer<typeof sessionsDisputeRaiseOutput>;
