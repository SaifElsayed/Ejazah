// 003:T105: the administrator surface's `payouts` namespace, «تحويلات المعلمين» (SRS DEC-81, DEC-89;
// ADR 0025 D2; the note under T105 and the owner's «Approve» of 2026-11-17).
//
// `payouts.list`: the totals for all teachers (held, due now, paid all time and this month, taken
// off as refunds to students), and one row per teacher with the same figures, the teachers with a
// release due first, the oldest due first, a «due now only» filter, pages of
// `admin_list_page_size`. `payouts.get`: one teacher's releases («ليه», the same rows as the
// teacher's «مستحقاتي» with the order and the student behind each), the refunds on his orders
// («عليه»: the refund as recorded and his share of it, with the enrollment's closing case), and his
// payout account masked. `payouts.mark`: «تم الصرف», the mark that a due release was executed by
// hand in the gateway's dashboard; keyed (`idempotent-procedures.ts`), it records a fact and moves
// no money (FR-PAYG-11); `payouts.unmark` undoes a mark made in error, with a mandatory reason.
// Every read writes its audit entry (`payouts.listed`, `payouts.viewed`).
//
// No gateway amount word crosses here (`eslint.boundaries.js`'s leave is `payments.ts` alone): the
// figures are shares, releases and refunds. Money crosses as `_piasters` integers (R-MONEY-1).
import { z } from 'zod';

import { idempotencyKey } from '../idempotency-key.js';
import { adminReason } from './admins.js';
import { shareReleaseMilestone, shareReleaseState } from '../teacher-dues.js';

/** A whole number of piasters (ERD §0). */
const amountPiasters = z.int().nonnegative();

/** A person the page names: the id and the display name. */
const namedPerson = z.object({ userId: z.uuid(), displayName: z.string() });

/** The five figures of the totals and of each teacher's row. */
export const payoutFigures = z.object({
  /** Releases computed and not yet due. */
  held_piasters: amountPiasters,
  /** Releases due and not yet marked. */
  dueNow_piasters: amountPiasters,
  /** Releases marked paid, all time. */
  paid_piasters: amountPiasters,
  /** Releases marked paid this calendar month (Africa/Cairo, Q-B1-9). */
  paidThisMonth_piasters: amountPiasters,
  /** The teachers' share of the refunds recorded on their orders (Q-6 as revised). */
  takenOff_piasters: amountPiasters,
});

/** A page starts after this teacher, in the list's order. */
export const payoutsListCursor = z.uuid();

export const payoutsListInput = z.object({
  /** Only the teachers with a release due now. */
  dueOnly: z.boolean().optional(),
  cursor: payoutsListCursor.optional(),
});

export const payoutsListItem = payoutFigures.extend({
  teacher: namedPerson,
  /** The oldest due release's instant; absent when nothing is due. */
  oldestDueAt: z.iso.datetime().optional(),
});

export const payoutsListOutput = z.object({
  totals: payoutFigures,
  items: z.array(payoutsListItem),
  nextCursor: payoutsListCursor.optional(),
});

export const payoutsGetInput = z.object({ teacherUserId: z.uuid() });

/**
 * 006:T018 (FU-E1 (a), the owner's «موافق» of 2026-11-23): a paid order a release draws from, and the
 * amount it draws from it.
 */
export const payoutReleaseOrder = z.object({
  paymentId: z.uuid(),
  amount_piasters: amountPiasters,
});

/** One release of the teacher («ليه»), with the order and the student behind it. */
export const payoutRelease = z.object({
  /** A written release's id, which `payouts.mark` names; absent on a `held` one, never stored. */
  releaseId: z.uuid().optional(),
  part: shareReleaseMilestone,
  amount_piasters: amountPiasters,
  state: shareReleaseState,
  fallsDueAt: z.iso.datetime().optional(),
  waitsForCase: z.boolean(),
  paidAt: z.iso.datetime().optional(),
  enrollmentId: z.uuid(),
  paymentId: z.uuid(),
  student: namedPerson,
  /**
   * 006:T018 (FU-E1 (a)): the paid orders the release draws from, in the order drawn, with the amount
   * from each; one order for a package's release. A programme's draws its orders' shares oldest first,
   * each less what the releases before it drew: the half of an offer of 10,000 EGP by months, fee
   * 500 EGP, draws 350 from the assessment, 700 from each of months 1 and 2, and 87.50 from month 3.
   * Additive (R-API-9).
   */
  orders: z.array(payoutReleaseOrder),
});

/** One refund recorded on the teacher's orders («عليه»). */
export const payoutDeduction = z.object({
  paymentId: z.uuid(),
  enrollmentId: z.uuid(),
  student: namedPerson,
  /** The refund as recorded: the order's refunded total. */
  refunded_piasters: amountPiasters,
  /** The teacher's share of it: the refund × the order's rate, rounded up. */
  share_piasters: amountPiasters,
  /**
   * 003:T127 (SRS DEC-98): the part of `share_piasters` the platform bears, a refund recorded after
   * the enrollment's end release was written, not shown to the teacher; absent when none. Added,
   * additively (R-API-9).
   */
  platformShare_piasters: amountPiasters.optional(),
  /** The enrollment's closing case, when one closed it. */
  case: z.object({ caseId: z.uuid(), reason: z.string().max(64) }).optional(),
});

export const payoutsGetOutput = z.object({
  teacher: namedPerson,
  /** The gateway's recipient reference masked to its last four characters; absent when unverified. */
  payoutAccountMasked: z.string().max(16).optional(),
  figures: payoutFigures,
  releases: z.array(payoutRelease),
  deductions: z.array(payoutDeduction),
});

export const payoutsMarkInput = z.object({ releaseId: z.uuid(), idempotencyKey });

/**
 * The undo of a mark made in error (the owner's «موافق على الاتنين», 2026-11-18; SRS DEC-89): the
 * reason is mandatory and reaches the audit log as written; the release is due again. Keyed
 * (`idempotent-procedures.ts`), allowed at any time, refused NOT_FOUND for an unknown release and
 * CONFLICT for one not marked.
 */
export const payoutsUnmarkInput = z.object({
  releaseId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

export type PayoutFigures = z.infer<typeof payoutFigures>;
export type PayoutsListInput = z.infer<typeof payoutsListInput>;
export type PayoutsListItem = z.infer<typeof payoutsListItem>;
export type PayoutsListOutput = z.infer<typeof payoutsListOutput>;
export type PayoutsGetInput = z.infer<typeof payoutsGetInput>;
export type PayoutRelease = z.infer<typeof payoutRelease>;
export type PayoutReleaseOrder = z.infer<typeof payoutReleaseOrder>;
export type PayoutDeduction = z.infer<typeof payoutDeduction>;
export type PayoutsGetOutput = z.infer<typeof payoutsGetOutput>;
export type PayoutsMarkInput = z.infer<typeof payoutsMarkInput>;
export type PayoutsUnmarkInput = z.infer<typeof payoutsUnmarkInput>;
