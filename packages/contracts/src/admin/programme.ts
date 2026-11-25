// 006:T003: the administrator surface's `programmes` namespace (specs/006-programme/contracts/
// admin-surface.md; ADR 0024; FR-706b, FR-709, FR-723, FR-725 to FR-727; R-505, R-513).
//
// The queue of the items an administrator decides (a pause, a teacher's stop or refusal request,
// the sweep's `no_offer` and `pay_blocked` items), oldest first; one programme with its months,
// orders and requests; the decision; and the reopen of a stopped programme. Each mutation is
// audited (R-API-12), rate limited by the administrator limit and keyed by an idempotency key; no
// card detail appears in an output or an audit entry. No amount crosses here: the orders' amounts
// are the payments monitor's (`payments.ts`). Additive only once merged (R-API-9).
//
// 006:T018 (FR-726, FR-727; B-P3's conflict check, the owner's «موافق على الكل (أ) مع تحسين س٢»,
// 2026-11-24): the queue offers `charge_unknown` beside `pay_blocked` (Q-1 (a), SRS DEC-113); a
// `no_offer` item carries whether the assessment was held (PR #158 r1 Q-R1 (b)); `programmes.get`
// carries `cardSaved`, a boolean, never a card detail (Q-9 (a), SC-707), and, on a closed programme
// with no `assessment` release, whether the assessment was held (PR #158 r2 Follow-up 2). Additive.
import { z } from 'zod';

import { paymentStatus } from '../checkout.js';
import { idempotencyKey } from '../idempotency-key.js';
import {
  PROGRAMME_TEXT_MAX_LENGTH,
  programmeOffer,
  programmePlan,
  programmeRequestKind,
  programmeRequestStatus,
  programmeState,
} from '../programme.js';
import { adminReason } from './admins.js';
import { declineKind, orderKind } from './payments.js';

/** A page of the queue starts after this item; items are listed by their time-ordered id. */
export const programmesQueueCursor = z.uuid();

/** The queue's filters: the programmes paused, and the open items of each kind (FR-727). */
export const programmesQueueFilter = z.enum([
  'paused',
  'stop',
  /** Unused since SRS DEC-112: no refusal item is raised; kept, not removed (R-API-9, Q-B6). */
  'refusal',
  'no_offer',
  'pay_blocked',
  /** 006:T018 (Q-1 (a), SRS DEC-113): an automatic charge the gateway has not answered. */
  'charge_unknown',
]);

export const programmesQueueInput = z.object({
  cursor: programmesQueueCursor.optional(),
  filter: programmesQueueFilter,
});

/** A person the queue names: their display name alone. */
const namedPerson = z.object({ displayName: z.string() });

/** An administrator's item on a programme (ERD `programme_requests`). */
export const programmeRequestItem = z.object({
  requestId: z.uuid(),
  kind: programmeRequestKind,
  /**
   * The teacher's reason on a `stop` (FR-727); on a decided `no_offer` item, the administrator's
   * record of what the teacher sent support, written by `programmes.decide` (T008, SRS DEC-112);
   * absent otherwise.
   */
  reason: z.string().optional(),
  status: programmeRequestStatus,
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().optional(),
  /**
   * 006:T018 (PR #158 r1 Q-R1 (b)): on a `no_offer` item only, whether the assessment was held
   * (session 1's outcome chain consumed, `done` or `student_no_show`); false is «the assessment was
   * not held; the fee is unreleased» (T021).
   */
  assessmentHeld: z.boolean().optional(),
});

/** One row of the queue, oldest first: how late it is reads from its time. */
export const programmesQueueItem = z.object({
  enrollmentId: z.uuid(),
  teacher: namedPerson,
  student: namedPerson,
  state: programmeState,
  pausedSince: z.iso.datetime().nullable(),
  request: programmeRequestItem.nullable(),
  /** On a `pay_blocked` item only: whether the teacher's payout account is verified now (FR-706b). */
  payeeVerifiedNow: z.boolean().nullable(),
});

export const programmesQueueOutput = z.object({
  items: z.array(programmesQueueItem),
  /** Present while more items follow the page. */
  nextCursor: programmesQueueCursor.optional(),
});

export const programmesGetInput = z.object({ enrollmentId: z.uuid() });

/** One gateway order of the programme, by kind; its amounts are the monitor's. */
export const programmeOrderItem = z.object({
  paymentId: z.uuid(),
  kind: orderKind,
  /** An `instalment`'s month. */
  instalmentMonth: z.int().min(1).optional(),
  status: paymentStatus,
  automatic: z.boolean(),
  declineKind: declineKind.optional(),
  createdAt: z.iso.datetime(),
});

/** `programmes.get`'s answer: the programme, its months and orders by kind, its requests. */
export const programmesGetOutput = z.object({
  enrollmentId: z.uuid(),
  teacher: namedPerson,
  student: namedPerson,
  state: programmeState,
  offerDueAt: z.iso.datetime().nullable(),
  payBy: z.iso.datetime().nullable(),
  offer: programmeOffer.nullable(),
  plan: programmePlan.nullable(),
  monthsPaid: z.int().nonnegative(),
  monthCount: z.int().positive().nullable(),
  nextDueAt: z.iso.datetime().nullable(),
  pausedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  orders: z.array(programmeOrderItem),
  requests: z.array(programmeRequestItem),
  /** 006:T018 (Q-9 (a)): whether a card is saved for the automatic charge; never a card detail. */
  cardSaved: z.boolean(),
  /**
   * 006:T018 (PR #158 r2 Follow-up 2): on a closed programme with no `assessment` release, whether
   * the assessment was held; false is «the assessment was not held; the fee is unreleased» (T021).
   * Absent on any other programme.
   */
  assessmentHeld: z.boolean().optional(),
});

/**
 * An administrator's decision on an item (R-513, I-2 (a), FR-706b): approving a stop closes the
 * programme `programme_stopped`; a `no_offer` item is approved (the refusal, `assessment_refused`)
 * or extended by `programme_offer_hours`; a `pay_blocked` item is approved (the lapse,
 * `offer_lapsed`) or extended by `programme_pay_rest_hours`; neither of the sweep's items takes
 * `decline`. 006:T008 (SRS DEC-112): no refusal request exists any more.
 */
export const programmesDecision = z.enum(['approve', 'decline', 'extend']);

export const programmesDecideInput = z.object({
  requestId: z.uuid(),
  decision: programmesDecision,
  note: adminReason.optional(),
  /**
   * 006:T008 (SRS DEC-112): on a `no_offer` item, required on approve and extend: the
   * administrator's record of what the teacher sent support, kept on the item (1–500).
   */
  reason: z.string().trim().min(1).max(PROGRAMME_TEXT_MAX_LENGTH).optional(),
  idempotencyKey,
});

export const programmesDecideOutput = z.object({ status: programmeRequestStatus });

/**
 * 006:T008 (R-513, FR-706b; B-P2 lane b, Q-B1 (a)): `programmes.decide`'s refusals: `not_open` once
 * the item is decided, withdrawn or gone; `decision_not_allowed` for a decision its kind does not take
 * (a decline on `no_offer` or `pay_blocked`); `not_offered` on a `pay_blocked` item once the
 * programme is no longer `offered`; `offer_sent` approving a `no_offer` item once an offer was sent.
 * 006:T008 (SRS DEC-112): `reason_required`, a `no_offer` decision without the administrator's
 * reason; `makeup_pending`, approving a `no_offer` item while session 1's make-up is pending (Q-B5
 * (a)). 006:T017 (B-P3 lane e, Q-e4 (b), the owner, 2026-11-24): `sessions_pending`, approving a
 * stop while a session of the programme is still scheduled or a remedy of one is open. 006:T021
 * (B-P4's conflict check, Q-1 (a) amended, the owner, 2026-11-25; SRS DEC-113): `charge_answered`, a
 * `charge_unknown` decision once the month's automatic order is no longer `created` (the gateway
 * answered it; PR #160 r1 FU1). Additive.
 */
export const programmesDecideRefusal = z.enum([
  'not_open',
  'decision_not_allowed',
  'not_offered',
  'offer_sent',
  'reason_required',
  'makeup_pending',
  'sessions_pending',
  'charge_answered',
]);

/** `programmes.reopen`: a `programme_stopped` programme, back to `paused` (R-513, FR-725). */
export const programmesReopenInput = z.object({
  enrollmentId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

export const programmesReopenOutput = z.object({ state: z.literal('paused') });

/**
 * `programmes.reopen`'s refusals, restore's (R-513; admin-surface.md). 006:T017 (B-P3 lane e, the
 * owner, 2026-11-24): `not_stopped`, a programme no approved stop closed (Q-e2 (a)); `slot_inactive`,
 * its weekly time deactivated or removed since (Q-e3 (b)); `time_taken`, another session, hold,
 * reserved time or programme of either party over the weekly time's coming weeks (Q-e6).
 */
export const programmesReopenRefusal = z.enum([
  'slot_taken',
  'party_restricted',
  'gender_mismatch',
  'not_stopped',
  'slot_inactive',
  'time_taken',
]);

export type ProgrammesQueueFilter = z.infer<typeof programmesQueueFilter>;
export type ProgrammesQueueInput = z.infer<typeof programmesQueueInput>;
export type ProgrammeRequestItem = z.infer<typeof programmeRequestItem>;
export type ProgrammesQueueItem = z.infer<typeof programmesQueueItem>;
export type ProgrammesQueueOutput = z.infer<typeof programmesQueueOutput>;
export type ProgrammesGetInput = z.infer<typeof programmesGetInput>;
export type ProgrammeOrderItem = z.infer<typeof programmeOrderItem>;
export type ProgrammesGetOutput = z.infer<typeof programmesGetOutput>;
export type ProgrammesDecision = z.infer<typeof programmesDecision>;
export type ProgrammesDecideInput = z.infer<typeof programmesDecideInput>;
export type ProgrammesDecideOutput = z.infer<typeof programmesDecideOutput>;
export type ProgrammesDecideRefusal = z.infer<typeof programmesDecideRefusal>;
export type ProgrammesReopenInput = z.infer<typeof programmesReopenInput>;
export type ProgrammesReopenOutput = z.infer<typeof programmesReopenOutput>;
export type ProgrammesReopenRefusal = z.infer<typeof programmesReopenRefusal>;
